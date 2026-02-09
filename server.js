const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

const nowISO = () => new Date().toISOString();

const STAGES = [
  "QUOTATION_COLLECTING",
  "FORM_DRAFTING",
  "COMBINED_PREPARING",
  "SIGNED_PENDING",
  "UPLOADED_DONE",
  "PO_PENDING_ADMIN",
  "PO_SENT_MANAGER",
  "INVOICE_PENDING",
  "INVOICE_UPLOADED",
  "PAYMENT_PENDING",
  "PAYMENT_NEED_CONFIRMATION",
  "PAYMENT_COMPLETED",
  "CLOSED"
];

// ---- Helpers ----
function insertLog(poId, action, fromStage, toStage, note, changedBy) {
  db.prepare(`
    INSERT INTO po_activity_logs (po_request_id, action, from_stage, to_stage, note, changed_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(poId, action, fromStage || null, toStage || null, note || null, changedBy || "system", nowISO());
}

// ---- API ----

// Create PO
app.post("/api/po", (req, res) => {
  const {
    it_ref_no, title, capex_opex,
    form_name, vendor, amount, currency,
    requestor, manager,
    next_action, owner_role, priority,
    changed_by
  } = req.body;

  if (!it_ref_no || !title || !capex_opex) {
    return res.status(400).json({ error: "it_ref_no, title, capex_opex are required" });
  }
  if (!["CAPEX", "OPEX"].includes(capex_opex)) {
    return res.status(400).json({ error: "capex_opex must be CAPEX or OPEX" });
  }

  const created_at = nowISO();
  const updated_at = created_at;
  const stage = "QUOTATION_COLLECTING";

  try {
    const stmt = db.prepare(`
      INSERT INTO po_requests (
        it_ref_no, title, capex_opex, form_name, vendor, amount, currency,
        requestor, manager,
        stage, next_action, owner_role, priority,
        created_at, updated_at
      ) VALUES (
        @it_ref_no, @title, @capex_opex, @form_name, @vendor, @amount, @currency,
        @requestor, @manager,
        @stage, @next_action, @owner_role, @priority,
        @created_at, @updated_at
      )
    `);

    const info = stmt.run({
      it_ref_no,
      title,
      capex_opex,
      form_name: form_name || null,
      vendor: vendor || null,
      amount: (amount === undefined || amount === null || amount === "") ? null : Number(amount),
      currency: currency || "MYR",
      requestor: requestor || null,
      manager: manager || null,
      stage,
      next_action: next_action || "Get quotations",
      owner_role: owner_role || "INTERN",
      priority: priority || "MED",
      created_at,
      updated_at
    });

    const poId = info.lastInsertRowid;
    insertLog(poId, "Created", null, stage, null, changed_by || "ui");
    res.json({ id: poId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List with search + filters
app.get("/api/po", (req, res) => {
  const {
    q,
    stage,
    capex_opex,
    vendor,
    owner_role,
    priority,
    sort = "updated_at",
    dir = "desc",
    limit = "500"
  } = req.query;

  const allowedSort = new Set(["updated_at", "created_at", "amount", "vendor", "stage", "it_ref_no", "title"]);
  const sortCol = allowedSort.has(sort) ? sort : "updated_at";
  const sortDir = (String(dir).toLowerCase() === "asc") ? "ASC" : "DESC";

  const lim = Math.max(1, Math.min(2000, Number(limit) || 500));

  const where = [];
  const params = {};

  if (q) {
    where.push(`(
      it_ref_no LIKE @q OR
      title LIKE @q OR
      vendor LIKE @q OR
      form_name LIKE @q
    )`);
    params.q = `%${q}%`;
  }
  if (stage) { where.push(`stage = @stage`); params.stage = stage; }
  if (capex_opex) { where.push(`capex_opex = @capex_opex`); params.capex_opex = capex_opex; }
  if (vendor) { where.push(`vendor = @vendor`); params.vendor = vendor; }
  if (owner_role) { where.push(`owner_role = @owner_role`); params.owner_role = owner_role; }
  if (priority) { where.push(`priority = @priority`); params.priority = priority; }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT *
    FROM po_requests
    ${whereSQL}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ${lim}
  `).all(params);

  res.json(rows);
});

// Detail + logs
app.get("/api/po/:id", (req, res) => {
  const id = Number(req.params.id);
  const po = db.prepare(`SELECT * FROM po_requests WHERE id = ?`).get(id);
  if (!po) return res.status(404).json({ error: "Not found" });

  const logs = db.prepare(`
    SELECT *
    FROM po_activity_logs
    WHERE po_request_id = ?
    ORDER BY created_at DESC
    LIMIT 300
  `).all(id);

  res.json({ po, logs });
});

// Update fields
app.patch("/api/po/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM po_requests WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const allowed = new Set([
    "title","capex_opex","form_name","vendor","amount","currency","requestor","manager",
    "next_action","owner_role","priority",
    "quote_requested_at","quote_received_at","signed_at","uploaded_at",
    "po_received_at","invoice_received_at","payment_requested_at","payment_completed_at",
    "sharepoint_folder_url","signed_pdf_url","po_doc_url","invoice_url","payment_slip_url"
  ]);

  const updates = [];
  const params = { id };

  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.has(k)) continue;
    updates.push(`${k} = @${k}`);
    if (k === "amount") {
      params[k] = (v === undefined || v === null || v === "") ? null : Number(v);
    } else {
      params[k] = (v === undefined ? null : v);
    }
  }

  if (!updates.length) return res.status(400).json({ error: "No valid fields to update" });

  updates.push(`updated_at = @updated_at`);
  params.updated_at = nowISO();

  // quick validation
  if (params.capex_opex && !["CAPEX", "OPEX"].includes(params.capex_opex)) {
    return res.status(400).json({ error: "capex_opex must be CAPEX or OPEX" });
  }

  db.prepare(`UPDATE po_requests SET ${updates.join(", ")} WHERE id = @id`).run(params);
  insertLog(id, "Updated fields", null, null, req.body.note || null, req.body.changed_by || "ui");

  res.json({ ok: true });
});

// Move stage
app.post("/api/po/:id/move-stage", (req, res) => {
  const id = Number(req.params.id);
  const { to_stage, note, changed_by } = req.body;

  if (!STAGES.includes(to_stage)) {
    return res.status(400).json({ error: "Invalid stage" });
  }

  const existing = db.prepare(`SELECT * FROM po_requests WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const from_stage = existing.stage;

  db.prepare(`
    UPDATE po_requests
    SET stage = ?, updated_at = ?
    WHERE id = ?
  `).run(to_stage, nowISO(), id);

  insertLog(id, "Stage changed", from_stage, to_stage, note || null, changed_by || "ui");
  res.json({ ok: true });
});

// Meta for dropdowns
app.get("/api/meta", (req, res) => {
  const vendors = db.prepare(`
    SELECT DISTINCT vendor
    FROM po_requests
    WHERE vendor IS NOT NULL AND vendor != ''
    ORDER BY vendor
  `).all().map(r => r.vendor);

  res.json({ stages: STAGES, vendors });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PO Tracking running: http://localhost:${PORT}`);
});
