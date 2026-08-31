const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { APP_PASSWORD, SESSION_SECRET } = require("./config");

// Importing this initializes the SQLite database (creates + seeds it on
// first run) before the server starts accepting requests.
require("./db");

const apiRouter = require("./routes/api");
const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// A guessable SESSION_SECRET lets anyone forge a valid session cookie for
// any account, and the fallback below is public (it's committed to git) —
// refuse to boot with it in production rather than silently going live insecure.
if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  console.error("✗ Refusing to start: SESSION_SECRET must be set to a real random value in production.");
  process.exit(1);
}
if (!process.env.APP_PASSWORD) {
  console.warn(`⚠ APP_PASSWORD not set — if this is the first run against a pre-existing database, the legacy "admin" account will be created with the default password "${APP_PASSWORD}".`);
}
if (!process.env.SESSION_SECRET) {
  console.warn("⚠ SESSION_SECRET not set — using an insecure default. Set it before hosting publicly.");
}

// Most hosts (Fly, Railway, Render, or your own nginx/Caddy in front of
// Node) terminate TLS at a proxy in front of this process. Without this,
// Express can't tell the request arrived over HTTPS, and cookie.secure
// below would silently stop the session cookie from ever being set.
if (IS_PRODUCTION) app.set("trust proxy", 1);

// CSP is left off: the app relies on inline <script>/<style> (login/signup
// pages) and Google Fonts, and a real CSP needs nonces/hashes to cover that
// safely rather than 'unsafe-inline', which would defeat its own purpose.
// Helmet's other headers (clickjacking, MIME-sniffing, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Brute-force guard: 20 attempts per IP per 15 minutes across login/signup.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts — try again in a few minutes" }
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);

app.use("/api/auth", authRouter);

// Everything else — the app itself and its data API — requires a session.
// The login/signup pages and the shared stylesheet are the only things a
// signed-out visitor can reach.
const PUBLIC_PATHS = new Set(["/login.html", "/signup.html", "/styles.css", "/term-label.js"]);
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
