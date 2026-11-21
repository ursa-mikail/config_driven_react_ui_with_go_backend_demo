# Config Studio

Option file → guided UI → config file → program run.

| Command | What it does |
|---|---|
| `./up`    | Build and start everything, then open http://localhost:3000 |
| `./down`  | Stop (your saved configs are kept) |
| `./clean` | Stop and delete containers, images, database volume and `data/config.json` |

On Windows use `up`, `down`, `clean` in cmd (the .cmd files). Needs Docker only.

## How it fits together
- `options.json` is the **option file**. Edit it (add fields, steps, `showIf` rules), then run `./up` again. Field types: text, password, textarea, number, slider, select, radio, checkbox, toggle, multicheck, tags, date, color.
- The UI renders itself from that file. The Go API validates every answer again on save.
- Saving writes `data/config.json` and stores a version in Postgres.
- "Run pipeline" makes the program read `data/config.json` and run from it (log level, workers, batch size, and so on). A summary lands in `data/last_run.json`.

API: `GET /api/schema`, `GET|PUT /api/config`, `GET /api/config/download`, `GET /api/history`, `GET|POST /api/run`.
