const express = require("express");
const db = require("../db");
const { TERM } = require("../db/seed-data");

const router = express.Router();

/* ---------- GET /api/state — everything the UI needs, in one call ---------- */
router.get("/state", (req, res) => {
  const userId = req.session.userId;
  const modules = db.prepare("SELECT * FROM modules WHERE user_id = ? ORDER BY slot").all(userId);
  const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY date, start").all(userId);
  const assessments = db.prepare("SELECT * FROM assessments WHERE user_id = ? ORDER BY due").all(userId);
  const logs = db.prepare("SELECT * FROM logs WHERE user_id = ? ORDER BY date DESC, id DESC").all(userId);
  const prepItems = db
    .prepare(
      `SELECT p.* FROM prep_items p
       JOIN assessments a ON a.id = p.assessment_id
       WHERE a.user_id = ?
       ORDER BY p.assessment_id, p.kind, p.sort_order, p.id`
    )
    .all(userId);
  res.json({ modules, sessions, assessments, logs, prepItems, term: TERM });
});

/* ---------- Modules: add a new module ---------- */
router.post("/modules", (req, res) => {
  const userId = req.session.userId;
  const code = (req.body.code || "").trim();
  const name = (req.body.name || "").trim();
  const target = req.body.target === undefined || req.body.target === "" ? 3 : Number(req.body.target);

  if (!code || !name) return res.status(400).json({ error: "code and name are required" });
  if (Number.isNaN(target) || target < 0) return res.status(400).json({ error: "Invalid target" });

  const existing = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, code);
  if (existing) return res.status(400).json({ error: "Module code already exists" });

  const count = db.prepare("SELECT COUNT(*) AS n FROM modules WHERE user_id = ?").get(userId).n;
  const slot = (count % 6) + 1;
  const maxOrder = db.prepare("SELECT COALESCE(MAX(note_order), -1) AS m FROM modules WHERE user_id = ?").get(userId).m;

  db.prepare(
    "INSERT INTO modules (user_id, code, name, slot, target, confidence, note_order) VALUES (?, ?, ?, ?, ?, 3, ?)"
  ).run(userId, code, name, slot, target, maxOrder + 1);
  res.status(201).json(db.prepare("SELECT * FROM modules WHERE user_id = ? AND code = ?").get(userId, code));
});

/* ---------- Modules: update name, weekly target, confidence and/or notes ---------- */
router.patch("/modules/:code", (req, res) => {
  const userId = req.session.userId;
  const { code } = req.params;
  const existing = db.prepare("SELECT * FROM modules WHERE user_id = ? AND code = ?").get(userId, code);
  if (!existing) return res.status(404).json({ error: "Module not found" });

  const name = req.body.name === undefined ? existing.name : String(req.body.name).trim();
  const target = req.body.target === undefined ? existing.target : Number(req.body.target);
  const confidence =
    req.body.confidence === undefined ? existing.confidence : Number(req.body.confidence);
  const notes = req.body.notes === undefined ? existing.notes : String(req.body.notes);

  if (!name) return res.status(400).json({ error: "Invalid name" });
  if (Number.isNaN(target) || target < 0) return res.status(400).json({ error: "Invalid target" });
  if (Number.isNaN(confidence) || confidence < 1 || confidence > 5)
    return res.status(400).json({ error: "Invalid confidence" });

  db.prepare("UPDATE modules SET name = ?, target = ?, confidence = ?, notes = ? WHERE user_id = ? AND code = ?").run(
    name,
    target,
    confidence,
    notes,
    userId,
    code
  );
  res.json(db.prepare("SELECT * FROM modules WHERE user_id = ? AND code = ?").get(userId, code));
});

