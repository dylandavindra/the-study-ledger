const path = require("path");
const express = require("express");
const session = require("express-session");
const { APP_PASSWORD, SESSION_SECRET } = require("./config");

// Importing this initializes the SQLite database (creates + seeds it on
// first run) before the server starts accepting requests.
require("./db");

const apiRouter = require("./routes/api");
const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.APP_PASSWORD) {
  console.warn(`⚠ APP_PASSWORD not set — if this is the first run against a pre-existing database, the legacy "admin" account will be created with the default password "${APP_PASSWORD}".`);
}
if (!process.env.SESSION_SECRET) {
  console.warn("⚠ SESSION_SECRET not set — using an insecure default. Set it before hosting publicly.");
}

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

app.use("/api/auth", authRouter);

// Everything else — the app itself and its data API — requires a session.
// The login/signup pages and the shared stylesheet are the only things a
// signed-out visitor can reach.
const PUBLIC_PATHS = new Set(["/login.html", "/signup.html", "/styles.css"]);
app.use((req, res, next) => {
  if (req.session && req.session.userId) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
  return res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`The Study Ledger is running at http://localhost:${PORT}`);
  console.log(`Database file: ${path.join(__dirname, "data", "study-ledger.db")}`);
});
