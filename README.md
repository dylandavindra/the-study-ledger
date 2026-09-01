# The Study Ledger 

This is The Study Ledger for SUSS Students. With all their modules for the term listed down for convenient tracking, TMA / GMA section to ensure that students won't forget about their projects and of course the Assessment & Deadline feature that will make sure that students won't miss their submission deadlines.

## STACK

- **Backend:** Node.js + [Express](https://expressjs.com/), serving a small REST API
- **Database:** [SQLite](https://www.sqlite.org/) via `better-sqlite3` — one file, no server to install or run separately
- **Frontend:** plain HTML/CSS/JS (no build step, no framework) in `public/`

## Hosted on

- **Google Cloud:** ## https://34.82.231.228.nip.io

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