/* ---------- Modules: remove a module and everything under it ---------- */
router.delete("/modules/:code", (req, res) => {
  const userId = req.session.userId;
  const { code } = req.params;
  const existing = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, code);
  if (!existing) return res.status(404).json({ error: "Module not found" });

  const del = db.transaction(() => {
    db.prepare(
      `DELETE FROM prep_items WHERE assessment_id IN
       (SELECT id FROM assessments WHERE user_id = ? AND module = ?)`
    ).run(userId, code);
    db.prepare("DELETE FROM logs WHERE user_id = ? AND module = ?").run(userId, code);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND module = ?").run(userId, code);
    db.prepare("DELETE FROM assessments WHERE user_id = ? AND module = ?").run(userId, code);
    db.prepare("DELETE FROM modules WHERE user_id = ? AND code = ?").run(userId, code);
  });
  del();
  res.status(204).end();
});

/* ---------- Modules: persist a new Notes card order ---------- */
router.post("/modules/reorder", (req, res) => {
  const userId = req.session.userId;
  const order = req.body.order;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: "order must be a non-empty array of module codes" });
  }

  const existingCodes = db.prepare("SELECT code FROM modules WHERE user_id = ?").all(userId).map((m) => m.code);
  const sameSet =
    order.length === existingCodes.length &&
    existingCodes.every((code) => order.includes(code));
  if (!sameSet) {
    return res.status(400).json({ error: "order must include every module code exactly once" });
  }

  const setOrder = db.prepare("UPDATE modules SET note_order = ? WHERE user_id = ? AND code = ?");
  db.transaction(() => { order.forEach((code, i) => setOrder.run(i, userId, code)); })();
  res.json(db.prepare("SELECT * FROM modules WHERE user_id = ? ORDER BY note_order").all(userId));
});

/* ---------- Sessions: add / edit / remove a class ---------- */
router.post("/sessions", (req, res) => {
  const userId = req.session.userId;
  const { date, module, type, start, end, room } = req.body;
  if (!date || !module || !type || !start || !end) {
    return res.status(400).json({ error: "date, module, type, start and end are required" });
  }
  if (type !== "S" && type !== "L") {
    return res.status(400).json({ error: "type must be 'S' (Seminar) or 'L' (Lab)" });
  }
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  const info = db
    .prepare("INSERT INTO sessions (user_id, date, module, type, start, end, room) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(userId, date, module, type, start, end, room || null);
  res.status(201).json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid));
});

/* ---------- Sessions: add a whole weekly/biweekly run at once ---------- */
router.post("/sessions/bulk", (req, res) => {
  const userId = req.session.userId;
  const { module, type, start, end, room, dates } = req.body;

  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: "dates must be a non-empty array" });
  }
  if (dates.length > 104) {
    return res.status(400).json({ error: "That's more than two years of classes in one go — narrow the date range" });
  }
  if (!module || !type || !start || !end) {
    return res.status(400).json({ error: "module, type, start and end are required" });
  }
  if (type !== "S" && type !== "L") {
    return res.status(400).json({ error: "type must be 'S' (Seminar) or 'L' (Lab)" });
  }
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  const seriesId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const insert = db.prepare(
    "INSERT INTO sessions (user_id, date, module, type, start, end, room, series_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertAll = db.transaction((rows) => {
    rows.forEach((date) => insert.run(userId, date, module, type, start, end, room || null, seriesId));
  });
  insertAll(dates);

  const created = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND series_id = ? ORDER BY date").all(userId, seriesId);
  res.status(201).json({ seriesId, sessions: created });
});

router.patch("/sessions/:id", (req, res) => {
  const userId = req.session.userId;
  const existing = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: "Session not found" });

  const date = req.body.date === undefined ? existing.date : req.body.date;
  const module = req.body.module === undefined ? existing.module : req.body.module;
  const type = req.body.type === undefined ? existing.type : req.body.type;
  const start = req.body.start === undefined ? existing.start : req.body.start;
  const end = req.body.end === undefined ? existing.end : req.body.end;
  const room = req.body.room === undefined ? existing.room : (req.body.room || null);

  if (!date || !module || !type || !start || !end) {
    return res.status(400).json({ error: "date, module, type, start and end are required" });
  }
  if (type !== "S" && type !== "L") {
    return res.status(400).json({ error: "type must be 'S' (Seminar) or 'L' (Lab)" });
  }
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  db.prepare("UPDATE sessions SET date = ?, module = ?, type = ?, start = ?, end = ?, room = ? WHERE id = ? AND user_id = ?")
    .run(date, module, type, start, end, room, req.params.id, userId);
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

