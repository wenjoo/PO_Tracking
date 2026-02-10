PRAGMA foreign_keys = ON;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- MONTHS
CREATE TABLE IF NOT EXISTS months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- PO FOLDERS
CREATE TABLE IF NOT EXISTS po_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL,
  folder_name TEXT NOT NULL,
  capex_opex TEXT CHECK (capex_opex IN ('CAPEX','OPEX')) NOT NULL,
  it_ref_no TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_unique_in_month
ON po_folders(month_id, folder_name);

-- PO STEPS
CREATE TABLE IF NOT EXISTS po_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  step_title TEXT NOT NULL,
  step_desc TEXT NOT NULL,

  is_done INTEGER NOT NULL DEFAULT 0,

  -- ✅ missing before (server uses it)
  manual_done INTEGER NOT NULL DEFAULT 0,

  -- Step 5 & 8 (3 checkboxes)
  masterlist_done INTEGER NOT NULL DEFAULT 0,
  sharepoint_done INTEGER NOT NULL DEFAULT 0,
  notion_done INTEGER NOT NULL DEFAULT 0,

  -- Step 6 (checkbox)
  outlook_done INTEGER NOT NULL DEFAULT 0,

  -- Step 9 (checkbox)
  paid_done INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,

  FOREIGN KEY (po_id) REFERENCES po_folders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_unique
ON po_steps(po_id, step_no);

-- STEP FILES (multiple uploads per step)
CREATE TABLE IF NOT EXISTS po_step_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  FOREIGN KEY (step_id) REFERENCES po_steps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_step
ON po_step_files(step_id);
