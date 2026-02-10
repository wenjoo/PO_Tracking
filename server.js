const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("./db");

const app = express();
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }
  })
);

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

// ✅ Serve uploaded files
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

const nowISO = () => new Date().toISOString();

// Steps 1–9
const DEFAULT_STEPS = [
  { no: 1, title: "Quotations", desc: "Please upload quotations." },
  { no: 2, title: "Create Capex/Opex Form in Excel", desc: "Fill in the CAPEX/OPEX form and upload the file." },
  { no: 3, title: "Combine Capex/Opex Form with Quotations", desc: "Combine CAPEX/OPEX form with the quotations. If multiple vendor, put the chosen one first." },
  { no: 4, title: "Signed Combined File", desc: "Please upload the signed CAPEX/OPEX form here." },
  {
    no: 5,
    title: "Update Signed Capex/Opex Form to Admin",
    desc: "Update Signed Capex/Opex Form to Master List, upload the files to SharePoint."
  },
  { no: 6, title: "PO", desc: "Get PO from Admin and send it back to manager on Outlook." },
  { no: 7, title: "Invoice", desc: "Get invoice from vendor and upload here." },
  { no: 8, title: "Update Invoice to Admin", desc: "Upload invoice on Master List and SharePoint folder, and update Notion status." },
  { no: 9, title: "Admin Make Payment", desc: "Tick checkbox when payment is made." }
];

function parsePOFolderName(folder_name) {
  const raw = String(folder_name || "").trim();
  const parts = raw.split("_").map(s => s.trim()).filter(Boolean);

  let capex_opex = "CAPEX";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "capex") capex_opex = "CAPEX";
    if (low === "opex") capex_opex = "OPEX";
  }

  const itMatch = raw.match(/\bIT-\d+\b/i);
  const it_ref_no = itMatch ? itMatch[0].toUpperCase() : "IT-UNKNOWN";

  let title = "Untitled";
  const capIndex = parts.findIndex(p => ["capex", "opex"].includes(p.toLowerCase()));
  if (capIndex >= 0 && parts[capIndex + 1]) title = parts.slice(capIndex + 1).join(" ");
  else if (parts.length) title = parts.slice(1).join(" ") || raw;

  return { capex_opex, it_ref_no, title };
}

// ✅ server-side done rules that match the UI
function computeStepDone(step_no, stepRow, fileCount) {
  // Steps that are done when they have at least 1 uploaded file
  if ([1, 2, 3, 4, 7].includes(step_no)) return (fileCount || 0) > 0;

  // Step 5 & 8: 3 checkboxes
  if (step_no === 5 || step_no === 8) {
    return !!stepRow.masterlist_done && !!stepRow.sharepoint_done && !!stepRow.notion_done;
  }

  // Step 6: outlook checkbox only
  if (step_no === 6) return !!stepRow.outlook_done;

  // Step 9: payment checkbox only
  if (step_no === 9) return !!stepRow.paid_done;

  return false;
}

function getStepFileCount(stepId) {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM po_step_files WHERE step_id = ?`).get(stepId);
  return Number(r?.c || 0);
}

function recomputeAndSaveStep(stepId, username) {
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(stepId);
  if (!step) return;

  const fileCount = getStepFileCount(stepId);
  const is_done = computeStepDone(step.step_no, step, fileCount) ? 1 : 0;

  db.prepare(`
    UPDATE po_steps
    SET is_done = ?,
        manual_done = ?,
        updated_at = ?,
        updated_by = ?
    WHERE id = ?
  `).run(is_done, step.manual_done || 0, nowISO(), username, stepId);

  db.prepare(`UPDATE po_folders SET updated_at = ?, updated_by = ? WHERE id = ?`)
    .run(nowISO(), username, step.po_id);
}

// -------- AUTH --------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user?.is_admin) return res.status(403).json({ error: "Admin only" });
  next();
}

// Create default admin if missing
function ensureAdminUser() {
  const adminUsername = "infra.support";
  const adminPw = "P@ssw0rd123";

  const existing = db.prepare(`SELECT * FROM users WHERE username = ?`).get(adminUsername);
  if (existing) return;

  const hash = bcrypt.hashSync(adminPw, 10);
  const t = nowISO();
  db.prepare(`
    INSERT INTO users (username, password_hash, is_admin, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(adminUsername, hash, t, t);

  console.log("Created default admin user:", adminUsername);
}
ensureAdminUser();

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username and password required" });

  const user = db.prepare(`SELECT id, username, password_hash, is_admin FROM users WHERE username = ?`).get(username);
  if (!user) return res.status(401).json({ error: "Invalid username or password" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  req.session.user = { id: user.id, username: user.username, is_admin: !!user.is_admin };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// -------- ADMIN USERS --------
app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT id, username, is_admin, created_at, updated_at
    FROM users
    ORDER BY is_admin DESC, username ASC
  `).all();
  res.json({ users });
});

app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, is_admin } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username and password required" });

  const hash = bcrypt.hashSync(password, 10);
  const t = nowISO();

  try {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim(), hash, is_admin ? 1 : 0, t, t);

    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { username, password, is_admin } = req.body || {};
  const nextUsername = typeof username === "string" && username.trim() ? username.trim() : user.username;
  const nextAdmin = typeof is_admin === "boolean" ? (is_admin ? 1 : 0) : user.is_admin;

  let nextHash = user.password_hash;
  if (typeof password === "string" && password.length > 0) {
    nextHash = bcrypt.hashSync(password, 10);
  }

  try {
    db.prepare(`
      UPDATE users
      SET username = ?, password_hash = ?, is_admin = ?, updated_at = ?
      WHERE id = ?
    `).run(nextUsername, nextHash, nextAdmin, nowISO(), id);

    if (req.session.user?.id === id) {
      req.session.user.username = nextUsername;
      req.session.user.is_admin = !!nextAdmin;
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// -------- UPLOADS --------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeOrig = String(file.originalname || "file")
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 120);
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeOrig}`;
    cb(null, unique);
  }
});
const upload = multer({ storage });

