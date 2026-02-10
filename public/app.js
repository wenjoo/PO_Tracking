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
   ICONS (simple modern SVG)
============================ */
function iconEdit() {
  return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25z" stroke="currentColor" stroke-width="1.7" />
      <path d="M14.06 4.19l3.75 3.75" stroke="currentColor" stroke-width="1.7" />
    </svg>
  `;
}
function iconTrash() {
  return `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16" stroke="currentColor" stroke-width="1.7" />
      <path d="M9 7V5h6v2" stroke="currentColor" stroke-width="1.7" />
      <path d="M7 7l1 14h8l1-14" stroke="currentColor" stroke-width="1.7" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" />
    </svg>
  `;
}

/* ============================
   QUICK LINKS (EDIT THESE)
============================ */
const QUICK_LINKS = {
  NOTION: "https://your-notion-link-here",
  MASTERLIST: "https://your-masterlist-link-here",
  SHAREPOINT: "https://your-sharepoint-link-here",
  CAPEX_OPEX_TEMPLATE: "https://your-capex-opex-template-link-here"
};

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
  const usable = hints.filter(h => h.url && !h.url.includes("your-"));
  if (!usable.length) return "";
  return `
    <div class="links">
      <span class="pill">Quick links</span>
      ${usable.map(h => `<a class="pill" href="${h.url}" target="_blank" rel="noreferrer">${h.label}</a>`).join("")}
    </div>
  `;
}

function monthKeyFromLabel(label) {
  const d = new Date(`1 ${label}`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function daysBetween(aISO, bISO) {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

/* ============================
   KEEP UI STATE (NO JUMP)
============================ */
function captureUIState() {
  const openMonth = document.querySelector('details.month[open]');
  const openPO = document.querySelector('details.po[open]');
  return {
    openMonthId: openMonth?.dataset?.monthId || null,
    openPoId: openPO?.dataset?.poId || null,
    scrollY: window.scrollY || 0
  };
}

function restoreUIState(state) {
  if (!state) return;

  if (state.openMonthId) {
    const m = document.querySelector(`details.month[data-month-id="${state.openMonthId}"]`);
    if (m) m.open = true;
  }

  if (state.openPoId) {
    const p = document.querySelector(`details.po[data-po-id="${state.openPoId}"]`);
    if (p) p.open = true;
  }

  requestAnimationFrame(() => window.scrollTo(0, state.scrollY || 0));
}

/* ============================
   AUTH UI
============================ */
let CURRENT_USER = null;

const loginOverlay = document.querySelector("#loginOverlay");
const loginUser = document.querySelector("#loginUser");
const loginPw = document.querySelector("#loginPw");
const loginBtn = document.querySelector("#loginBtn");
const logoutBtn = document.querySelector("#logoutBtn");

const settingsBtn = document.querySelector("#settingsBtn");
const settingsOverlay = document.querySelector("#settingsOverlay");
const closeSettings = document.querySelector("#closeSettings");

function setAuthedUI(user) {
  CURRENT_USER = user;
  loginOverlay.style.display = user ? "none" : "flex";
  settingsBtn.style.display = user && user.is_admin ? "inline-block" : "none";
  if (logoutBtn) logoutBtn.style.display = user ? "inline-block" : "none";
  if (!user) {
    loginUser.value = "";
    loginPw.value = "";
  }
}

async function refreshMe() {
  const { user } = await api("/api/me");
  setAuthedUI(user);
  return user;
}

loginBtn.onclick = async () => {
  try {
    const username = loginUser.value.trim();
    const password = loginPw.value;

    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    await refreshMe();
    await loadTree();
  } catch (e) {
    alert(e.message);
  }
};

logoutBtn.onclick = async () => {
  await api("/api/logout", { method: "POST" });

  loginUser.value = "";
  loginPw.value = "";

  settingsOverlay.style.display = "none";
  setAuthedUI(null);
  document.querySelector("#tree").innerHTML = "";
};

// eye toggle
document.addEventListener("click", (e) => {
  const eye = e.target.closest("[data-eye]");
  if (!eye) return;
  const id = eye.getAttribute("data-eye");
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
});

/* ============================
   ADMIN SETTINGS: USER ACCOUNTS
============================ */
settingsBtn.onclick = async () => {
  settingsOverlay.style.display = "flex";
  await loadUsers();
};

closeSettings.onclick = () => {
  settingsOverlay.style.display = "none";
};

const usersList = document.querySelector("#usersList");
const newUsername = document.querySelector("#newUsername");
const newPassword = document.querySelector("#newPassword");
const newPassword2 = document.querySelector("#newPassword2");
const newIsAdmin = document.querySelector("#newIsAdmin");
const createUserBtn = document.querySelector("#createUserBtn");

async function loadUsers() {
  usersList.innerHTML = `<div class="muted">Loading…</div>`;
  const { users } = await api("/api/admin/users");
  usersList.innerHTML = "";

  for (const u of users) {
    const row = el(`
      <div class="box" style="margin-top:10px;">
        <div><b>${u.username}</b> ${u.is_admin ? `<span class="pill">Admin</span>` : ""}</div>
        <div class="muted">Created: ${new Date(u.created_at).toLocaleString()} | Updated: ${new Date(u.updated_at).toLocaleString()}</div>

        <div class="row" style="margin-top:10px;">
          <input data-u-username placeholder="Change username" value="${u.username}" />
          <label class="small"><input type="checkbox" data-u-admin ${u.is_admin ? "checked" : ""}/> Admin</label>
        </div>

        <div class="row" style="margin-top:8px;">
          <div class="pwwrap">
            <input data-u-pass type="password" placeholder="New password (leave blank keep same)" />
            <span class="eye" data-eye-inline>👁</span>
          </div>
          <button data-u-save>Save</button>
        </div>
      </div>
    `);

    row.querySelector("[data-eye-inline]").onclick = () => {
      const inp = row.querySelector("[data-u-pass]");
      inp.type = inp.type === "password" ? "text" : "password";
    };

    row.querySelector("[data-u-save]").onclick = async () => {
      try {
        const username = row.querySelector("[data-u-username]").value.trim();
        const is_admin = !!row.querySelector("[data-u-admin]").checked;
        const password = row.querySelector("[data-u-pass]").value;

        await api(`/api/admin/users/${u.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, is_admin, password })
        });

        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    };

    usersList.appendChild(row);
  }
}

