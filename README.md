# The Study Ledger — local edition

This is the same study tracker as the artifact version, rebuilt to run on your
own machine with a real SQLite database, so your logs, targets, confidence
ratings, timetable edits, and ticked-off deadlines are stored in a file on
your disk instead of a browser page.

## What it is

- **Backend:** Node.js + [Express](https://expressjs.com/), serving a small REST API
- **Database:** [SQLite](https://www.sqlite.org/) via `better-sqlite3` — one file, no server to install or run separately
- **Frontend:** plain HTML/CSS/JS (no build step, no framework) in `public/`

## Setup (VS Code)

1. Unzip this folder and open it in VS Code (`File → Open Folder…`).
2. Open a terminal in VS Code (`` Ctrl+` `` / `` Cmd+` ``) and run:
   ```
   npm install
   ```
   This downloads Express and better-sqlite3. `better-sqlite3` ships prebuilt
   binaries for Windows/macOS/Linux, so this normally works without needing a
   C++ compiler installed — if it fails, see **Troubleshooting** below.
3. Start the app:
   ```
   npm start
   ```
   You should see:
   ```
   The Study Ledger is running at http://localhost:3000
   Database file: .../data/study-ledger.db
   ```
4. Open **http://localhost:3000** in your browser. That's it — everything
   you add or change is written straight into `data/study-ledger.db`.

Leave the terminal running while you use the app (it's your local server).
Press `Ctrl+C` in the terminal to stop it; run `npm start` again any time to
bring it back — your data is still there.

## Where your data lives

Everything is in one file: `data/study-ledger.db`. It's created automatically
the first time you run `npm start`, seeded with your term's timetable and
assessment deadlines. From then on:

- Confidence ratings and weekly targets → `modules` table
- Class sessions (including ones you add/remove) → `sessions` table
- Assessment deadlines and their submitted/not state → `assessments` table
- Daily study log entries → `logs` table

You can inspect or query it with any SQLite tool (e.g. the
[SQLite VS Code extension](https://marketplace.visualstudio.com/items?itemName=alexcvzz.vscode-sqlite),
DB Browser for SQLite, or the `sqlite3` CLI).

## Starting over

If you ever want to wipe everything and reseed from the original term data:
```
npm run seed:reset
npm start
```
This **permanently deletes** every log, edit, and ticked deadline — there's
no undo, so only run it if you actually want a clean slate.

## Project structure

```
study-ledger-app/
├── server.js          Express app entry point
├── db/
│   ├── index.js        Opens the SQLite file, creates tables, seeds once
│   ├── seed-data.js     The term's modules / timetable / assessments
│   └── reset.js         Wipes the database file (npm run seed:reset)
├── routes/
│   └── api.js           REST endpoints (GET/POST/PATCH/DELETE)
├── public/
│   ├── index.html        Page structure
│   ├── styles.css        All styling
│   └── app.js             Fetches from the API and renders everything
└── data/
    └── study-ledger.db    Created on first run (git-ignored)
```

## API reference

| Method | Path | Body | What it does |
|---|---|---|---|
| GET | `/api/state` | — | Everything: modules, sessions, assessments, logs, term dates |
| PATCH | `/api/modules/:code` | `{ target?, confidence? }` | Update a module's weekly target and/or confidence (1–5) |
| POST | `/api/sessions` | `{ date, module, type, start, end, room }` | Add a class session (`type` is `"S"` or `"L"`) |
| DELETE | `/api/sessions/:id` | — | Remove a class session |
| PATCH | `/api/assessments/:id` | `{ done }` | Mark a deadline submitted / not |
| POST | `/api/logs` | `{ module, date, hours, topic }` | Add a study log entry |
| DELETE | `/api/logs/:id` | — | Remove a log entry |

## Troubleshooting

**`npm install` fails on `better-sqlite3`** — this usually means no prebuilt
binary was found for your platform/Node version. Two options:
1. Install a C++ build toolchain (on Windows: `npm install -g windows-build-tools`
   or install Visual Studio Build Tools; on macOS: `xcode-select --install`)
   and re-run `npm install`.
2. Or swap in a pure-JS alternative — replace `better-sqlite3` in
   `package.json` and `db/index.js` with [`sql.js`](https://github.com/sql-js/sql.js)
   or [`node:sqlite`](https://nodejs.org/api/sqlite.html) (built into Node.js
   22.5+, no install needed at all).

**Port 3000 already in use** — run `PORT=4000 npm start` instead, then open
`http://localhost:4000`.

**"Could not reach the local server" in the browser** — the Express server
isn't running. Check the VS Code terminal for errors, or run `npm start` again.
