const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "po_tracker.db");
const SCHEMA_FILE = path.join(__dirname, "schema.sql");

const db = new Database(DB_FILE);

// init schema
const schema = fs.readFileSync(SCHEMA_FILE, "utf-8");
db.exec(schema);

module.exports = db;
