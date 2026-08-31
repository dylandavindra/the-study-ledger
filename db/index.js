const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { APP_PASSWORD } = require("../config");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "study-ledger.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Every table below (other than users and prep_items) is scoped to a user_id
// so each account has its own private study ledger. `module` stays a plain
// TEXT code rather than a foreign key to modules — codes are only unique
// per-user now, and every route re-checks module/user ownership itself.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    slot       INTEGER NOT NULL,
    target     REAL NOT NULL,
    confidence INTEGER NOT NULL DEFAULT 3,
    notes      TEXT NOT NULL DEFAULT '',
    note_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, code)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    date      TEXT NOT NULL,
    module    TEXT NOT NULL,
    type      TEXT NOT NULL CHECK (type IN ('S','L')),
    start     TEXT NOT NULL,
    end       TEXT NOT NULL,
    room      TEXT,
    series_id TEXT
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    module   TEXT NOT NULL,
    label    TEXT NOT NULL,
    due      TEXT NOT NULL,
    category TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module  TEXT NOT NULL,
    date    TEXT NOT NULL,
    hours   REAL NOT NULL,
    topic   TEXT
  );

  CREATE TABLE IF NOT EXISTS prep_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL REFERENCES assessments(id),
    kind          TEXT NOT NULL CHECK (kind IN ('step','block')),
    text          TEXT NOT NULL,
    due           TEXT,
    done          INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );
`);

// ---------- Legacy column migrations (pre-multi-tenant databases) ----------
// These run before the user_id migration below so that the rows it copies
// already include every column that exists today.
const moduleColumns = db.prepare("PRAGMA table_info(modules)").all().map((c) => c.name);
if (!moduleColumns.includes("notes")) {
  db.exec("ALTER TABLE modules ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}
if (!moduleColumns.includes("note_order")) {
  db.exec("ALTER TABLE modules ADD COLUMN note_order INTEGER NOT NULL DEFAULT 0");
  const mods = db.prepare("SELECT code FROM modules ORDER BY slot, code").all();
  const setOrder = db.prepare("UPDATE modules SET note_order = ? WHERE code = ?");
  db.transaction(() => { mods.forEach((m, i) => setOrder.run(i, m.code)); })();
}

// ---------- Migration: single shared password → per-user accounts ----------
// Databases from before multi-user support have a `modules` table with no
// user_id column at all (and `code` as its primary key). Rebuild the four
// per-user tables around a new "admin" account holding everything that
// already existed, so nobody's real data is lost in the upgrade.
const hasUserId = db.prepare("PRAGMA table_info(modules)").all().some((c) => c.name === "user_id");
if (!hasUserId) {
  console.log("Migrating database to support multiple user accounts…");
  db.pragma("foreign_keys = OFF");
  // Without this, SQLite silently rewrites prep_items' "REFERENCES
  // assessments(id)" to point at the renamed assessments_old table below —
  // leaving it broken once assessments_old is dropped.
  db.pragma("legacy_alter_table = ON");

  const migrate = db.transaction(() => {
    const oldModules = db.prepare("SELECT * FROM modules").all();
    const oldSessions = db.prepare("SELECT * FROM sessions").all();
    const oldAssessments = db.prepare("SELECT * FROM assessments").all();
    const oldLogs = db.prepare("SELECT * FROM logs").all();

    const adminId = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run("admin", bcrypt.hashSync(APP_PASSWORD, 10)).lastInsertRowid;

    db.exec("ALTER TABLE modules RENAME TO modules_old");
    db.exec("ALTER TABLE sessions RENAME TO sessions_old");
    db.exec("ALTER TABLE assessments RENAME TO assessments_old");
    db.exec("ALTER TABLE logs RENAME TO logs_old");

    db.exec(`
      CREATE TABLE modules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        code       TEXT NOT NULL,
        name       TEXT NOT NULL,
        slot       INTEGER NOT NULL,
        target     REAL NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 3,
        notes      TEXT NOT NULL DEFAULT '',
        note_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, code)
      );
      CREATE TABLE sessions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id   INTEGER NOT NULL REFERENCES users(id),
        date      TEXT NOT NULL,
        module    TEXT NOT NULL,
        type      TEXT NOT NULL CHECK (type IN ('S','L')),
        start     TEXT NOT NULL,
        end       TEXT NOT NULL,
        room      TEXT,
        series_id TEXT
      );
      CREATE TABLE assessments (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id  INTEGER NOT NULL REFERENCES users(id),
        module   TEXT NOT NULL,
        label    TEXT NOT NULL,
        due      TEXT NOT NULL,
        category TEXT NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE logs (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        module  TEXT NOT NULL,
        date    TEXT NOT NULL,
        hours   REAL NOT NULL,
        topic   TEXT
      );
    `);

    const insertModule = db.prepare(
      "INSERT INTO modules (user_id, code, name, slot, target, confidence, notes, note_order) VALUES (@user_id, @code, @name, @slot, @target, @confidence, @notes, @note_order)"
    );
    oldModules.forEach((m) => insertModule.run(Object.assign({ user_id: adminId }, m)));

    // ids are preserved explicitly so prep_items.assessment_id references stay valid.
    const insertSession = db.prepare(
      "INSERT INTO sessions (id, user_id, date, module, type, start, end, room) VALUES (@id, @user_id, @date, @module, @type, @start, @end, @room)"
    );
    oldSessions.forEach((s) => insertSession.run(Object.assign({ user_id: adminId }, s)));

    const insertAssessment = db.prepare(
      "INSERT INTO assessments (id, user_id, module, label, due, category, done) VALUES (@id, @user_id, @module, @label, @due, @category, @done)"
    );
    oldAssessments.forEach((a) => insertAssessment.run(Object.assign({ user_id: adminId }, a)));

    const insertLog = db.prepare(
      "INSERT INTO logs (id, user_id, module, date, hours, topic) VALUES (@id, @user_id, @module, @date, @hours, @topic)"
    );
    oldLogs.forEach((l) => insertLog.run(Object.assign({ user_id: adminId }, l)));

    db.exec("DROP TABLE modules_old");
    db.exec("DROP TABLE sessions_old");
    db.exec("DROP TABLE assessments_old");
    db.exec("DROP TABLE logs_old");
  });
  migrate();

  db.pragma("legacy_alter_table = OFF");
  db.pragma("foreign_keys = ON");
  console.log(`Existing data moved to a new "admin" account (password: your APP_PASSWORD, default "${APP_PASSWORD}" if unset).`);
}

// Migration: tag sessions created together (weekly/biweekly recurrence)
// with a shared series_id, so a whole run of classes can be deleted at once.
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
if (!sessionColumns.includes("series_id")) {
  db.exec("ALTER TABLE sessions ADD COLUMN series_id TEXT");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_modules_user ON modules(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_sessions_series ON sessions(series_id);
  CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id);
  CREATE INDEX IF NOT EXISTS idx_assessments_due ON assessments(due);
  CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
  CREATE INDEX IF NOT EXISTS idx_prep_items_assessment ON prep_items(assessment_id);
`);