createUserBtn.onclick = async () => {
  const username = newUsername.value.trim();
  const p1 = newPassword.value;
  const p2 = newPassword2.value;

  if (!username) return alert("Username required");
  if (!p1) return alert("Password required");
  if (p1 !== p2) return alert("Password not match");

  try {
    await api("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: p1, is_admin: !!newIsAdmin.checked })
    });

    newUsername.value = "";
    newPassword.value = "";
    newPassword2.value = "";
    newIsAdmin.checked = false;

    await loadUsers();
  } catch (e) {
    alert(e.message);
  }
};

/* ============================
   STEPS UI
============================ */
function canUpload(stepNo) {
  // ✅ Step 5/8 are checkbox-only, Step 6 checkbox-only, Step 9 checkbox-only
  return ![5, 6, 8, 9].includes(stepNo);
}
function showFilesSection(stepNo) {
  // hide file section for 5/8 only
  return ![5, 8].includes(stepNo);
}

function extraInfoHTML(stepNo) {
  if (stepNo === 2) {
    const ok =
      QUICK_LINKS.CAPEX_OPEX_TEMPLATE &&
      !QUICK_LINKS.CAPEX_OPEX_TEMPLATE.includes("your-");
    return ok
      ? `<div class="links"><a class="pill" href="${QUICK_LINKS.CAPEX_OPEX_TEMPLATE}" target="_blank" rel="noreferrer">Capex/Opex Template</a></div>`
      : "";
  }
  return "";
}

