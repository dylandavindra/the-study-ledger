const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

function normalize(username) {
  return String(username || "").trim().toLowerCase();
}

router.get("/check-username", (req, res) => {
  const username = normalize(req.query.u);
  if (!USERNAME_RE.test(username)) {
    return res.json({ available: false, reason: "3-24 characters: letters, numbers, . _ -" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  res.json({ available: !existing });
});

router.post("/signup", (req, res) => {
  const username = normalize(req.body.username);
  const password = String(req.body.password || "");

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-24 characters: letters, numbers, . _ -" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "That username is already taken" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, passwordHash);
  // Signing up logs you straight in, so it counts as visit #1.
  db.prepare("UPDATE users SET last_login_at = datetime('now'), login_count = 1 WHERE id = ?").run(info.lastInsertRowid);

  req.session.userId = info.lastInsertRowid;
  req.session.username = username;
  res.status(201).json({ username });
});

router.post("/login", (req, res) => {
  const username = normalize(req.body.username);
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }

  db.prepare("UPDATE users SET last_login_at = datetime('now'), login_count = login_count + 1 WHERE id = ?").run(user.id);

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ username: req.session.username });
});

module.exports = router;
