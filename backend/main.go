// Config Studio API: reads the option file, validates answers, writes the config file,
// stores history in Postgres, and runs the demo pipeline from the saved config.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

type Option struct {
	Value string `json:"value"`
}
type Cond struct {
	Key    string `json:"key"`
	Equals any    `json:"equals"`
	In     []any  `json:"in"`
}
type Field struct {
	Key        string   `json:"key"`
	Type       string   `json:"type"`
	Required   bool     `json:"required"`
	Default    any      `json:"default"`
	Min        *float64 `json:"min"`
	Max        *float64 `json:"max"`
	Step       *float64 `json:"step"`
	Pattern    string   `json:"pattern"`
	PatternMsg string   `json:"patternMsg"`
	Options    []Option `json:"options"`
	ShowIf     *Cond    `json:"showIf"`
}
type Step struct {
	Fields []Field `json:"fields"`
}
type Schema struct {
	Steps []Step `json:"steps"`
}

var (
	db         *sql.DB
	schema     Schema
	optionsRaw []byte
	configPath = env("CONFIG_FILE", "/data/config.json")
	fileMode   = parseMode(env("CONFIG_FILE_MODE", "0600"))
)

const maxText = 2000 // longest text answer accepted
const maxTags = 20   // most labels a tags field can hold

