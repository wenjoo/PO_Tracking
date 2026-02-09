async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}

function matchesSearch(text, q) {
  if (!q) return true;
  return (text || "").toLowerCase().includes(q.toLowerCase());
}

/* ============================
   QUICK LINKS (HINTS)
   Edit these once with real URLs
============================ */
const QUICK_LINKS = {
  NOTION: "https://your-notion-link-here",
  MASTERLIST: "https://your-masterlist-link-here",
  SHAREPOINT: "https://your-sharepoint-link-here"
};

// Which steps should show hint links
// You can add more steps here anytime.
const STEP_HINTS = {
  5: [
    { label: "SharePoint", url: QUICK_LINKS.SHAREPOINT },
    { label: "Masterlist", url: QUICK_LINKS.MASTERLIST },
    { label: "Notion", url: QUICK_LINKS.NOTION }
  ],
  8: [
    { label: "SharePoint", url: QUICK_LINKS.SHAREPOINT },
    { label: "Masterlist", url: QUICK_LINKS.MASTERLIST },
    { label: "Notion", url: QUICK_LINKS.NOTION }
  ]
};

function renderHintLinks(stepNo) {
  const hints = STEP_HINTS[stepNo] || [];

  // hide if not configured (still placeholder)
  const usable = hints.filter(h => h.url && !h.url.includes("your-"));
  if (!usable.length) return "";

  return `
    <div class="links">
      <span class="pill">Quick links</span>
      ${usable.map(h => `<a class="pill" href="${h.url}" target="_blank" rel="noreferrer">${h.label}</a>`).join("")}
    </div>
  `;
}

async function loadTree() {
  const q = document.querySelector("#q").value.trim();
  const tree = await api("/api/tree");
  const root = document.querySelector("#tree");
  root.innerHTML = "";

  for (const m of tree) {
    const filteredPOs = m.pos.filter(p => {
      const hay = `${p.folder_name} ${p.it_ref_no} ${p.title} ${p.capex_opex}`.trim();
      return matchesSearch(hay, q) || matchesSearch(m.label, q) || matchesSearch(m.month_key, q);
    });

    if (q && filteredPOs.length === 0 && !matchesSearch(m.label, q) && !matchesSearch(m.month_key, q)) {
      continue;
    }

    const monthDetails = document.createElement("details");
    monthDetails.className = "month";
    monthDetails.innerHTML = `
      <summary>
        <b>${m.label}</b>
        <span class="pill">${m.month_key}</span>
        <span class="pill">${filteredPOs.length} PO</span>
      </summary>
    `;

    const monthBox = document.createElement("div");
    monthBox.className = "box";

    const addRow = el(`
      <div class="row">
        <button data-addpo>+ PO</button>
      </div>
    `);
    monthBox.appendChild(addRow);

    const poList = document.createElement("div");
    poList.style.marginTop = "10px";

    for (const p of filteredPOs) {
      const poDetails = document.createElement("details");
      poDetails.className = "po";
      poDetails.innerHTML = `
        <summary>
          <span>${p.folder_name}</span>
          <span class="pill">${p.capex_opex}</span>
          <span class="pill">${new Date(p.updated_at).toLocaleString()}</span>
        </summary>
      `;

      const poBox = document.createElement("div");
      poBox.className = "box";
      poBox.innerHTML = `<div class="muted">Loading…</div>`;
      poDetails.appendChild(poBox);

      poDetails.addEventListener("toggle", async () => {
        if (!poDetails.open) return;
        const { steps } = await api(`/api/po/${p.id}`);
        poBox.innerHTML = renderStepsHTML(steps);
        wireSteps(poBox, steps);
      });

      poList.appendChild(poDetails);
    }

    monthBox.appendChild(poList);
    monthDetails.appendChild(monthBox);

    // Add PO handler
    addRow.querySelector("[data-addpo]").onclick = async () => {
      const folder_name = prompt("PO Folder Name\nExample: 2026-02-IT-001_Capex_Hello World");
      if (!folder_name) return;

      const cap = prompt("CAPEX or OPEX? (type CAPEX / OPEX)", "CAPEX");
      const capex_opex = (cap || "").toUpperCase();
      if (!["CAPEX","OPEX"].includes(capex_opex)) return alert("Must be CAPEX or OPEX");

      const it_ref_no = prompt("IT Ref No (example: IT-001)");
      if (!it_ref_no) return;

      const title = prompt("Title (example: Hello World)");
      if (!title) return;

      await api("/api/po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month_id: m.id, folder_name, capex_opex, it_ref_no, title })
      });

      await loadTree();
      monthDetails.open = true;
    };

    root.appendChild(monthDetails);
  }

  if (!root.childElementCount) {
    root.appendChild(el(`<div class="muted">No results.</div>`));
  }
}

function renderStepsHTML(steps) {
  return `
    <div class="steps">
      ${steps.map(s => `
        <div class="step ${s.is_done ? "done" : ""}" data-step-id="${s.id}">
          <div class="step-head">
            <div style="flex:1;">
              <div class="step-title">
                ${s.step_no}. ${s.step_title}
                ${s.is_done ? `<span class="pill donepill">Done</span>` : ``}
              </div>
              <div class="muted">${s.step_desc}</div>
              ${renderHintLinks(s.step_no)}
            </div>

            <label class="pill">
              <input type="checkbox" data-done ${s.is_done ? "checked" : ""} />
              Done
            </label>
          </div>

          <div class="links">
            <input data-link1 placeholder="Extra Link 1 (optional)" value="${s.link1 || ""}" />
            <input data-link2 placeholder="Extra Link 2 (optional)" value="${s.link2 || ""}" />
            <button data-save>Save</button>
          </div>

          <div class="fileline">
            <input type="file" data-file />
            <button data-upload>Upload</button>
            ${
              s.file_path
                ? `<a href="${s.file_path}" target="_blank" rel="noreferrer">Open file</a>`
                : `<span class="muted">No file</span>`
            }
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function wireSteps(container, steps) {
  for (const s of steps) {
    const card = container.querySelector(`[data-step-id="${s.id}"]`);
    const done = card.querySelector("[data-done]");
    const link1 = card.querySelector("[data-link1]");
    const link2 = card.querySelector("[data-link2]");
    const saveBtn = card.querySelector("[data-save]");
    const fileInput = card.querySelector("[data-file]");
    const uploadBtn = card.querySelector("[data-upload]");

    saveBtn.onclick = async () => {
      await api(`/api/step/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_done: !!done.checked,
          link1: link1.value || null,
          link2: link2.value || null
        })
      });
      await loadTree();
    };

    uploadBtn.onclick = async () => {
      const f = fileInput.files?.[0];
      if (!f) return alert("Choose a file first");

      const form = new FormData();
      form.append("file", f);

      await api(`/api/step/${s.id}/upload`, { method: "POST", body: form });
      await loadTree();
    };
  }
}

document.querySelector("#newMonthBtn").onclick = async () => {
  const month_key = prompt("Month key (YYYY-MM)\nExample: 2026-02");
  if (!month_key) return;

  const label = prompt("Label\nExample: February 2026", month_key) || month_key;

  await api("/api/months", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month_key, label })
  });

  await loadTree();
};

let t = null;
document.querySelector("#q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => loadTree().catch(() => {}), 200);
});

loadTree().catch(e => alert(e.message));
