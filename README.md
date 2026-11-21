# Config Studio

Option file → guided UI → config file → program run.

| Command | What it does |
|---|---|
| `./up`    | Build and start everything, then open http://localhost:3000 |
| `./down`  | Stop (your saved configs are kept) |
| `./clean` | Stop and delete containers, images, database volume and `data/config.json` |
| `./lock`  | Run once: writes `frontend/package-lock.json` and `backend/go.sum` so builds are reproducible. Commit both files. |

On Windows use `up`, `down`, `clean`, `lock` in cmd (the .cmd files). Needs Docker only.

## How it fits together
- `options.json` is the **option file**. Edit it (add fields, steps, `showIf` rules), then run `./up` again. Field types: text, password, textarea, number, slider, select, radio, checkbox, toggle, multicheck, tags, date, color.
- The UI renders itself from that file. The Go API validates every answer again on save.
- Saving writes `data/config.json` and stores a version in Postgres.
- "Run pipeline" makes the program read `data/config.json` and run from it (log level, workers, batch size, and so on). A summary lands in `data/last_run.json`.

## Using the UI
- **Dropdowns** open upward when there is no room below. Use the arrow keys, Home and End to move, Enter or Space to choose, Esc to close.
- **Unsaved changes:** the browser asks before you close the tab if you changed answers and did not save.
- **Runs survive a refresh.** Reload the page during a run and the log keeps streaming. A finished run's output stays visible.
- **Version history** (on the last step) lists recent saves and which settings each one changed. "Load into form" fills the form with that version. Nothing changes on disk until you save again.
- Moving to another step puts keyboard focus on its heading. The progress meters have text labels for screen readers.

## Option file reference
Each field takes: `key`, `type`, `label`, `help`, `placeholder`, `default`, `required`, `recommended`, `showIf` (`{"key": …, "equals": …}` or `{"key": …, "in": […]}`), and by type:
- `number`, `slider`: `min`, `max`, `step`, `unit`. Values must sit on the step grid counted from `min` (for example min 5, step 5 allows 5, 10, 15…).
- `select`, `radio`, `multicheck`: `options` with `value`, `label`, `desc`, and `icon` (radio only).
- `text`, `password`, `textarea`: `pattern` and `patternMsg`.
- `tags`: at most 20 labels, each up to 60 characters.

## Validation (server side)
Besides required fields, patterns, ranges and options, the API now also rejects: step violations, dates that are not real `YYYY-MM-DD` days, text over 2000 characters, duplicate list items, and any key that is not in the option file.

## Security notes
- `data/config.json` is written with owner-only permissions (`0600`) because it can hold the access secret. If you need to read it on the host without sudo, set `CONFIG_FILE_MODE: "0644"` in `docker-compose.yml`.
- `GET /api/history` never returns values, only which setting names changed, so secrets cannot leak through it. The secret is still stored as plain text in the database and the config file. Use a real secret store for anything sensitive.
- Fonts are bundled into the web image, so the UI makes no requests to outside servers.

## Reproducible builds
Run `./lock` once. After that the images build with `npm ci` and `go build -mod=readonly`, so dependencies cannot change between builds. Without the lockfiles the build still works, but resolves the latest allowed versions each time.

## API
`GET /api/schema`
`GET /api/config` (add `?version=N` for an older version) · `PUT /api/config` · `GET /api/config/download`
`GET /api/history` (version, savedAt, changed keys)
`GET|POST /api/run` (status is `idle`, `running`, `done` or `failed`)