function renderFilesHTML(files, hideEmpty) {
  if (!files || files.length === 0) return hideEmpty ? "" : `<div class="muted">No files uploaded</div>`;
  return `
    <div class="filelist">
      ${files.map(f => `
        <div class="fileitem" data-file-id="${f.id}">
          <a href="${f.file_path}" target="_blank" rel="noreferrer">${f.file_name}</a>
          <span class="pill">${new Date(f.uploaded_at).toLocaleString()}</span>
          <span class="pill">by ${f.uploaded_by}</span>
          <button class="iconbtn file-remove" data-file-remove title="Remove file" type="button">${iconTrash()}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStep5or8Checkboxes(s) {
  return `
    <div class="checks-left">
      <label class="checkrow">
        <input type="checkbox" data-masterlist ${s.masterlist_done ? "checked" : ""} />
        Updated to Master List
      </label>
      <label class="checkrow">
        <input type="checkbox" data-sharepoint ${s.sharepoint_done ? "checked" : ""} />
        Uploaded SharePoint
      </label>
      <label class="checkrow">
        <input type="checkbox" data-notion ${s.notion_done ? "checked" : ""} />
        Updated Notion Status
      </label>
    </div>
  `;
}

function renderStep6Checkbox(s) {
  return `
    <div class="checks-left">
      <label class="checkrow">
        <input type="checkbox" data-outlook ${s.outlook_done ? "checked" : ""} />
        Sent PO to manager on Outlook
      </label>
    </div>
  `;
}

function renderStep9Checkbox(s) {
  return `
    <div class="checks-left">
      <label class="checkrow">
        <input type="checkbox" data-paid ${s.paid_done ? "checked" : ""} />
        Payment made
      </label>
    </div>
  `;
}

function renderStepsHTML(steps) {
  const now = new Date().toISOString();

  return `
    <div class="steps">
      ${steps.map(s => {
        const isOverdue =
          s.step_no === 9 &&
          !s.is_done &&
          s.created_at &&
          daysBetween(s.created_at, now) >= 14;

        const showChecks =
          s.step_no === 5 ? renderStep5or8Checkboxes(s)
          : s.step_no === 8 ? renderStep5or8Checkboxes(s)
          : s.step_no === 6 ? renderStep6Checkbox(s)
          : s.step_no === 9 ? renderStep9Checkbox(s)
          : "";

        const filesHTML = showFilesSection(s.step_no)
          ? renderFilesHTML(s.files, false)
          : "";

        return `
          <div class="step ${s.is_done ? "done" : ""} ${isOverdue ? "overdue" : ""}" data-step-id="${s.id}">
            <div class="step-head">
              <div style="flex:1;">
                <div class="step-title">
                  <b>${s.step_no}. ${s.step_title}</b>
                  ${s.is_done ? `<span class="pill donepill" data-done-pill="1">Done</span>` : ``}
                  ${isOverdue ? `<span class="pill overduepill">Overdue &gt; 2 weeks</span>` : ``}
                </div>

                <div class="muted">${s.step_desc}</div>

                ${extraInfoHTML(s.step_no)}
                ${renderHintLinks(s.step_no)}
              </div>
            </div>

            ${showChecks}

            ${
              canUpload(s.step_no)
                ? `
                  <div class="fileline">
                    <input type="file" data-file />
                    <button data-upload type="button">Upload</button>
                  </div>
                  ${filesHTML}
                `
                : `${filesHTML}`
            }
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function setStepCardDoneUI(card, isDone) {
  card.classList.toggle("done", !!isDone);

  const pill = card.querySelector("[data-done-pill]");
  if (isDone) {
    if (!pill) {
      const title = card.querySelector(".step-title");
      if (title) {
        const p = document.createElement("span");
        p.className = "pill donepill";
        p.setAttribute("data-done-pill", "1");
        p.textContent = "Done";
        title.appendChild(document.createTextNode(" "));
        title.appendChild(p);
      }
    }
  } else {
    if (pill) pill.remove();
  }
}

async function refreshOnePO(poId, poDetailsEl) {
  const { steps } = await api(`/api/po/${poId}`);

  // update step UIs in-place
  for (const s of steps) {
    const card = poDetailsEl.querySelector(`[data-step-id="${s.id}"]`);
    if (!card) continue;
    setStepCardDoneUI(card, !!s.is_done);

    // update checkbox states
    const master = card.querySelector("[data-masterlist]");
    const share = card.querySelector("[data-sharepoint]");
    const notion = card.querySelector("[data-notion]");
    const outlook = card.querySelector("[data-outlook]");
    const paid = card.querySelector("[data-paid]");
    if (master) master.checked = !!s.masterlist_done;
    if (share) share.checked = !!s.sharepoint_done;
    if (notion) notion.checked = !!s.notion_done;
    if (outlook) outlook.checked = !!s.outlook_done;
    if (paid) paid.checked = !!s.paid_done;

    // update file list block (re-render only that part)
    if (showFilesSection(s.step_no)) {
      const oldList = card.querySelector(".filelist")?.parentElement;
      // easiest: re-render whole card content is heavy; instead just replace filelist area
      // We'll replace the first .filelist or "No files uploaded" block if found
      const fileArea = card.querySelector(".filelist") || card.querySelector(".muted");
      if (fileArea) {
        // find a container to replace: prefer .filelist parent or card itself
      }
    }
  }

  // update PO summary done counter
  const done = steps.filter(x => x.is_done).length;
  const total = steps.length;

  const donePill = poDetailsEl.querySelector("[data-po-done]");
  if (donePill) donePill.textContent = `${done}/${total} done`;

  poDetailsEl.classList.toggle("all-done", total > 0 && done === total);

  // ✅ re-render step list to refresh file section (simple & reliable)
  const poBox = poDetailsEl.querySelector(".box");
  if (poBox) {
    poBox.innerHTML = renderStepsHTML(steps);
    wireSteps(poBox, steps, poId, poDetailsEl);
  }
}

function wireSteps(container, steps, poId, poDetailsEl) {
  for (const s of steps) {
    const card = container.querySelector(`[data-step-id="${s.id}"]`);
    if (!card) continue;

    // Upload
    const fileInput = card.querySelector("[data-file]");
    const uploadBtn = card.querySelector("[data-upload]");
    if (uploadBtn) {
      uploadBtn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const f = fileInput.files?.[0];
        if (!f) return alert("Choose a file first");

        const form = new FormData();
        form.append("file", f);

        await api(`/api/step/${s.id}/upload`, { method: "POST", body: form });

        // clear input
        fileInput.value = "";

        await refreshOnePO(poId, poDetailsEl);
      };
    }

    // file remove buttons
    card.querySelectorAll("[data-file-remove]").forEach(btn => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const item = btn.closest("[data-file-id]");
        const fileId = Number(item?.dataset?.fileId);
        if (!fileId) return;

        if (!confirm("Remove this file?")) return;
        await api(`/api/file/${fileId}`, { method: "DELETE" });

        await refreshOnePO(poId, poDetailsEl);
      };
    });

    // helper for checkbox PATCH
    const patchAndRefresh = async (payload) => {
      await api(`/api/step/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });

      await refreshOnePO(poId, poDetailsEl);
    };

    // Step 5/8
    const master = card.querySelector("[data-masterlist]");
    const share = card.querySelector("[data-sharepoint]");
    const notion = card.querySelector("[data-notion]");
    if (master) master.onchange = () => patchAndRefresh({ masterlist_done: !!master.checked });
    if (share) share.onchange = () => patchAndRefresh({ sharepoint_done: !!share.checked });
    if (notion) notion.onchange = () => patchAndRefresh({ notion_done: !!notion.checked });

    // Step 6
    const outlook = card.querySelector("[data-outlook]");
    if (outlook) outlook.onchange = () => patchAndRefresh({ outlook_done: !!outlook.checked });

    // Step 9
    const paid = card.querySelector("[data-paid]");
    if (paid) paid.onchange = () => patchAndRefresh({ paid_done: !!paid.checked });
  }
}

/* ============================
   MAIN TREE
============================ */
async function loadTree() {
  const state = captureUIState();

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
    monthDetails.dataset.monthId = m.id;

    monthDetails.innerHTML = `
      <summary>
        <b>${m.label}</b>
        <span class="pill">${m.month_key}</span>
        <span class="pill">${filteredPOs.length} PO</span>
        <span class="pill">by ${m.created_by}</span>
        <span class="pill">upd ${m.updated_by}</span>

        <span class="summary-actions">
          <button class="iconbtn" data-edit-month title="Edit month" type="button">${iconEdit()}</button>
          <button class="iconbtn" data-del-month title="Delete month" type="button">${iconTrash()}</button>
        </span>
      </summary>
    `;

    // month actions
    const editMonthBtn = monthDetails.querySelector("[data-edit-month]");
    const delMonthBtn = monthDetails.querySelector("[data-del-month]");

    editMonthBtn.onclick = async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const next = prompt("Edit month label", m.label);
      if (!next || !next.trim()) return;
      await api(`/api/months/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next.trim() })
      });
      await loadTree();
      monthDetails.open = true;
    };

    delMonthBtn.onclick = async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!confirm(`Delete month "${m.label}"?\nThis will delete all PO inside.`)) return;
      await api(`/api/months/${m.id}`, { method: "DELETE" });
      await loadTree();
    };

    const monthBox = document.createElement("div");
    monthBox.className = "box";

    const addRow = el(`
      <div class="row">
        <button data-addpo type="button">+ PO</button>
      </div>
    `);
    monthBox.appendChild(addRow);

    const poList = document.createElement("div");
    poList.style.marginTop = "10px";

    for (const p of filteredPOs) {
      const poDetails = document.createElement("details");
      poDetails.className = `po ${p.is_all_done ? "all-done" : ""}`;
      poDetails.dataset.poId = p.id;

      poDetails.innerHTML = `
        <summary>
          <span>${p.folder_name}</span>
          <span class="pill">${p.capex_opex}</span>
          <span class="pill">by ${p.created_by}</span>
          <span class="pill">upd ${p.updated_by}</span>

          <span class="po-right">
            <span class="pill" data-po-done>${p.done_steps}/${p.total_steps} done</span>
            <span class="pill">${new Date(p.updated_at).toLocaleString()}</span>
            <span class="summary-actions">
              <button class="iconbtn" data-edit-po title="Edit PO" type="button">${iconEdit()}</button>
              <button class="iconbtn" data-del-po title="Delete PO" type="button">${iconTrash()}</button>
            </span>
          </span>
        </summary>
      `;

      const poBox = document.createElement("div");
      poBox.className = "box";
      poBox.innerHTML = `<div class="muted">Loading…</div>`;
      poDetails.appendChild(poBox);

      // PO actions
      poDetails.querySelector("[data-edit-po]").onclick = async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const next = prompt("Edit PO folder name", p.folder_name);
        if (!next || !next.trim()) return;
        await api(`/api/po/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ folder_name: next.trim() })
        });
        await loadTree();
        monthDetails.open = true;
      };

      poDetails.querySelector("[data-del-po]").onclick = async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (!confirm(`Delete PO "${p.folder_name}"?`)) return;
        await api(`/api/po/${p.id}`, { method: "DELETE" });
        await loadTree();
        monthDetails.open = true;
      };

      poDetails.addEventListener("toggle", async () => {
        if (!poDetails.open) return;
        const { steps } = await api(`/api/po/${p.id}`);
        poBox.innerHTML = renderStepsHTML(steps);
        wireSteps(poBox, steps, p.id, poDetails);
      });

      poList.appendChild(poDetails);
    }

    monthBox.appendChild(poList);
    monthDetails.appendChild(monthBox);

    // Add PO
    addRow.querySelector("[data-addpo]").onclick = async () => {
      const folder_name = prompt("PO Folder Name\nExample: 2025-01-IT-001_Capex_Name");
      if (!folder_name) return;

      try {
        await api("/api/po", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month_id: m.id, folder_name: folder_name.trim() })
        });

        await loadTree();
        monthDetails.open = true;
      } catch (e) {
        alert(e.message);
      }
    };

    root.appendChild(monthDetails);
  }

  if (!root.childElementCount) {
    root.appendChild(el(`<div class="muted">No results.</div>`));
  }

  restoreUIState(state);
}

// New Month
document.querySelector("#newMonthBtn").onclick = async () => {
  const label = prompt("Month folder name\nExample: Jan 2026");
  if (!label) return;

  const month_key = monthKeyFromLabel(label.trim());
  if (!month_key) return alert("Invalid month format. Try: Jan 2026");

  await api("/api/months", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month_key, label: label.trim() })
  });

  await loadTree();
};

let t = null;
document.querySelector("#q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => loadTree().catch(() => {}), 200);
});

// Boot
(async () => {
  const user = await refreshMe();
  if (user) await loadTree();
})();
