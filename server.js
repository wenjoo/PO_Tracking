const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const app = express();
app.use(express.json());

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const nowISO = () => new Date().toISOString();

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Safe filename storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

// Default steps 1–9 (your workflow)
const DEFAULT_STEPS = [
  { no: 1, title: "Quotations", desc: "Collect vendor quotations. Upload files or paste link(s)." },
  { no: 2, title: "Upload Capex/Opex Forms in Excel", desc: "Create CAPEX/OPEX form (manual name) and upload the Excel or link it." },
  { no: 3, title: "Combined Capex/Opex with quotations (pdf)", desc: "Combine CAPEX/OPEX + quotations into one PDF. Upload or link." },
  { no: 4, title: "Signed Combined PDF", desc: "Get the combined PDF signed. Upload or paste the signed file link." },
  { no: 5, title: "Upload to admin (sharepoint and masterlist)", desc: "Upload signed PDF to SharePoint + update masterlist / Notion status." },
  { no: 6, title: "PO", desc: "Get PO from admin and send back to manager. Upload PO file or link." },
  { no: 7, title: "Invoice", desc: "Get invoice from vendor. Upload invoice or link." },
  { no: 8, title: "Upload to admin (sharepoint and masterlist)", desc: "Upload invoice to SharePoint + update masterlist / Notion status." },
  { no: 9, title: "Make payment", desc: "Admin makes payment. Follow up if needed, upload payment slip or link." }
];

// ---- API ----

// Create month folder
app.post("/api/months", (req, res) => {
  const { month_key, label } = req.body;

  if (!month_key || !/^\d{4}-\d{2}$/.test(month_key)) {
    return res.status(400).json({ error: "month_key must be YYYY-MM (e.g. 2026-02)" });
  }

  try {
    const info = db.prepare(`
      INSERT INTO months (month_key, label, created_at)
      VALUES (?, ?, ?)
    `).run(month_key, label || month_key, nowISO());

    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List tree (months -> PO folders)
app.get("/api/tree", (_req, res) => {
  const months = db.prepare(`SELECT * FROM months ORDER BY month_key DESC`).all();
  const pos = db.prepare(`
    SELECT p.*, m.month_key
    FROM po_folders p
    JOIN months m ON m.id = p.month_id
    ORDER BY m.month_key DESC, p.created_at DESC
  `).all();

  const map = new Map();
  for (const m of months) map.set(m.id, { ...m, pos: [] });
  for (const p of pos) {
    const bucket = map.get(p.month_id);
    if (bucket) bucket.pos.push(p);
  }

  res.json([...map.values()]);
});

// Create PO folder under a month + auto-create steps
app.post("/api/po", (req, res) => {
  const { month_id, folder_name, capex_opex, it_ref_no, title } = req.body;

  if (!month_id || !folder_name || !capex_opex || !it_ref_no || !title) {
    return res.status(400).json({ error: "month_id, folder_name, capex_opex, it_ref_no, title required" });
  }
  if (!["CAPEX", "OPEX"].includes(capex_opex)) {
    return res.status(400).json({ error: "capex_opex must be CAPEX or OPEX" });
  }

  const created_at = nowISO();
  const updated_at = created_at;

  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO po_folders (month_id, folder_name, capex_opex, it_ref_no, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(month_id, folder_name, capex_opex, it_ref_no, title, created_at, updated_at);

    const poId = info.lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO po_steps (po_id, step_no, step_title, step_desc, is_done, updated_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);

    for (const s of DEFAULT_STEPS) {
      ins.run(poId, s.no, s.title, s.desc, nowISO());
    }

    return poId;
  });

  try {
    const poId = trx();
    res.json({ id: poId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get PO folder + steps
app.get("/api/po/:id", (req, res) => {
  const id = Number(req.params.id);
  const po = db.prepare(`SELECT * FROM po_folders WHERE id = ?`).get(id);
  if (!po) return res.status(404).json({ error: "Not found" });

  const steps = db.prepare(`
    SELECT * FROM po_steps
    WHERE po_id = ?
    ORDER BY step_no ASC
  `).all(id);

  res.json({ po, steps });
});

// Update step (done + optional links)
app.patch("/api/step/:id", (req, res) => {
  const id = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(id);
  if (!step) return res.status(404).json({ error: "Not found" });

  const { is_done, link1, link2 } = req.body;

  db.prepare(`
    UPDATE po_steps
    SET is_done = COALESCE(?, is_done),
        link1 = COALESCE(?, link1),
        link2 = COALESCE(?, link2),
        updated_at = ?
    WHERE id = ?
  `).run(
    typeof is_done === "boolean" ? (is_done ? 1 : 0) : null,
    (link1 === undefined ? null : link1),
    (link2 === undefined ? null : link2),
    nowISO(),
    id
  );

  db.prepare(`UPDATE po_folders SET updated_at = ? WHERE id = ?`).run(nowISO(), step.po_id);

  res.json({ ok: true });
});

// Upload file to a step
app.post("/api/step/:id/upload", upload.single("file"), (req, res) => {
  const id = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(id);
  if (!step) return res.status(404).json({ error: "Not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const file_name = req.file.originalname;
  const file_path = `/uploads/${req.file.filename}`;

  db.prepare(`
    UPDATE po_steps
    SET file_name = ?, file_path = ?, uploaded_at = ?, updated_at = ?
    WHERE id = ?
  `).run(file_name, file_path, nowISO(), nowISO(), id);

  db.prepare(`UPDATE po_folders SET updated_at = ? WHERE id = ?`).run(nowISO(), step.po_id);

  res.json({ ok: true, file_name, file_path });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running: http://localhost:${PORT}`));