// Upload file to a step
app.post("/api/step/:id/upload", requireAuth, upload.single("file"), (req, res) => {
  const stepId = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(stepId);
  if (!step) return res.status(404).json({ error: "Step not found" });

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const user = req.session.user.username;
  const t = nowISO();

  const file_name = req.file.originalname || req.file.filename;
  const file_path = `/uploads/${req.file.filename}`;

  db.prepare(`
    INSERT INTO po_step_files (step_id, file_name, file_path, uploaded_at, uploaded_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(stepId, file_name, file_path, t, user);

  // recompute done
  recomputeAndSaveStep(stepId, user);

  res.json({ ok: true });
});

// Delete uploaded file
app.delete("/api/file/:id", requireAuth, (req, res) => {
  const fileId = Number(req.params.id);
  const f = db.prepare(`SELECT * FROM po_step_files WHERE id = ?`).get(fileId);
  if (!f) return res.status(404).json({ error: "File not found" });

  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(f.step_id);
  if (!step) return res.status(404).json({ error: "Step not found" });

  // remove DB row first
  db.prepare(`DELETE FROM po_step_files WHERE id = ?`).run(fileId);

  // remove physical file if it exists
  try {
    const diskName = String(f.file_path || "").replace(/^\/uploads\//, "");
    const full = path.join(UPLOAD_DIR, diskName);
    if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (_) {
    // ignore
  }

  const user = req.session.user.username;
  recomputeAndSaveStep(step.id, user);

  res.json({ ok: true });
});

// -------- APP API --------

// Create month
app.post("/api/months", requireAuth, (req, res) => {
  const { month_key, label } = req.body;

  if (!month_key || !/^\d{4}-\d{2}$/.test(month_key)) {
    return res.status(400).json({ error: "month_key must be YYYY-MM (e.g. 2026-02)" });
  }

  const t = nowISO();
  const u = req.session.user.username;

  try {
    const info = db.prepare(`
      INSERT INTO months (month_key, label, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(month_key, label || month_key, t, u, t, u);

    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Edit month label
app.patch("/api/months/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const m = db.prepare(`SELECT * FROM months WHERE id = ?`).get(id);
  if (!m) return res.status(404).json({ error: "Month not found" });

  const { label } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: "label required" });

  const u = req.session.user.username;
  db.prepare(`
    UPDATE months
    SET label = ?, updated_at = ?, updated_by = ?
    WHERE id = ?
  `).run(String(label).trim(), nowISO(), u, id);

  res.json({ ok: true });
});

// Delete month (cascades POs)
app.delete("/api/months/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM months WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// Tree
app.get("/api/tree", requireAuth, (_req, res) => {
  const months = db.prepare(`SELECT * FROM months ORDER BY month_key DESC`).all();

  const pos = db.prepare(`
    SELECT
      p.*,
      m.month_key,
      (SELECT COUNT(*) FROM po_steps s WHERE s.po_id = p.id) AS total_steps,
      (SELECT COUNT(*) FROM po_steps s WHERE s.po_id = p.id AND s.is_done = 1) AS done_steps
    FROM po_folders p
    JOIN months m ON m.id = p.month_id
    ORDER BY m.month_key DESC, p.created_at DESC
  `).all();

  const map = new Map();
  for (const m of months) map.set(m.id, { ...m, pos: [] });

  for (const p of pos) {
    const bucket = map.get(p.month_id);
    if (!bucket) continue;

    const total = Number(p.total_steps || 0);
    const done = Number(p.done_steps || 0);
    const is_all_done = total > 0 && done === total;

    bucket.pos.push({ ...p, total_steps: total, done_steps: done, is_all_done });
  }

  res.json([...map.values()]);
});

// Create PO
app.post("/api/po", requireAuth, (req, res) => {
  const { month_id, folder_name } = req.body;
  if (!month_id || !folder_name) return res.status(400).json({ error: "month_id and folder_name required" });

  const { capex_opex, it_ref_no, title } = parsePOFolderName(folder_name);
  const t = nowISO();
  const u = req.session.user.username;

  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO po_folders (month_id, folder_name, capex_opex, it_ref_no, title, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(month_id, folder_name, capex_opex, it_ref_no, title, t, u, t, u);

    const poId = info.lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO po_steps (
        po_id, step_no, step_title, step_desc,
        is_done, manual_done,
        masterlist_done, sharepoint_done, notion_done, outlook_done, paid_done,
        created_at, created_by, updated_at, updated_by
      )
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)
    `);

    for (const s of DEFAULT_STEPS) {
      const tt = nowISO();
      ins.run(poId, s.no, s.title, s.desc, tt, u, tt, u);
    }

    return poId;
  });

  try {
    res.json({ id: trx() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Edit PO folder name
app.patch("/api/po/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const po = db.prepare(`SELECT * FROM po_folders WHERE id = ?`).get(id);
  if (!po) return res.status(404).json({ error: "PO not found" });

  const { folder_name } = req.body || {};
  if (!folder_name || !String(folder_name).trim()) return res.status(400).json({ error: "folder_name required" });

  const parsed = parsePOFolderName(String(folder_name).trim());
  const u = req.session.user.username;

  db.prepare(`
    UPDATE po_folders
    SET folder_name = ?,
        capex_opex = ?,
        it_ref_no = ?,
        title = ?,
        updated_at = ?,
        updated_by = ?
    WHERE id = ?
  `).run(
    String(folder_name).trim(),
    parsed.capex_opex,
    parsed.it_ref_no,
    parsed.title,
    nowISO(),
    u,
    id
  );

  res.json({ ok: true });
});

// Delete PO
app.delete("/api/po/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM po_folders WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ✅ Get PO + steps + files
app.get("/api/po/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const po = db.prepare(`SELECT * FROM po_folders WHERE id = ?`).get(id);
  if (!po) return res.status(404).json({ error: "Not found" });

  const steps = db.prepare(`SELECT * FROM po_steps WHERE po_id = ? ORDER BY step_no ASC`).all(id);
  const stepIds = steps.map(s => s.id);

  let files = [];
  if (stepIds.length) {
    const qs = stepIds.map(() => "?").join(",");
    files = db.prepare(`SELECT * FROM po_step_files WHERE step_id IN (${qs}) ORDER BY uploaded_at DESC`).all(...stepIds);
  }

  const filesByStep = new Map();
  for (const f of files) {
    if (!filesByStep.has(f.step_id)) filesByStep.set(f.step_id, []);
    filesByStep.get(f.step_id).push(f);
  }

  const stepsWithFiles = steps.map(s => ({
    ...s,
    files: filesByStep.get(s.id) || []
  }));

  res.json({ po, steps: stepsWithFiles });
});

// Update step checkboxes
app.patch("/api/step/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(id);
  if (!step) return res.status(404).json({ error: "Not found" });

  const body = req.body || {};
  const next = { ...step };
  const user = req.session.user.username;

  // allow these booleans
  for (const k of ["masterlist_done", "sharepoint_done", "notion_done", "outlook_done", "paid_done"]) {
    if (typeof body[k] === "boolean") next[k] = body[k] ? 1 : 0;
  }

  // compute done with files
  const fileCount = getStepFileCount(id);
  const newIsDone = computeStepDone(step.step_no, next, fileCount) ? 1 : 0;

  db.prepare(`
    UPDATE po_steps
    SET masterlist_done = ?,
        sharepoint_done = ?,
        notion_done = ?,
        outlook_done = ?,
        paid_done = ?,
        is_done = ?,
        updated_at = ?,
        updated_by = ?
    WHERE id = ?
  `).run(
    next.masterlist_done,
    next.sharepoint_done,
    next.notion_done,
    next.outlook_done,
    next.paid_done,
    newIsDone,
    nowISO(),
    user,
    id
  );

  db.prepare(`UPDATE po_folders SET updated_at = ?, updated_by = ? WHERE id = ?`).run(
    nowISO(),
    user,
    step.po_id
  );

  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running: http://localhost:${PORT}`));
