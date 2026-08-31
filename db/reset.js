// Wipes the local database so the next `npm start` reseeds from scratch.
// Run with: npm run seed:reset
// WARNING: this deletes every logged hour, ticked deadline, added/removed
// class, and target/confidence edit you've made. There's no undo.
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const files = ["study-ledger.db", "study-ledger.db-wal", "study-ledger.db-shm"];

let removed = 0;
for (const f of files) {
  const p = path.join(DATA_DIR, f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    removed++;
  }
}

console.log(
  removed
    ? `Removed ${removed} database file(s). Run "npm start" to reseed from scratch.`
    : "No database file found — nothing to reset."
);
