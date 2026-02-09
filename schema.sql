PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT UNIQUE NOT NULL,         -- e.g. 2026-02
  label TEXT NOT NULL,                    -- e.g. February 2026
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL,
  folder_name TEXT NOT NULL,              -- e.g. 2026-02-IT-001_Capex_Hello World
  capex_opex TEXT CHECK (capex_opex IN ('CAPEX','OPEX')) NOT NULL,
  it_ref_no TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_unique_in_month
ON po_folders(month_id, folder_name);

CREATE TABLE IF NOT EXISTS po_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,               -- 1..9
  step_title TEXT NOT NULL,
  step_desc TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0,      -- 0/1

  -- Optional extra links user can fill
  link1 TEXT,
  link2 TEXT,

  -- Optional upload
  file_name TEXT,
  file_path TEXT,
  uploaded_at TEXT,

  updated_at TEXT NOT NULL,

  FOREIGN KEY (po_id) REFERENCES po_folders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_unique
ON po_steps(po_id, step_no);