/* ---------- Sessions: remove every occurrence in a recurring series ---------- */
router.delete("/sessions/series/:seriesId", (req, res) => {
  const userId = req.session.userId;
  const info = db
    .prepare("DELETE FROM sessions WHERE series_id = ? AND user_id = ?")
    .run(req.params.seriesId, userId);
  if (info.changes === 0) return res.status(404).json({ error: "Series not found" });
  res.json({ deleted: info.changes });
});

router.delete("/sessions/:id", (req, res) => {
  const userId = req.session.userId;
  const info = db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  if (info.changes === 0) return res.status(404).json({ error: "Session not found" });
  res.status(204).end();
});

/* ---------- Assessments: add a new item ---------- */
router.post("/assessments", (req, res) => {
  const userId = req.session.userId;
  const { module, category } = req.body;
  const label = (req.body.label || "").trim();
  const due = req.body.due;
  if (!module || !label || !due || !category) {
    return res.status(400).json({ error: "module, label, due and category are required" });
  }
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  const info = db
    .prepare("INSERT INTO assessments (user_id, module, label, due, category, done) VALUES (?, ?, ?, ?, ?, 0)")
    .run(userId, module, label, due, category);
  const created = db.prepare("SELECT * FROM assessments WHERE id = ?").get(info.lastInsertRowid);
  if (created.category === "tma" || created.category === "gba") db.seedPrepItems(created);
  res.status(201).json(created);
});

/* ---------- Assessments: edit fields and/or tick / untick as submitted ---------- */
router.patch("/assessments/:id", (req, res) => {
  const userId = req.session.userId;
  const existing = db.prepare("SELECT * FROM assessments WHERE id = ? AND user_id = ?").get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: "Assessment not found" });

  const module = req.body.module === undefined ? existing.module : req.body.module;
  const label = req.body.label === undefined ? existing.label : String(req.body.label).trim();
  const due = req.body.due === undefined ? existing.due : req.body.due;
  const category = req.body.category === undefined ? existing.category : req.body.category;
  const done = req.body.done === undefined ? existing.done : (req.body.done ? 1 : 0);

  if (!label) return res.status(400).json({ error: "Invalid label" });
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  db.prepare("UPDATE assessments SET module = ?, label = ?, due = ?, category = ?, done = ? WHERE id = ? AND user_id = ?")
    .run(module, label, due, category, done, req.params.id, userId);
  const updated = db.prepare("SELECT * FROM assessments WHERE id = ?").get(req.params.id);
  if (updated.category === "tma" || updated.category === "gba") {
    const hasItems = db.prepare("SELECT COUNT(*) AS n FROM prep_items WHERE assessment_id = ?").get(updated.id).n;
    if (hasItems === 0) db.seedPrepItems(updated);
  }
  res.json(updated);
});