// parseMode reads an octal permission string such as 0600 or 0644.
func parseMode(s string) os.FileMode {
	n, err := strconv.ParseUint(s, 8, 32)
	if err != nil {
		return 0o600
	}
	return os.FileMode(n)
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func send(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// ---------- validation ----------

func visible(f Field, cfg map[string]any) bool {
	if f.ShowIf == nil {
		return true
	}
	have := fmt.Sprint(cfg[f.ShowIf.Key])
	if f.ShowIf.In != nil {
		for _, x := range f.ShowIf.In {
			if fmt.Sprint(x) == have {
				return true
			}
		}
		return false
	}
	return fmt.Sprint(f.ShowIf.Equals) == have
}

func isEmpty(v any) bool {
	if v == nil {
		return true
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s) == ""
	}
	return false
}

func inOptions(f Field, s string) bool {
	for _, o := range f.Options {
		if o.Value == s {
			return true
		}
	}
	return false
}

func check(f Field, v any) string {
	switch f.Type {
	case "toggle", "checkbox":
		b, ok := v.(bool)
		if v != nil && !ok {
			return "Must be on or off."
		}
		if f.Required && !b {
			return "This must be checked before you can continue."
		}
	case "number", "slider":
		if isEmpty(v) {
			if f.Required {
				return "Enter a number."
			}
			return ""
		}
		n, ok := v.(float64)
		if !ok {
			return "Enter a number."
		}
		if f.Min != nil && n < *f.Min {
			return fmt.Sprintf("Must be at least %v.", *f.Min)
		}
		if f.Max != nil && n > *f.Max {
			return fmt.Sprintf("Must be at most %v.", *f.Max)
		}
		if f.Step != nil && *f.Step > 0 {
			base := 0.0
			if f.Min != nil {
				base = *f.Min
			}
			q := (n - base) / *f.Step
			if math.Abs(q-math.Round(q)) > 1e-6 {
				return fmt.Sprintf("Use steps of %v.", *f.Step)
			}
		}
	case "multicheck", "tags":
		var arr []any
		if v != nil {
			a, ok := v.([]any)
			if !ok {
				return "Invalid list."
			}
			arr = a
		}
		if f.Required && len(arr) == 0 {
			return "Choose at least one."
		}
		if f.Type == "tags" && len(arr) > maxTags {
			return fmt.Sprintf("Use at most %d labels.", maxTags)
		}
		seen := map[string]bool{}
		for _, x := range arr {
			s, ok := x.(string)
			if !ok || (f.Type == "multicheck" && !inOptions(f, s)) {
				return "Contains an option that does not exist."
			}
			if len(s) > 60 {
				return "A label is too long (60 characters at most)."
			}
			if seen[s] {
				return "Contains the same item twice."
			}
			seen[s] = true
		}
	default:
		if isEmpty(v) {
			if f.Required {
				return "This field is required."
			}
			return ""
		}
		s, ok := v.(string)
		if !ok {
			return "Must be text."
		}
		s = strings.TrimSpace(s)
		if len(s) > maxText {
			return fmt.Sprintf("Too long (%d characters at most).", maxText)
		}
		if f.Type == "date" {
			if _, err := time.Parse("2006-01-02", s); err != nil {
				return "Enter a real date."
			}
		}
		if (f.Type == "select" || f.Type == "radio") && !inOptions(f, s) {
			return "Pick one of the listed options."
		}
		if f.Pattern != "" {
			if re, err := regexp.Compile(f.Pattern); err == nil && !re.MatchString(s) {
				if f.PatternMsg != "" {
					return f.PatternMsg
				}
				return "That does not look right."
			}
		}
	}
	return ""
}

// validate returns the cleaned config (hidden fields dropped) and per-field errors.
func validate(cfg map[string]any) (map[string]any, map[string]string) {
	clean, errs := map[string]any{}, map[string]string{}
	known := map[string]bool{}
	for _, s := range schema.Steps {
		for _, f := range s.Fields {
			known[f.Key] = true
		}
	}
	for k := range cfg {
		if !known[k] {
			errs[k] = "Not a setting this pipeline knows about."
		}
	}
	for _, s := range schema.Steps {
		for _, f := range s.Fields {
			if !visible(f, cfg) {
				continue
			}
			v := cfg[f.Key]
			if msg := check(f, v); msg != "" {
				errs[f.Key] = msg
				continue
			}
			if v != nil {
				clean[f.Key] = v
			}
		}
	}
	return clean, errs
}

func defaults() map[string]any {
	d := map[string]any{}
	for _, s := range schema.Steps {
		for _, f := range s.Fields {
			if f.Default != nil {
				d[f.Key] = f.Default
			}
		}
	}
	return d
}

// ---------- storage ----------

func initDB() {
	var err error
	db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	for i := 0; i < 40; i++ {
		if err = db.Ping(); err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatal("database not reachable: ", err)
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS configs (
		id SERIAL PRIMARY KEY,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		data JSONB NOT NULL)`)
	if err != nil {
		log.Fatal(err)
	}
}

func writeFileAtomic(cfg map[string]any) error {
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return err
	}
	tmp := configPath + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), fileMode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, fileMode); err != nil { // WriteFile keeps the mode of an existing temp file
		return err
	}
	return os.Rename(tmp, configPath)
}

func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	values, saved, version := defaults(), false, 0
	var at time.Time
	var raw []byte
	var err error
	if v := r.URL.Query().Get("version"); v != "" {
		id, perr := strconv.Atoi(v)
		if perr != nil {
			send(w, 400, map[string]any{"error": "version must be a number."})
			return
		}
		err = db.QueryRow(`SELECT id, created_at, data FROM configs WHERE id = $1`, id).Scan(&version, &at, &raw)
		if err == sql.ErrNoRows {
			send(w, 404, map[string]any{"error": fmt.Sprintf("Version %d does not exist.", id)})
			return
		}
	} else {
		err = db.QueryRow(`SELECT id, created_at, data FROM configs ORDER BY id DESC LIMIT 1`).Scan(&version, &at, &raw)
	}
	if err == nil {
		var m map[string]any
		if json.Unmarshal(raw, &m) == nil {
			for k, v := range m {
				values[k] = v
			}
			saved = true
		}
	}
	send(w, 200, map[string]any{"values": values, "saved": saved, "version": version, "savedAt": at, "path": configPath})
}

func handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Values map[string]any `json:"values"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Values == nil {
		send(w, 400, map[string]any{"error": "Send a JSON body like {\"values\": {...}}"})
		return
	}
	clean, errs := validate(body.Values)
	if len(errs) > 0 {
		send(w, 422, map[string]any{"errors": errs})
		return
	}
	raw, _ := json.Marshal(clean)
	var id int
	var at time.Time
	if err := db.QueryRow(`INSERT INTO configs (data) VALUES ($1) RETURNING id, created_at`, string(raw)).Scan(&id, &at); err != nil {
		send(w, 500, map[string]any{"error": "Could not save to the database: " + err.Error()})
		return
	}
	if err := writeFileAtomic(clean); err != nil {
		send(w, 500, map[string]any{"error": "Could not write the config file: " + err.Error()})
		return
	}
	send(w, 200, map[string]any{"version": id, "savedAt": at, "path": configPath, "values": clean})
}

// handleHistory lists recent versions with the names of the settings that changed in each.
// It never returns the values themselves, so secrets cannot leak through this endpoint.
func handleHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT id, created_at, data FROM configs ORDER BY id DESC LIMIT 11`)
	if err != nil {
		send(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	type row struct {
		id   int
		at   time.Time
		data map[string]any
	}
	var all []row
	for rows.Next() {
		var x row
		var raw []byte
		if rows.Scan(&x.id, &x.at, &raw) == nil && json.Unmarshal(raw, &x.data) == nil {
			all = append(all, x)
		}
	}
	out := []map[string]any{}
	for i, x := range all {
		if i == 10 {
			break // the 11th row only exists to compare against
		}
		var prev map[string]any
		if i+1 < len(all) {
			prev = all[i+1].data
		}
		changed := []string{}
		keys := map[string]bool{}
		for k := range x.data {
			keys[k] = true
		}
		for k := range prev {
			keys[k] = true
		}
		for k := range keys {
			a, _ := json.Marshal(x.data[k])
			b, _ := json.Marshal(prev[k])
			if string(a) != string(b) {
				changed = append(changed, k)
			}
		}
		sort.Strings(changed)
		out = append(out, map[string]any{"version": x.id, "savedAt": x.at, "changed": changed, "first": prev == nil})
	}
	send(w, 200, out)
}

// ---------- the program: runs entirely from the saved config file ----------

type runner struct {
	mu     sync.Mutex
	status string
	logs   []string
}

var run = &runner{status: "idle"}

func (r *runner) add(s string) {
	r.mu.Lock()
	r.logs = append(r.logs, s)
	r.mu.Unlock()
}

func str(c map[string]any, k string) string { s, _ := c[k].(string); return s }
func num(c map[string]any, k string, d int) int {
	if n, ok := c[k].(float64); ok {
		return int(n)
	}
	return d
}
func list(c map[string]any, k string) []string {
	var out []string
	if a, ok := c[k].([]any); ok {
		for _, x := range a {
			out = append(out, fmt.Sprint(x))
		}
	}
	return out
}

func execute(cfg map[string]any) {
	defer func() {
		if p := recover(); p != nil {
			run.add(fmt.Sprintf("%s  ERROR the run crashed: %v", time.Now().Format("15:04:05"), p))
			run.mu.Lock()
			run.status = "failed"
			run.mu.Unlock()
		}
	}()
	levels := map[string]int{"debug": 0, "info": 1, "warn": 2, "error": 3}
	min, ok := levels[str(cfg, "log_level")]
	if !ok {
		min = 1
	}
	say := func(level, f string, a ...any) {
		if levels[level] >= min {
			run.add(fmt.Sprintf("%s  %-5s %s", time.Now().Format("15:04:05"), strings.ToUpper(level), fmt.Sprintf(f, a...)))
		}
	}
	start := time.Now()
	env := str(cfg, "environment")
	say("info", "Loaded configuration from %s", configPath)
	say("info", "Pipeline %q starting in %s (%s)", str(cfg, "project_name"), env, str(cfg, "region"))
	tls, _ := cfg["use_tls"].(bool)
	if !tls && env == "prod" {
		say("warn", "Encryption is off in production. Consider turning it on.")
	}
	say("info", "Connecting to %s source at %s", str(cfg, "source_type"), str(cfg, "source_url"))
	time.Sleep(700 * time.Millisecond)
	say("debug", "Checking for new data every %ds, TLS %v", num(cfg, "poll_seconds", 30), tls)

	workers, batch := num(cfg, "workers", 2), num(cfg, "batch_size", 500)
	for _, t := range list(cfg, "transforms") {
		say("info", "Cleanup step enabled: %s", t)
	}
	total, records := workers*3, 0
	for b := 1; b <= total; b++ {
		time.Sleep(280 * time.Millisecond)
		w := (b-1)%workers + 1
		if b == 3 && num(cfg, "max_retries", 0) > 0 {
			say("warn", "worker-%d: batch %d was slow, retry 1 of %d", w, b, num(cfg, "max_retries", 0))
		}
		records += batch
		say("debug", "worker-%d finished batch %d/%d (%d records)", w, b, total, batch)
		if b%workers == 0 {
			say("info", "Progress %d%% — %d records processed", b*100/total, records)
		}
	}
	say("info", "Writing %s files (%s compression) to %s", str(cfg, "format"), str(cfg, "compression"), str(cfg, "destination"))
	if m, _ := cfg["metrics"].(bool); m {
		say("info", "Metrics published on :9100/metrics")
		say("info", "Alerts will go to %s", str(cfg, "alert_email"))
	}
	secs := time.Since(start).Seconds()
	say("info", "Done. %d records in %.1fs", records, secs)
	summary, _ := json.MarshalIndent(map[string]any{"project": str(cfg, "project_name"), "records": records, "seconds": secs, "finishedAt": time.Now()}, "", "  ")
	os.WriteFile(filepath.Join(filepath.Dir(configPath), "last_run.json"), summary, 0o644)
	run.mu.Lock()
	run.status = "done"
	run.mu.Unlock()
}

func handleRunStart(w http.ResponseWriter, r *http.Request) {
	raw, err := os.ReadFile(configPath)
	if err != nil {
		send(w, 400, map[string]any{"error": "Save your configuration first. There is nothing to run yet."})
		return
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		send(w, 500, map[string]any{"error": "The config file is not valid JSON."})
		return
	}
	run.mu.Lock()
	if run.status == "running" {
		run.mu.Unlock()
		send(w, 409, map[string]any{"error": "A run is already in progress."})
		return
	}
	run.status, run.logs = "running", nil
	run.mu.Unlock()
	go execute(cfg)
	send(w, 202, map[string]any{"status": "running"})
}

func handleRunStatus(w http.ResponseWriter, r *http.Request) {
	run.mu.Lock()
	defer run.mu.Unlock()
	send(w, 200, map[string]any{"status": run.status, "logs": append([]string{}, run.logs...)})
}

func main() {
	var err error
	optionsRaw, err = os.ReadFile(env("OPTIONS_FILE", "/app/options.json"))
	if err != nil {
		log.Fatal("cannot read option file: ", err)
	}
	if err = json.Unmarshal(optionsRaw, &schema); err != nil {
		log.Fatal("option file is not valid: ", err)
	}
	initDB()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/schema", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(optionsRaw)
	})
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("PUT /api/config", handlePutConfig)
	mux.HandleFunc("GET /api/config/download", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="config.json"`)
		http.ServeFile(w, r, configPath)
	})
	mux.HandleFunc("GET /api/history", handleHistory)
	mux.HandleFunc("POST /api/run", handleRunStart)
	mux.HandleFunc("GET /api/run", handleRunStatus)

	log.Println("Config Studio API listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
