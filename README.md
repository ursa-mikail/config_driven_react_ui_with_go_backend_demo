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
- `options.json` is the **option file**. The UI renders itself from it: steps, questions, choices, help text, rules. Edit it, save, and reload the page; no rebuild or restart is needed (see "Writing the option file").
- The UI renders itself from that file. The Go API validates every answer again on save.
- Saving writes `data/config.json` and stores a version in Postgres.
- "Run pipeline" makes the program read `data/config.json` and run from it (log level, workers, batch size, and so on). A summary lands in `data/last_run.json`.

## Using the UI
- **Dropdowns** open upward when there is no room below. Use the arrow keys, Home and End to move, Enter or Space to choose, Esc to close.
- **Unsaved changes:** the browser asks before you close the tab if you changed answers and did not save.
- **Runs survive a refresh.** Reload the page during a run and the log keeps streaming. A finished run's output stays visible.
- **Version history** (on the last step) lists recent saves and which settings each one changed. "Load into form" fills the form with that version. Nothing changes on disk until you save again.
- Moving to another step puts keyboard focus on its heading. The progress meters have text labels for screen readers.

## Writing the option file

`options.json` is the single place that says what the user is asked and how each choice is described. The API serves it at `GET /api/schema`, the UI fetches it before drawing anything, and the API validates every saved answer against the same file. Nothing about the questions is hard-coded in the UI.

### Viewing the option file and the config file
- **Option file:** open http://localhost:3000/api/schema in a browser to see the copy the API is serving right now (the file on disk is `options.json`). The UI has no view of it.
- **Config file:** the side panel shows a live preview of `config.json` as you answer. After saving, the last step has a download link, or open http://localhost:3000/api/config/download. On disk it is `data/config.json`.

### Picking up changes
- The API checks the file on every request. Save the file, then **reload the page** and the new steps, fields and choices appear. Answers already open in a form are not redrawn until you reload.
- If the edited file has problems, the API keeps using the last good version and lists every problem in its log: `docker compose logs api`. At first start, a file with problems stops the API with the same list.
- Problems are reported in plain words with the step and field they belong to: unknown or misspelled keys (for example `lable`), missing `title`/`label`, duplicate keys or option values, a select with no options, `min` not below `max`, a `showIf` that points at a field that does not exist, a `recommended` that is not one of the options, a `pattern` that is not a valid expression, and a `default` that fails its own rules.
- If an edit never shows up and the log says nothing, your editor probably replaced the file instead of changing it, and Docker is still showing the old one. Run `docker compose restart api`.

### Shape of the file
```json
{
  "title": "Nimbus Pipeline",
  "subtitle": "One line shown on the welcome screen.",
  "steps": [
    {
      "id": "basics", "title": "The basics", "icon": "✦",
      "subtitle": "One line under the step heading.",
      "fields": [
        {"key": "region", "type": "select", "label": "Region", "required": true, "default": "us-west",
         "help": "Shown under the question.",
         "options": [
           {"value": "us-west", "label": "US West", "desc": "Oregon"},
           {"value": "eu-central", "label": "Europe", "desc": "Frankfurt"}]}
      ]
    }
  ]
}
```
A "Review and launch" step is added after your last step automatically.

| Level | Keys |
|---|---|
| File | `title` (required), `subtitle`, `steps` (required, at least one) |
| Step | `id` (required, unique), `title` (required), `icon`, `subtitle`, `fields` (required, at least one) |
| Field | `key`, `type`, `label` (all required), plus the keys in the next table |
| Choice (inside `options`) | `value`, `label` (both required), `desc`, `icon` |

Any other key is rejected, so typos are caught instead of silently ignored.

### Field keys
| Key | Meaning |
|---|---|
| `key` | The name the answer is saved under in `config.json`. Letters, digits and underscores; unique across the whole file. Renaming a key drops the old answer. |
| `type` | `text`, `password`, `textarea`, `number`, `slider`, `select`, `radio`, `checkbox`, `toggle`, `multicheck`, `tags`, `date`, `color` |
| `label` | The question the user reads. |
| `help` | A line of explanation under the question. |
| `placeholder` | Grey example text in empty text, password, textarea fields. |
| `default` | The starting answer. It must pass the field's own rules. |
| `required` | The user must answer before moving on. On a checkbox or toggle it means "must be checked". |
| `recommended` | The value you suggest. Radio shows a "Recommended" badge on that choice. Other types show a "Use the recommended setting" link whenever the current answer differs. For select and radio it must be one of the option values. |
| `showIf` | Show the field only when another field has a value: `{"key": "metrics", "equals": true}` or `{"key": "source_type", "in": ["postgres", "kafka"]}`. Hidden fields are not required and are left out of `config.json`. |
| `min`, `max`, `step`, `unit` | `number` and `slider`. `min` and `max` are required. Values must sit on the step grid counted from `min` (min 5, step 5 allows 5, 10, 15…). `unit` is shown next to a slider value. |
| `options` | `select`, `radio`, `multicheck`. Required, non-empty. |
| `pattern`, `patternMsg` | `text`, `password`, `textarea`. A regular expression the answer must match, and the message shown when it does not. Keep it simple: it runs in both the browser and the API, and lookaheads are not supported. |
| tags | `tags` accepts at most 20 labels, each up to 60 characters. |

### How a choice is described
Each entry in `options` has two sides. What the user **sees** comes from `label` (the bold name), `desc` (the smaller line under it) and, for radio only, `icon`. What gets **saved** is only `value`:

```json
{"value": "mask_pii", "label": "Mask personal data", "desc": "Hide emails and phones"}
```
The user sees "Mask personal data / Hide emails and phones". `config.json` gets `"mask_pii"`, which is what the program reads. Change `label` and `desc` freely; change `value` only together with the program that reads it, and older saved answers that use a removed value will fail validation until the user picks again.

Choices appear in the order written. A multicheck saves the selected values as a list, in the order shown.

## Validation (server side)
Besides required fields, patterns, ranges and options, the API now also rejects: step violations, dates that are not real `YYYY-MM-DD` days, text over 2000 characters, duplicate list items, and any key that is not in the option file.

## Security notes
- `data/config.json` is written with owner-only permissions (`0600`) because it can hold the access secret. If you need to read it on the host without sudo, set `CONFIG_FILE_MODE: "0644"` in `docker-compose.yml`.
- `GET /api/history` never returns values, only which setting names changed, so secrets cannot leak through it. The secret is still stored as plain text in the database and the config file. Use a real secret store for anything sensitive.
- Fonts are bundled into the web image, so the UI makes no requests to outside servers.

## Reproducible builds
Run `./lock` once. After that the images build with `npm ci` and `go build -mod=readonly`, so dependencies cannot change between builds. Without the lockfiles the build still works, but resolves the latest allowed versions each time.

## API
`GET /api/schema` (the option file as served; http://localhost:3000/api/schema)
`GET /api/config` (add `?version=N` for an older version) · `PUT /api/config` · `GET /api/config/download` (the saved config file; http://localhost:3000/api/config/download)
`GET /api/history` (version, savedAt, changed keys)
`GET|POST /api/run` (status is `idle`, `running`, `done` or `failed`)