router.delete("/assessments/:id", (req, res) => {
  const userId = req.session.userId;
  const existing = db.prepare("SELECT id FROM assessments WHERE id = ? AND user_id = ?").get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: "Assessment not found" });
  const del = db.transaction(() => {
    db.prepare("DELETE FROM prep_items WHERE assessment_id = ?").run(req.params.id);
    db.prepare("DELETE FROM assessments WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  });
  del();
  res.status(204).end();
});

/* ---------- Prep items: steps & work blocks under a TMA/GBA deliverable ---------- */
router.post("/prep-items", (req, res) => {
  const userId = req.session.userId;
  const assessmentId = Number(req.body.assessment_id);
  const kind = req.body.kind;
  const text = (req.body.text || "").trim();
  const due = req.body.due || null;

  if (!assessmentId || (kind !== "step" && kind !== "block") || !text) {
    return res.status(400).json({ error: "assessment_id, kind ('step'|'block') and text are required" });
  }
  const assessment = db.prepare("SELECT id FROM assessments WHERE id = ? AND user_id = ?").get(assessmentId, userId);
  if (!assessment) return res.status(400).json({ error: "Unknown assessment" });

  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM prep_items WHERE assessment_id = ? AND kind = ?")
    .get(assessmentId, kind).m;
  const info = db
    .prepare("INSERT INTO prep_items (assessment_id, kind, text, due, done, sort_order) VALUES (?, ?, ?, ?, 0, ?)")
    .run(assessmentId, kind, text, kind === "step" ? due : null, maxOrder + 1);
  res.status(201).json(db.prepare("SELECT * FROM prep_items WHERE id = ?").get(info.lastInsertRowid));
});

router.patch("/prep-items/:id", (req, res) => {
  const userId = req.session.userId;
  const existing = db
    .prepare(
      `SELECT p.* FROM prep_items p
       JOIN assessments a ON a.id = p.assessment_id
       WHERE p.id = ? AND a.user_id = ?`
    )
    .get(req.params.id, userId);
  if (!existing) return res.status(404).json({ error: "Prep item not found" });

  const text = req.body.text === undefined ? existing.text : String(req.body.text).trim();
  const due = req.body.due === undefined ? existing.due : (req.body.due || null);
  const done = req.body.done === undefined ? existing.done : (req.body.done ? 1 : 0);
  if (!text) return res.status(400).json({ error: "Invalid text" });

  db.prepare("UPDATE prep_items SET text = ?, due = ?, done = ? WHERE id = ?").run(text, due, done, req.params.id);
  res.json(db.prepare("SELECT * FROM prep_items WHERE id = ?").get(req.params.id));
});

router.delete("/prep-items/:id", (req, res) => {
  const userId = req.session.userId;
  const info = db
    .prepare(
      `DELETE FROM prep_items WHERE id = ? AND assessment_id IN
       (SELECT id FROM assessments WHERE user_id = ?)`
    )
    .run(req.params.id, userId);
  if (info.changes === 0) return res.status(404).json({ error: "Prep item not found" });
  res.status(204).end();
});

/* ---------- Logs: add / remove a study session ---------- */
router.post("/logs", (req, res) => {
  const userId = req.session.userId;
  const { module, date, hours, topic } = req.body;
  const h = Number(hours);
  if (!module || !date || Number.isNaN(h) || h <= 0) {
    return res.status(400).json({ error: "module, date and a positive hours value are required" });
  }
  const mod = db.prepare("SELECT code FROM modules WHERE user_id = ? AND code = ?").get(userId, module);
  if (!mod) return res.status(400).json({ error: "Unknown module code" });

  const info = db
    .prepare("INSERT INTO logs (user_id, module, date, hours, topic) VALUES (?, ?, ?, ?, ?)")
    .run(userId, module, date, h, topic || null);
  res.status(201).json(db.prepare("SELECT * FROM logs WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/logs/:id", (req, res) => {
  const userId = req.session.userId;
  const info = db.prepare("DELETE FROM logs WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  if (info.changes === 0) return res.status(404).json({ error: "Log entry not found" });
  res.status(204).end();
});

/* ---------- Account: wipe every module/class/assessment/log ----------
   Meant for resetting the ledger between semesters — the account and
   login history are left untouched. */
router.delete("/account/data", (req, res) => {
  const userId = req.session.userId;
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM prep_items WHERE assessment_id IN (SELECT id FROM assessments WHERE user_id = ?)").run(userId);
    db.prepare("DELETE FROM assessments WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM logs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM modules WHERE user_id = ?").run(userId);
  });
  clear();
  res.status(204).end();
});

module.exports = router;