// Every TMA/GBA deliverable gets a default 4-step prep timeline and two
// weekly work blocks the first time it's seen. After that, viewers own
// this list entirely — add, edit, and delete live purely in SQLite.
function addDaysISO(dateStr, n) {
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DEFAULT_PREP_STEPS = [
  { text: "Read the brief, mark the rubric, outline your approach", offset: -21 },
  { text: "First full draft — get every section down, rough is fine", offset: -14 },
  { text: "Revise against the rubric; fill gaps, fix structure", offset: -7 },
  { text: "Final polish, formatting, and submit early", offset: -2 }
];
const DEFAULT_PREP_BLOCKS = ["Sat 9:30–12:30 deep-work block", "Wed 7:30–8:30pm review & reading"];

const insertPrepStep = db.prepare(
  "INSERT INTO prep_items (assessment_id, kind, text, due, done, sort_order) VALUES (?, 'step', ?, ?, 0, ?)"
);
const insertPrepBlock = db.prepare(
  "INSERT INTO prep_items (assessment_id, kind, text, due, done, sort_order) VALUES (?, 'block', ?, NULL, 0, ?)"
);

function seedPrepItems(assessment) {
  DEFAULT_PREP_STEPS.forEach((s, i) => insertPrepStep.run(assessment.id, s.text, addDaysISO(assessment.due, s.offset), i));
  DEFAULT_PREP_BLOCKS.forEach((text, i) => insertPrepBlock.run(assessment.id, text, i));
}

const missingPrep = db
  .prepare(
    `SELECT id, due FROM assessments
     WHERE category IN ('tma','gba')
       AND NOT EXISTS (SELECT 1 FROM prep_items WHERE prep_items.assessment_id = assessments.id)`
  )
  .all();
if (missingPrep.length) {
  db.transaction(() => { missingPrep.forEach(seedPrepItems); })();
}

db.seedPrepItems = seedPrepItems;

module.exports = db;
