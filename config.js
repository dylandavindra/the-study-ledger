// Single-user auth config. Set these as real environment variables before
// hosting this anywhere public — the fallbacks here are only for local dev.
module.exports = {
  APP_PASSWORD: process.env.APP_PASSWORD || "study-ledger",
  SESSION_SECRET: process.env.SESSION_SECRET || "dev-only-secret-change-me"
};
