/* eslint-disable no-alert */
const APP_STORAGE_KEY = "ccce.v1";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = String(iso || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateMDY(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${m}/${d}/${y}`;
}

function money(n) {
  const v = Number.isFinite(n) ? n : Number(n || 0);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(v);
}

function parseNumber(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const cleaned = (() => {
    // Accept values like "12.5", "12,5", "$1,234.56" across mobile/locale keyboards.
    const s = raw.replace(/\s+/g, "").replace(/\$/g, "");
    if (s.includes(",") && !s.includes(".")) return s.replace(/,/g, ".");
    return s.replace(/,/g, "");
  })();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  const raw = localStorage.getItem(APP_STORAGE_KEY);
  if (!raw) {
    return {
      meta: { createdAt: Date.now(), updatedAt: Date.now() },
      settings: {
        businessName: "CC Custom Engraving",
        email: "",
        phone: "",
        address: "",
        taxRate: 0,
        invoicePrefix: `INV-${new Date().getFullYear()}-`,
        nextInvoiceNumber: 2,
        paymentTerms: "Due on receipt",
        paymentInstructions: "Make checks payable to Charlie Cochran or Venmo @clc571",
        invoiceEmailBcc: "clc571@gmail.com",
        notesDefault:
          "Please remit payment by the due date indicated above.\n\nWe appreciate your business and look forward to serving you again.",
      },
      tasks: [],
      invoices: [],
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      meta: parsed.meta || { createdAt: Date.now(), updatedAt: Date.now() },
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    };
  } catch {
    return defaultState();
  }
}

function defaultState() {
  localStorage.removeItem(APP_STORAGE_KEY);
  return loadState();
}

async function saveToCloud() {
  if (!window.supabaseClient) return;
  try {
    await supabaseClient.from('settings').upsert({ id: 1, ...state.settings });
    if (state.tasks.length > 0) {
      await supabaseClient.from('tasks').upsert(state.tasks);
    }
    if (state.invoices.length > 0) {
      await supabaseClient.from('invoices').upsert(state.invoices);
    }
  } catch (e) {
    console.error("Cloud save error:", e);
  }
}

function saveState(state) {
  state.meta = state.meta || { createdAt: Date.now(), updatedAt: Date.now() };
  state.meta.updatedAt = Date.now();
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  saveToCloud();
}

let state = loadState();
let route = "dashboard";

const appEl = document.getElementById("app");
const modal = document.getElementById("modal");
const modalTitleEl = document.getElementById("modalTitle");
const modalBodyEl = document.getElementById("modalBody");
const modalFooterEl = document.getElementById("modalFooter");

function setRoute(next) {
  route = next;
  for (const btn of document.querySelectorAll(".tab")) {
    btn.classList.toggle("isActive", btn.dataset.route === route);
  }
  render();
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-route]");
  if (!btn) return;
  setRoute(btn.dataset.route);
});

function openModal({ title, bodyHtml, footerHtml, onReady }) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = bodyHtml;
  modalFooterEl.innerHTML = footerHtml ?? `<button class="btn" value="cancel" type="submit">Close</button>`;
  modal.showModal();
  if (typeof onReady === "function") onReady();
}

function closeModal() {
  if (modal.open) modal.close();
}

modal.addEventListener("close", () => {
  modalBodyEl.innerHTML = "";
  modalFooterEl.innerHTML = "";
});

function taskCounts() {
  const counts = { todo: 0, doing: 0, done: 0 };
  for (const t of state.tasks) {
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
  return counts;
}

function invoiceCounts() {
  const counts = { draft: 0, sent: 0, paid: 0, void: 0 };
  for (const inv of state.invoices) {
    counts[inv.status] = (counts[inv.status] || 0) + 1;
  }
  return counts;
}

function calcInvoiceTotals(inv) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const subtotal = items.reduce((acc, it) => acc + parseNumber(it.qty) * parseNumber(it.rate), 0);
  const discount = Math.max(0, parseNumber(inv.discount || 0));
  const taxableBase = Math.max(0, subtotal - discount);
  const taxRate = parseNumber(inv.taxRate ?? state.settings.taxRate ?? 0) / 100;
  const tax = taxableBase * taxRate;
  const total = taxableBase + tax;
  return { subtotal, discount, tax, total };
}

function buildInvoiceEmail(inv) {
  const totals = calcInvoiceTotals(inv);
  const biz = state.settings || {};
  const to = String(inv.customerEmail || "").trim();
  const bcc = String(biz.invoiceEmailBcc || "").trim();

  const subject = `${biz.businessName || "Invoice"} ${inv.number || ""}`.trim();
  const linkUrl = `${window.location.origin}${window.location.pathname}?invoice=${encodeURIComponent(inv.id)}`;

  const lines = [
    `Hi ${inv.customerName || ""},`.trim(),
    "",
    `Please find your invoice ${inv.number || ""} for ${money(totals.total)}.`.trim(),
    "",
    `You can view, print, or download your official invoice at any time by clicking your secure link below:`,
    linkUrl,
    "",
    String(biz.paymentInstructions || "").trim() ? `Payment: ${String(biz.paymentInstructions || "").trim()}` : "",
    "",
    (biz.email || biz.phone) ? `Questions? Reply to this email or contact us at ${[biz.email, biz.phone].filter(Boolean).join(" / ")}.` : "",
  ].filter((x) => x !== "");

  const body = lines.join("\n");
  return { to, bcc, subject, body };
}

function openEmailCompose({ to, bcc, subject, body }) {
  const enc = encodeURIComponent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const mailto = `mailto:${enc(to)}?bcc=${enc(bcc)}&subject=${enc(subject)}&body=${enc(body)}`;

  if (isMobile) {
    window.location.href = mailto;
    return;
  }

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${enc(to)}&bcc=${enc(bcc)}&su=${enc(subject)}&body=${enc(body)}`;
  const w = window.open(gmailUrl, "_blank", "noopener,noreferrer");
  if (!w) {
    window.location.href = mailto;
  }
}

function nextInvoiceIdAndNumber() {
  const num = parseNumber(state.settings.nextInvoiceNumber || 1);
  const prefix = state.settings.invoicePrefix || "INV-";
  const number = `${prefix}${String(num).padStart(3, "0")}`;
  state.settings.nextInvoiceNumber = num + 1;
  saveState(state);
  return { id: uid("inv"), number };
}

function renderDashboard() {
  const t = taskCounts();
  const i = invoiceCounts();
  const recentTasks = [...state.tasks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  const recentInvoices = [...state.invoices]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 6);

  appEl.innerHTML = `
    <div class="grid">
      <section class="card" style="grid-column: span 12;">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Dashboard</div>
            <div class="muted">A quick view of what’s in motion.</div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" id="quickAddTask" type="button">+ Task</button>
            <button class="btn btnPrimary" id="quickNewInvoice" type="button">+ Invoice</button>
          </div>
        </div>
        <div class="cardBody">
          <div class="grid">
            <div class="card col4">
              <div class="cardBody kpi">
                <div class="kpiValue">${t.todo}</div>
                <div class="kpiLabel">To do</div>
              </div>
            </div>
            <div class="card col4">
              <div class="cardBody kpi">
                <div class="kpiValue">${t.doing}</div>
                <div class="kpiLabel">In progress</div>
              </div>
            </div>
            <div class="card col4">
              <div class="cardBody kpi">
                <div class="kpiValue">${t.done}</div>
                <div class="kpiLabel">Done</div>
              </div>
            </div>
          </div>
          <div class="grid" style="margin-top:14px;">
            <div class="card col6">
              <div class="cardHeader">
                <div class="cardTitle">Recent tasks</div>
                <button class="btn btnGhost" id="goTasks" type="button">Open →</button>
              </div>
              <div class="cardBody">
                ${recentTasks.length ? renderMiniTasks(recentTasks) : `<div class="muted">No tasks yet.</div>`}
              </div>
            </div>
            <div class="card col6">
              <div class="cardHeader">
                <div class="cardTitle">Recent invoices</div>
                <button class="btn btnGhost" id="goInvoices" type="button">Open →</button>
              </div>
              <div class="cardBody">
                ${recentInvoices.length ? renderMiniInvoices(recentInvoices) : `<div class="muted">No invoices yet.</div>`}
              </div>
            </div>
          </div>
          <div class="row" style="margin-top:14px;">
            <span class="badge badgeGold">Invoices: Draft ${i.draft} • Sent ${i.sent} • Paid ${i.paid}</span>
            <span class="badge">Local-only data</span>
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("quickAddTask").addEventListener("click", () => openTaskEditor());
  document.getElementById("quickNewInvoice").addEventListener("click", () => openInvoiceEditor());
  document.getElementById("goTasks").addEventListener("click", () => setRoute("tasks"));
  document.getElementById("goInvoices").addEventListener("click", () => setRoute("invoices"));
}

function statusBadge(status) {
  if (status === "done" || status === "paid") return `<span class="badge badgeOk">${escapeHtml(status)}</span>`;
  if (status === "doing" || status === "sent") return `<span class="badge badgeGold">${escapeHtml(status)}</span>`;
  if (status === "void") return `<span class="badge badgeDanger">${escapeHtml(status)}</span>`;
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function renderMiniTasks(tasks) {
  return `
    <table class="table">
      <thead><tr><th>Title</th><th>Status</th><th>Due</th></tr></thead>
      <tbody>
        ${tasks
          .map(
            (t) => `<tr>
              <td>${escapeHtml(t.title || "(untitled)")}</td>
              <td>${statusBadge(t.status || "todo")}</td>
              <td>${escapeHtml(t.dueDate || "—")}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMiniInvoices(invoices) {
  return `
    <table class="table">
      <thead><tr><th>#</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead>
      <tbody>
        ${invoices
          .map((inv) => {
            const totals = calcInvoiceTotals(inv);
            return `<tr>
              <td>${escapeHtml(inv.number || "—")}</td>
              <td>${escapeHtml(inv.customerName || "—")}</td>
              <td>${statusBadge(inv.status || "draft")}</td>
              <td>${escapeHtml(money(totals.total))}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTasks() {
  const filtered = [...state.tasks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  appEl.innerHTML = `
    <div class="grid">
      <section class="card" style="grid-column: span 12;">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Tasks</div>
            <div class="muted">Track what needs doing, what’s in progress, and what’s done.</div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" id="addTask" type="button">+ New task</button>
          </div>
        </div>
        <div class="cardBody">
          <div class="row" style="justify-content:space-between; margin-bottom: 12px;">
            <div class="muted">${filtered.length} total</div>
            <div class="row">
              <button class="btn btnGhost" id="seedDemo" type="button">Add sample tasks</button>
              <button class="btn btnDanger" id="clearDone" type="button">Clear done</button>
            </div>
          </div>

          <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
            <div class="cardBody">
              ${filtered.length ? renderTaskTable(filtered) : `<div class="muted">No tasks yet. Click “New task”.</div>`}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("addTask").addEventListener("click", () => openTaskEditor());
  document.getElementById("seedDemo").addEventListener("click", () => {
    seedTasks();
    render();
  });
  document.getElementById("clearDone").addEventListener("click", async () => {
    const before = state.tasks.length;
    const toDelete = state.tasks.filter((t) => t.status === "done").map(t => t.id);
    if (toDelete.length > 0 && window.supabaseClient) {
      await supabaseClient.from('tasks').delete().in('id', toDelete);
    }
    state.tasks = state.tasks.filter((t) => t.status !== "done");
    if (state.tasks.length !== before) saveState(state);
    render();
  });

  appEl.querySelectorAll("[data-edit-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-task");
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      openTaskEditor(t);
    });
  });

  appEl.querySelectorAll("[data-delete-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-task");
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      if (!confirm(`Delete task "${t.title || "untitled"}"?`)) return;
      if (window.supabaseClient) {
        await supabaseClient.from('tasks').delete().eq('id', id);
      }
      state.tasks = state.tasks.filter((x) => x.id !== id);
      saveState(state);
      render();
    });
  });

  appEl.querySelectorAll("select[data-task-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.getAttribute("data-task-status");
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      t.status = sel.value;
      t.updatedAt = Date.now();
      saveState(state);
      render();
    });
  });
}

function renderTaskTable(tasks) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th style="width: 34%;">Task</th>
          <th style="width: 16%;">Status</th>
          <th style="width: 16%;">Due</th>
          <th style="width: 20%;">Customer / Job</th>
          <th style="width: 14%;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${tasks
          .map((t) => {
            const title = t.title || "(untitled)";
            const job = [t.customerName, t.jobName].filter(Boolean).join(" — ") || "—";
            return `<tr>
              <td>
                <div style="font-weight:800;">${escapeHtml(title)}</div>
                <div class="muted">${escapeHtml(t.notes || "")}</div>
              </td>
              <td>
                <select data-task-status="${escapeHtml(t.id)}" aria-label="Task status">
                  <option value="todo" ${t.status === "todo" ? "selected" : ""}>todo</option>
                  <option value="doing" ${t.status === "doing" ? "selected" : ""}>doing</option>
                  <option value="done" ${t.status === "done" ? "selected" : ""}>done</option>
                </select>
              </td>
              <td>${escapeHtml(t.dueDate || "—")}</td>
              <td>${escapeHtml(job)}</td>
              <td>
                <div class="row">
                  <button class="btn" data-edit-task="${escapeHtml(t.id)}" type="button">Edit</button>
                  <button class="btn btnDanger" data-delete-task="${escapeHtml(t.id)}" type="button">Delete</button>
                </div>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function openTaskEditor(task) {
  const isNew = !task;
  const t = task
    ? { ...task }
    : {
        id: uid("task"),
        title: "",
        status: "todo",
        dueDate: "",
        customerName: "",
        jobName: "",
        notes: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

  openModal({
    title: isNew ? "New task" : "Edit task",
    bodyHtml: `
      <div class="fields">
        <div class="field col12">
          <label for="t_title">Task title</label>
          <input id="t_title" value="${escapeHtml(t.title)}" placeholder="e.g., Engrave tumblers for Smith order" />
        </div>
        <div class="field col4">
          <label for="t_status">Status</label>
          <select id="t_status">
            <option value="todo" ${t.status === "todo" ? "selected" : ""}>todo</option>
            <option value="doing" ${t.status === "doing" ? "selected" : ""}>doing</option>
            <option value="done" ${t.status === "done" ? "selected" : ""}>done</option>
          </select>
        </div>
        <div class="field col4">
          <label for="t_due">Due date</label>
          <input id="t_due" type="date" value="${escapeHtml(t.dueDate)}" />
        </div>
        <div class="field col4">
          <label for="t_customer">Customer</label>
          <input id="t_customer" value="${escapeHtml(t.customerName)}" placeholder="Customer name" />
        </div>
        <div class="field col12">
          <label for="t_job">Job / order name (optional)</label>
          <input id="t_job" value="${escapeHtml(t.jobName)}" placeholder="e.g., 10x YETI 20oz (monograms)" />
        </div>
        <div class="field col12">
          <label for="t_notes">Notes</label>
          <textarea id="t_notes" placeholder="Materials, settings, proof notes, pickup details...">${escapeHtml(
            t.notes,
          )}</textarea>
        </div>
      </div>
    `,
    footerHtml: `
      <button class="btn" value="cancel" type="submit">Cancel</button>
      <button class="btn btnPrimary" id="saveTask" value="default" type="submit">Save</button>
    `,
    onReady: () => {
      const titleEl = document.getElementById("t_title");
      const statusEl = document.getElementById("t_status");
      const dueEl = document.getElementById("t_due");
      const customerEl = document.getElementById("t_customer");
      const jobEl = document.getElementById("t_job");
      const notesEl = document.getElementById("t_notes");

      const saveBtn = document.getElementById("saveTask");
      saveBtn.addEventListener("click", () => {
        t.title = titleEl.value.trim();
        t.status = statusEl.value;
        t.dueDate = dueEl.value;
        t.customerName = customerEl.value.trim();
        t.jobName = jobEl.value.trim();
        t.notes = notesEl.value.trim();
        t.updatedAt = Date.now();

        if (!t.title) {
          alert("Task title is required.");
          return;
        }

        const idx = state.tasks.findIndex((x) => x.id === t.id);
        if (idx >= 0) state.tasks[idx] = t;
        else state.tasks.unshift(t);
        saveState(state);
        closeModal();
        render();
      });

      titleEl.focus();
    },
  });
}

function seedTasks() {
  if (state.tasks.length) {
    if (!confirm("Add sample tasks? (This won’t delete existing tasks)")) return;
  }
  const now = Date.now();
  const samples = [
    { title: "Confirm customer design proof", status: "todo", dueDate: todayISO() },
    { title: "Order blanks/materials", status: "todo", dueDate: "" },
    { title: "Engrave batch (test piece first)", status: "doing", dueDate: "" },
    { title: "Pack & schedule pickup", status: "todo", dueDate: "" },
    { title: "Send invoice", status: "doing", dueDate: "" },
    { title: "Mark job complete", status: "done", dueDate: "" },
  ].map((s) => ({
    id: uid("task"),
    title: s.title,
    status: s.status,
    dueDate: s.dueDate,
    customerName: "",
    jobName: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
  }));
  state.tasks = [...samples, ...state.tasks];
  saveState(state);
}

function renderInvoices() {
  const invoices = [...state.invoices].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  appEl.innerHTML = `
    <div class="grid">
      <section class="card" style="grid-column: span 12;">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Invoices</div>
            <div class="muted">Create invoices, mark paid, and print/email from your browser.</div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" id="newInvoice" type="button">+ New invoice</button>
          </div>
        </div>
        <div class="cardBody">
          <div class="row" style="justify-content:space-between; margin-bottom: 12px;">
            <div class="muted">${invoices.length} total</div>
            <div class="row">
              <button class="btn btnGhost" id="seedInvoice" type="button">Add sample invoice</button>
              <button class="btn btnDanger" id="clearVoid" type="button">Clear void</button>
            </div>
          </div>

          <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
            <div class="cardBody">
              ${invoices.length ? renderInvoiceTable(invoices) : `<div class="muted">No invoices yet. Click “New invoice”.</div>`}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("newInvoice").addEventListener("click", () => openInvoiceEditor());
  document.getElementById("seedInvoice").addEventListener("click", () => {
    seedInvoice();
    render();
  });
  document.getElementById("clearVoid").addEventListener("click", async () => {
    const before = state.invoices.length;
    const toDelete = state.invoices.filter((inv) => inv.status === "void").map(inv => inv.id);
    if (toDelete.length > 0 && window.supabaseClient) {
      await supabaseClient.from('invoices').delete().in('id', toDelete);
    }
    state.invoices = state.invoices.filter((inv) => inv.status !== "void");
    if (state.invoices.length !== before) saveState(state);
    render();
  });

  appEl.querySelectorAll("[data-edit-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-invoice");
      const inv = state.invoices.find((x) => x.id === id);
      if (!inv) return;
      openInvoiceEditor(inv);
    });
  });
  appEl.querySelectorAll("[data-print-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-print-invoice");
      const inv = state.invoices.find((x) => x.id === id);
      if (!inv) return;
      openInvoicePrint(inv);
    });
  });
  appEl.querySelectorAll("[data-delete-invoice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-invoice");
      const inv = state.invoices.find((x) => x.id === id);
      if (!inv) return;
      if (!confirm(`Delete invoice ${inv.number || ""}?`)) return;
      if (window.supabaseClient) {
        await supabaseClient.from('invoices').delete().eq('id', id);
      }
      state.invoices = state.invoices.filter((x) => x.id !== id);
      saveState(state);
      render();
    });
  });
}

function renderInvoiceTable(invoices) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th style="width: 16%;">Invoice</th>
          <th style="width: 22%;">Customer</th>
          <th style="width: 14%;">Date</th>
          <th style="width: 14%;">Status</th>
          <th style="width: 14%;">Total</th>
          <th style="width: 20%;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${invoices
          .map((inv) => {
            const totals = calcInvoiceTotals(inv);
            return `<tr>
              <td>
                <div style="font-weight:900;">${escapeHtml(inv.number || "—")}</div>
                <div class="muted">${escapeHtml(inv.title || "")}</div>
              </td>
              <td>${escapeHtml(inv.customerName || "—")}</td>
              <td>${escapeHtml(inv.issueDate || "—")}</td>
              <td>${statusBadge(inv.status || "draft")}</td>
              <td>${escapeHtml(money(totals.total))}</td>
              <td>
                <div class="row">
                  <button class="btn" data-edit-invoice="${escapeHtml(inv.id)}" type="button">Edit</button>
                  <button class="btn" data-print-invoice="${escapeHtml(inv.id)}" type="button">Print</button>
                  <button class="btn btnDanger" data-delete-invoice="${escapeHtml(inv.id)}" type="button">Delete</button>
                </div>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function openInvoiceEditor(invoice) {
  const isNew = !invoice;
  const base = isNew
    ? (() => {
        const { id, number } = nextInvoiceIdAndNumber();
        const issueDate = todayISO();
        return {
          id,
          number,
          title: "Laser engraving",
          status: "draft",
          issueDate,
          dueDate: addDaysISO(issueDate, 30),
          customerName: "",
          customerEmail: "",
          customerPhone: "",
          customerAddress: "",
          items: [{ id: uid("item"), desc: "Engraving", qty: 1, rate: 0 }],
          discount: 0,
          taxRate: state.settings.taxRate || 0,
          paymentTerms: state.settings.paymentTerms || "Due on receipt",
          notes: state.settings.notesDefault || "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      })()
    : { ...invoice, items: (invoice.items || []).map((it) => ({ ...it })) };

  const totals = calcInvoiceTotals(base);

  openModal({
    title: isNew ? `New invoice (${base.number})` : `Edit invoice (${base.number || ""})`,
    bodyHtml: `
      <div class="split">
        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
          <div class="cardHeader">
            <div class="cardTitle">Invoice details</div>
            <div>${statusBadge(base.status || "draft")}</div>
          </div>
          <div class="cardBody">
            <div class="fields">
              <div class="field col6">
                <label for="inv_title">Title</label>
                <input id="inv_title" value="${escapeHtml(base.title || "")}" placeholder="e.g., Custom YETI engraving" />
              </div>
              <div class="field col6">
                <label for="inv_status">Status</label>
                <select id="inv_status">
                  <option value="draft" ${base.status === "draft" ? "selected" : ""}>draft</option>
                  <option value="sent" ${base.status === "sent" ? "selected" : ""}>sent</option>
                  <option value="paid" ${base.status === "paid" ? "selected" : ""}>paid</option>
                  <option value="void" ${base.status === "void" ? "selected" : ""}>void</option>
                </select>
              </div>

              <div class="field col3">
                <label for="inv_issue">Issue date</label>
                <input id="inv_issue" type="date" value="${escapeHtml(base.issueDate || "")}" />
              </div>
              <div class="field col3">
                <label for="inv_due">Due date</label>
                <input id="inv_due" type="date" value="${escapeHtml(base.dueDate || "")}" />
              </div>
              <div class="field col3">
                <label for="inv_tax">Tax rate (%)</label>
                <input id="inv_tax" inputmode="decimal" value="${escapeHtml(String(base.taxRate ?? 0))}" />
              </div>
              <div class="field col3">
                <label for="inv_discount">Discount ($)</label>
                <input id="inv_discount" inputmode="decimal" value="${escapeHtml(String(base.discount ?? 0))}" />
              </div>

              <div class="field col12">
                <label>Line items</label>
                <div class="card" style="box-shadow:none; background:rgba(0,0,0,.18); border:1px solid rgba(255,255,255,.10);">
                  <div class="cardBody">
                    <div id="items"></div>
                    <div class="row" style="justify-content:space-between; margin-top:10px;">
                      <button class="btn" id="addItem" type="button">+ Add item</button>
                      <div class="badge badgeGold" id="subtotalBadge">Subtotal ${escapeHtml(money(totals.subtotal))}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="field col12">
                <label for="inv_terms">Payment terms</label>
                <input id="inv_terms" value="${escapeHtml(base.paymentTerms || "")}" />
              </div>
              <div class="field col12">
                <label for="inv_notes">Notes</label>
                <textarea id="inv_notes" placeholder="Notes shown on invoice...">${escapeHtml(base.notes || "")}</textarea>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
          <div class="cardHeader">
            <div class="cardTitle">Customer</div>
            <button class="btn" id="previewInvoice" type="button">Preview</button>
          </div>
          <div class="cardBody">
            <div class="fields">
              <div class="field col12">
                <label for="c_name">Name</label>
                <input id="c_name" value="${escapeHtml(base.customerName || "")}" placeholder="Customer name" />
              </div>
              <div class="field col6">
                <label for="c_email">Email</label>
                <input id="c_email" value="${escapeHtml(base.customerEmail || "")}" placeholder="email@example.com" />
              </div>
              <div class="field col6">
                <label for="c_phone">Phone</label>
                <input id="c_phone" value="${escapeHtml(base.customerPhone || "")}" placeholder="(555) 555-5555" />
              </div>
              <div class="field col12">
                <label for="c_addr">Address</label>
                <textarea id="c_addr" placeholder="Customer address...">${escapeHtml(base.customerAddress || "")}</textarea>
              </div>
            </div>

            <div class="card" style="box-shadow:none; margin-top:12px; background: rgba(0,0,0,.18); border:1px solid rgba(255,255,255,.10);">
              <div class="cardBody">
                <div class="row" style="justify-content:space-between;">
                  <div class="muted">Totals</div>
                  <div class="badge badgeGold" id="grandTotal">${escapeHtml(money(totals.total))}</div>
                </div>
                <div class="row" style="justify-content:space-between; margin-top:8px;">
                  <div class="muted">Tax</div>
                  <div class="muted" id="taxLine">${escapeHtml(money(totals.tax))}</div>
                </div>
                <div class="row" style="justify-content:space-between; margin-top:6px;">
                  <div class="muted">Discount</div>
                  <div class="muted" id="discountLine">-${escapeHtml(money(totals.discount))}</div>
                </div>
                <div class="row" style="justify-content:space-between; margin-top:6px;">
                  <div class="muted">Subtotal</div>
                  <div class="muted" id="subtotalLine">${escapeHtml(money(totals.subtotal))}</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    `,
    footerHtml: `
      <button class="btn" value="cancel" type="submit">Cancel</button>
      <button class="btn" id="saveDraft" value="default" type="submit">Save</button>
      <button class="btn" id="saveAndEmail" value="default" type="submit">Save & Email</button>
      <button class="btn btnPrimary" id="saveAndPrint" value="default" type="submit">Save & Print</button>
    `,
    onReady: () => {
      const els = {
        title: document.getElementById("inv_title"),
        status: document.getElementById("inv_status"),
        issue: document.getElementById("inv_issue"),
        due: document.getElementById("inv_due"),
        tax: document.getElementById("inv_tax"),
        discount: document.getElementById("inv_discount"),
        terms: document.getElementById("inv_terms"),
        notes: document.getElementById("inv_notes"),
        cName: document.getElementById("c_name"),
        cEmail: document.getElementById("c_email"),
        cPhone: document.getElementById("c_phone"),
        cAddr: document.getElementById("c_addr"),
        items: document.getElementById("items"),
        grandTotal: document.getElementById("grandTotal"),
        subtotalLine: document.getElementById("subtotalLine"),
        taxLine: document.getElementById("taxLine"),
        discountLine: document.getElementById("discountLine"),
      };

      function renderItems() {
        els.items.innerHTML = base.items
          .map(
            (it, idx) => `
              <div class="fields" style="margin-bottom:10px;" data-item="${escapeHtml(it.id)}">
                <div class="field col6">
                  <label>Description</label>
                  <input data-it-desc value="${escapeHtml(it.desc || "")}" placeholder="e.g., Engrave 20oz tumbler" />
                </div>
                <div class="field col2">
                  <label>Qty</label>
                  <input data-it-qty inputmode="decimal" value="${escapeHtml(String(it.qty ?? 1))}" />
                </div>
                <div class="field col2">
                  <label>Rate</label>
                  <input data-it-rate inputmode="decimal" value="${escapeHtml(String(it.rate ?? 0))}" />
                </div>
                <div class="field col2">
                  <label>Line total</label>
                  <input data-it-total value="${escapeHtml(money(parseNumber(it.qty) * parseNumber(it.rate)))}" disabled />
                </div>
                <div class="col12 row" style="justify-content:flex-end; margin-top:4px;">
                  <button class="btn btnDanger" data-it-remove="${escapeHtml(it.id)}" type="button">Remove</button>
                </div>
              </div>
            `,
          )
          .join("");

        els.items.querySelectorAll("[data-it-remove]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-it-remove");
            base.items = base.items.filter((x) => x.id !== id);
            if (!base.items.length) base.items = [{ id: uid("item"), desc: "", qty: 1, rate: 0 }];
            renderItems();
            recalcTotals();
          });
        });

        els.items.querySelectorAll("[data-item]").forEach((row) => {
          const id = row.getAttribute("data-item");
          const it = base.items.find((x) => x.id === id);
          if (!it) return;
          const desc = row.querySelector("[data-it-desc]");
          const qty = row.querySelector("[data-it-qty]");
          const rate = row.querySelector("[data-it-rate]");
          const lineTotal = row.querySelector("[data-it-total]");
          const onChange = () => {
            it.desc = desc.value;
            it.qty = parseNumber(qty.value);
            it.rate = parseNumber(rate.value);
            if (lineTotal) lineTotal.value = money(parseNumber(it.qty) * parseNumber(it.rate));
            recalcTotals();
          };
          desc.addEventListener("input", onChange);
          qty.addEventListener("input", onChange);
          rate.addEventListener("input", onChange);

          // Make the default qty ("1") easy to replace: tapping/clicking selects it.
          // Works for mouse, keyboard (tab), and mobile touch.
          qty.addEventListener("focus", () => setTimeout(() => qty.select(), 0));
          qty.addEventListener("pointerdown", () => setTimeout(() => qty.select(), 0));

          // Make the default rate ("0") easy to replace as well.
          rate.addEventListener("focus", () => setTimeout(() => rate.select(), 0));
          rate.addEventListener("pointerdown", () => setTimeout(() => rate.select(), 0));
        });
      }

      function recalcTotals() {
        base.taxRate = parseNumber(els.tax.value);
        base.discount = parseNumber(els.discount.value);
        const t = calcInvoiceTotals(base);
        els.grandTotal.textContent = money(t.total);
        els.subtotalLine.textContent = money(t.subtotal);
        els.taxLine.textContent = money(t.tax);
        els.discountLine.textContent = `-${money(t.discount)}`;
        const subtotalBadge = document.getElementById("subtotalBadge");
        if (subtotalBadge) subtotalBadge.textContent = `Subtotal ${money(t.subtotal)}`;
      }

      document.getElementById("addItem").addEventListener("click", () => {
        const newItem = { id: uid("item"), desc: "", qty: 1, rate: 0 };
        base.items.push(newItem);
        renderItems();
        recalcTotals();
        const qtyEl = els.items.querySelector(`[data-item="${CSS.escape(newItem.id)}"] [data-it-qty]`);
        if (qtyEl) qtyEl.focus();
      });

      let lastIssue = base.issueDate || "";
      els.issue.addEventListener("input", () => {
        const nextIssue = els.issue.value;
        const currentDue = els.due.value;
        const prevDefaultDue = addDaysISO(lastIssue, 30);
        if (!currentDue || currentDue === prevDefaultDue) {
          const nextDue = addDaysISO(nextIssue, 30);
          if (nextDue) els.due.value = nextDue;
        }
        lastIssue = nextIssue;
      });

      document.getElementById("previewInvoice").addEventListener("click", () => {
        const inv = captureInvoiceFromForm(base, els);
        openInvoicePrint(inv, { showBack: true });
      });

      function doSave({ printAfter, emailAfter }) {
        const inv = captureInvoiceFromForm(base, els);
        if (!inv.customerName) {
          alert("Customer name is required.");
          return;
        }
        if (!inv.items.some((it) => (it.desc || "").trim())) {
          alert("Add at least one line item description.");
          return;
        }

        const idx = state.invoices.findIndex((x) => x.id === inv.id);
        if (idx >= 0) state.invoices[idx] = inv;
        else state.invoices.unshift(inv);
        saveState(state);
        closeModal();
        if (printAfter) openInvoicePrint(inv);
        else render();

        if (emailAfter) {
          const { to, bcc, subject, body } = buildInvoiceEmail(inv);
          if (!to) {
            alert("Saved. Customer email is blank, so the email composer could not be opened.");
            return;
          }
          openEmailCompose({ to, bcc, subject, body });
        }
      }

      document.getElementById("saveDraft").addEventListener("click", () => doSave({ printAfter: false }));
      document.getElementById("saveAndEmail").addEventListener("click", () => doSave({ printAfter: false, emailAfter: true }));
      document.getElementById("saveAndPrint").addEventListener("click", () => doSave({ printAfter: true }));

      els.tax.addEventListener("input", recalcTotals);
      els.discount.addEventListener("input", recalcTotals);

      renderItems();
      recalcTotals();
      els.cName.focus();
    },
  });
}

function captureInvoiceFromForm(base, els) {
  const inv = { ...base };
  inv.title = els.title.value.trim();
  inv.status = els.status.value;
  inv.issueDate = els.issue.value;
  inv.dueDate = els.due.value;
  inv.taxRate = parseNumber(els.tax.value);
  inv.discount = parseNumber(els.discount.value);
  inv.paymentTerms = els.terms.value.trim();
  inv.notes = els.notes.value.trim();
  inv.customerName = els.cName.value.trim();
  inv.customerEmail = els.cEmail.value.trim();
  inv.customerPhone = els.cPhone.value.trim();
  inv.customerAddress = els.cAddr.value.trim();
  inv.items = (inv.items || []).map((it) => ({
    id: it.id || uid("item"),
    desc: String(it.desc || "").trim(),
    qty: parseNumber(it.qty),
    rate: parseNumber(it.rate),
  }));
  inv.updatedAt = Date.now();
  return inv;
}

function openInvoicePrint(inv, opts = {}) {
  const totals = calcInvoiceTotals(inv);
  const biz = state.settings;
  const showBack = !!opts.showBack;

  const bizAddr = [biz.address, biz.phone, biz.email].filter(Boolean).join("\n");
  const custAddr = [inv.customerAddress, inv.customerPhone, inv.customerEmail].filter(Boolean).join("\n");
  const issueMDY = formatDateMDY(inv.issueDate || "");
  const dueMDY = formatDateMDY(inv.dueDate || "");
  const billToLine = [inv.customerName, custAddr].filter(Boolean).join("\n");
  const paymentLine = String(biz.paymentInstructions || "").trim();
  const contactName = biz.businessName || "CC Custom Engraving";
  const contactLine = [biz.email, biz.phone].filter(Boolean).join(" or ");

  openModal({
    title: `Invoice ${inv.number || ""}`,
    bodyHtml: `
      <div class="printArea" id="printArea">
        <div style="text-align:center; margin-bottom: 12px;">
          <div style="font-weight:900; font-size: 22px; letter-spacing: .4px;">Invoice</div>
          <div class="printMuted" style="font-weight:700;">Official Billing Statement</div>
        </div>

        <div class="printHeader">
          <div class="printBrand">
            <img src="./assets/logo.png" alt="${escapeHtml(biz.businessName || "Business")}" />
            <div>
              <h1 class="printH1">${escapeHtml(biz.businessName || "Business")}</h1>
              <div class="printMuted" style="white-space:pre-wrap;">${escapeHtml(bizAddr || "")}</div>
            </div>
          </div>
          <div class="printBox" style="min-width: 320px;">
            <div class="printMuted"><b>Invoice Number</b> ${escapeHtml(inv.number || "")}</div>
            <div class="printMuted"><b>Invoice Date</b> ${escapeHtml(issueMDY || "")}</div>
            <div class="printMuted"><b>Bill To</b> <span style="white-space:pre-wrap;">${escapeHtml(billToLine || "")}</span></div>
            <div class="printMuted"><b>Due Date</b> ${escapeHtml(dueMDY || "")}</div>
          </div>
        </div>

        <div style="margin-top: 12px; font-weight: 900;">Itemized Charges</div>

        <table class="printTable">
          <thead>
            <tr>
              <th>Description</th>
              <th style="width:90px;">Qty</th>
              <th style="width:120px;">Unit Price</th>
              <th style="width:120px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(inv.items || [])
              .map((it) => {
                const amount = parseNumber(it.qty) * parseNumber(it.rate);
                return `<tr>
                  <td>${escapeHtml(it.desc || "")}</td>
                  <td>${escapeHtml(String(it.qty ?? 0))}</td>
                  <td>${escapeHtml(money(parseNumber(it.rate)))}</td>
                  <td>${escapeHtml(money(amount))}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>

        <div class="printTotals">
          <table>
            <tr><td>Subtotal</td><td>${escapeHtml(money(totals.subtotal))}</td></tr>
            <tr><td>Tax</td><td>${escapeHtml(money(totals.tax))}</td></tr>
            <tr><td>Total Due</td><td>${escapeHtml(money(totals.total))}</td></tr>
          </table>
        </div>

        <div class="printBox" style="margin-top: 12px;">
          <div class="printMuted" style="white-space:pre-wrap;">${escapeHtml(inv.notes || "")}</div>
          ${paymentLine ? `<div class="printMuted" style="margin-top:8px;">${escapeHtml(paymentLine)}</div>` : ""}
          ${
            contactLine
              ? `<div class="printMuted" style="margin-top:8px;">
                  If you have any questions concerning this invoice, kindly contact ${escapeHtml(contactName)} at ${escapeHtml(
                    contactLine,
                  )}.
                </div>`
              : ""
          }
        </div>
      </div>
    `,
    footerHtml: `
      ${showBack ? `<button class="btn" id="backToEditor" value="default" type="submit">Back</button>` : ""}
      <button class="btn" id="markPaid" value="default" type="submit">Mark paid</button>
      <button class="btn" id="emailInvoice" value="default" type="submit">Email</button>
      <button class="btn btnPrimary" id="doPrint" value="default" type="submit">Print / Save PDF</button>
    `,
    onReady: () => {
      if (showBack) {
        document.getElementById("backToEditor").addEventListener("click", () => {
          closeModal();
          const current = state.invoices.find((x) => x.id === inv.id) || inv;
          openInvoiceEditor(current);
        });
      }

      document.getElementById("doPrint").addEventListener("click", () => {
        closeModal();
        renderPrintOnly(inv);
        window.print();
        render();
      });

      document.getElementById("emailInvoice").addEventListener("click", () => {
        const { to, bcc, subject, body } = buildInvoiceEmail(inv);
        if (!to) {
          alert("Customer email is blank. Add an email on the invoice, then try again.");
          return;
        }
        openEmailCompose({ to, bcc, subject, body });
      });

      document.getElementById("markPaid").addEventListener("click", () => {
        const stored = state.invoices.find((x) => x.id === inv.id);
        if (stored) {
          stored.status = "paid";
          stored.updatedAt = Date.now();
          saveState(state);
        }
        closeModal();
        render();
      });
    },
  });
}

function renderPrintOnly(inv) {
  const totals = calcInvoiceTotals(inv);
  const biz = state.settings;
  const bizAddr = [biz.address, biz.phone, biz.email].filter(Boolean).join("\n");
  const custAddr = [inv.customerAddress, inv.customerPhone, inv.customerEmail].filter(Boolean).join("\n");
  const issueMDY = formatDateMDY(inv.issueDate || "");
  const dueMDY = formatDateMDY(inv.dueDate || "");
  const billToLine = [inv.customerName, custAddr].filter(Boolean).join("\n");
  const paymentLine = String(biz.paymentInstructions || "").trim();
  const contactName = biz.businessName || "CC Custom Engraving";
  const contactLine = [biz.email, biz.phone].filter(Boolean).join(" or ");

  appEl.innerHTML = `
    <div class="printOnly">
      <div class="printArea">
        <div style="text-align:center; margin-bottom: 12px;">
          <div style="font-weight:900; font-size: 22px; letter-spacing: .4px;">Invoice</div>
          <div class="printMuted" style="font-weight:700;">Official Billing Statement</div>
        </div>

        <div class="printHeader">
          <div class="printBrand">
            <img src="./assets/logo.png" alt="${escapeHtml(biz.businessName || "Business")}" />
            <div>
              <h1 class="printH1">${escapeHtml(biz.businessName || "Business")}</h1>
              <div class="printMuted" style="white-space:pre-wrap;">${escapeHtml(bizAddr || "")}</div>
            </div>
          </div>
          <div class="printBox" style="min-width: 320px;">
            <div class="printMuted"><b>Invoice Number</b> ${escapeHtml(inv.number || "")}</div>
            <div class="printMuted"><b>Invoice Date</b> ${escapeHtml(issueMDY || "")}</div>
            <div class="printMuted"><b>Bill To</b> <span style="white-space:pre-wrap;">${escapeHtml(billToLine || "")}</span></div>
            <div class="printMuted"><b>Due Date</b> ${escapeHtml(dueMDY || "")}</div>
          </div>
        </div>

        <div style="margin-top: 12px; font-weight: 900;">Itemized Charges</div>
        <table class="printTable">
          <thead><tr><th>Description</th><th style="width:90px;">Quantity</th><th style="width:120px;">Unit Price</th><th style="width:120px;">Total</th></tr></thead>
          <tbody>
            ${(inv.items || [])
              .map((it) => {
                const amount = parseNumber(it.qty) * parseNumber(it.rate);
                return `<tr>
                  <td>${escapeHtml(it.desc || "")}</td>
                  <td>${escapeHtml(String(it.qty ?? 0))}</td>
                  <td>${escapeHtml(money(parseNumber(it.rate)))}</td>
                  <td>${escapeHtml(money(amount))}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
        <div class="printTotals">
          <table>
            <tr><td>Subtotal</td><td>${escapeHtml(money(totals.subtotal))}</td></tr>
            <tr><td>Tax</td><td>${escapeHtml(money(totals.tax))}</td></tr>
            <tr><td>Total Due</td><td>${escapeHtml(money(totals.total))}</td></tr>
          </table>
        </div>
        <div class="printBox" style="margin-top: 12px;">
          <div class="printMuted" style="white-space:pre-wrap;">${escapeHtml(inv.notes || "")}</div>
          ${paymentLine ? `<div class="printMuted" style="margin-top:8px;">${escapeHtml(paymentLine)}</div>` : ""}
          ${
            contactLine
              ? `<div class="printMuted" style="margin-top:8px;">
                  If you have any questions concerning this invoice, kindly contact ${escapeHtml(contactName)} at ${escapeHtml(
                    contactLine,
                  )}.
                </div>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function seedInvoice() {
  if (state.invoices.length) {
    if (!confirm("Add a sample invoice? (This won’t delete existing invoices)")) return;
  }
  const { id, number } = nextInvoiceIdAndNumber();
  const inv = {
    id,
    number,
    title: "Custom engraved tumbler (10x)",
    status: "sent",
    issueDate: todayISO(),
    dueDate: "",
    customerName: "Sample Customer",
    customerEmail: "customer@example.com",
    customerPhone: "",
    customerAddress: "",
    items: [
      { id: uid("item"), desc: "Engrave 20oz tumbler", qty: 10, rate: 12.5 },
      { id: uid("item"), desc: "One-time setup / artwork", qty: 1, rate: 25 },
    ],
    discount: 0,
    taxRate: state.settings.taxRate || 0,
    paymentTerms: state.settings.paymentTerms || "Due on receipt",
    notes: state.settings.notesDefault || "Thank you for your business!",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.invoices.unshift(inv);
  saveState(state);
}

function renderSettings() {
  const s = state.settings;
  appEl.innerHTML = `
    <div class="grid">
      <section class="card" style="grid-column: span 12;">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Settings</div>
            <div class="muted">Business details, invoice numbering, and backups.</div>
          </div>
          <div class="row">
            <button class="btn btnDanger" id="resetAll" type="button">Reset all data</button>
          </div>
        </div>
        <div class="cardBody">
          <div class="split">
            <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
              <div class="cardHeader"><div class="cardTitle">Business</div></div>
              <div class="cardBody">
                <div class="fields">
                  <div class="field col12">
                    <label for="biz_name">Business name</label>
                    <input id="biz_name" value="${escapeHtml(s.businessName || "")}" />
                  </div>
                  <div class="field col6">
                    <label for="biz_phone">Phone</label>
                    <input id="biz_phone" value="${escapeHtml(s.phone || "")}" />
                  </div>
                  <div class="field col6">
                    <label for="biz_email">Email</label>
                    <input id="biz_email" value="${escapeHtml(s.email || "")}" />
                  </div>
                  <div class="field col12">
                    <label for="biz_address">Address</label>
                    <textarea id="biz_address" placeholder="Shown on invoice...">${escapeHtml(s.address || "")}</textarea>
                  </div>
                </div>
                <div class="row" style="margin-top:12px; justify-content:flex-end;">
                  <button class="btn btnPrimary" id="saveBiz" type="button">Save</button>
                </div>
              </div>
            </div>

            <div class="card" style="box-shadow:none; background:rgba(255,255,255,.03);">
              <div class="cardHeader"><div class="cardTitle">Invoices</div></div>
              <div class="cardBody">
                <div class="fields">
                  <div class="field col4">
                    <label for="inv_prefix">Invoice prefix</label>
                    <input id="inv_prefix" value="${escapeHtml(s.invoicePrefix || "")}" />
                  </div>
                  <div class="field col4">
                    <label for="inv_next">Next invoice number</label>
                    <input id="inv_next" inputmode="numeric" value="${escapeHtml(String(s.nextInvoiceNumber ?? 1))}" />
                  </div>
                  <div class="field col4">
                    <label for="inv_tax_default">Default tax rate (%)</label>
                    <input id="inv_tax_default" inputmode="decimal" value="${escapeHtml(String(s.taxRate ?? 0))}" />
                  </div>
                  <div class="field col12">
                    <label for="inv_terms_default">Default payment terms</label>
                    <input id="inv_terms_default" value="${escapeHtml(s.paymentTerms || "")}" />
                  </div>
                  <div class="field col12">
                    <label for="inv_notes_default">Default notes</label>
                    <textarea id="inv_notes_default">${escapeHtml(s.notesDefault || "")}</textarea>
                  </div>
                  <div class="field col12">
                    <label for="inv_email_bcc">Invoice email BCC (send yourself a copy)</label>
                    <input id="inv_email_bcc" value="${escapeHtml(s.invoiceEmailBcc || "")}" placeholder="clc571@gmail.com" />
                  </div>
                </div>
                <div class="row" style="margin-top:12px; justify-content:flex-end;">
                  <button class="btn btnPrimary" id="saveInvSettings" type="button">Save</button>
                </div>
              </div>
            </div>
          </div>

          <div class="card" style="box-shadow:none; margin-top:14px; background:rgba(255,255,255,.03);">
            <div class="cardHeader">
              <div class="cardTitle">Backup</div>
              <div class="muted">Export or import your data.</div>
            </div>
            <div class="cardBody">
              <div class="row">
                <button class="btn btnPrimary" id="exportData" type="button">Export JSON</button>
                <button class="btn" id="importData" type="button">Import JSON</button>
              </div>
              <div class="muted" style="margin-top:10px;">
                Tip: If you’ll use this on multiple devices, export from one and import on the other.
              </div>
            </div>
          </div>

          <div class="card" style="box-shadow:none; margin-top:14px; background:rgba(255,255,255,.03);">
            <div class="cardHeader"><div class="cardTitle">Wix hosting options</div></div>
            <div class="cardBody">
              <div class="muted">
                This app is static (no server). You can host it anywhere and embed it into Wix using an iFrame / Embed.
                You can also publish it via a static host (GitHub Pages, Netlify, etc.) and then embed the URL in Wix.
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  `;

  document.getElementById("saveBiz").addEventListener("click", () => {
    state.settings.businessName = document.getElementById("biz_name").value.trim() || "CC Custom Engraving";
    state.settings.phone = document.getElementById("biz_phone").value.trim();
    state.settings.email = document.getElementById("biz_email").value.trim();
    state.settings.address = document.getElementById("biz_address").value.trim();
    saveState(state);
    render();
  });

  document.getElementById("saveInvSettings").addEventListener("click", () => {
    state.settings.invoicePrefix = document.getElementById("inv_prefix").value.trim() || "INV-";
    state.settings.nextInvoiceNumber = Math.max(1, parseInt(document.getElementById("inv_next").value || "1", 10));
    state.settings.taxRate = parseNumber(document.getElementById("inv_tax_default").value);
    state.settings.paymentTerms = document.getElementById("inv_terms_default").value.trim();
    state.settings.notesDefault = document.getElementById("inv_notes_default").value.trim();
    state.settings.invoiceEmailBcc = document.getElementById("inv_email_bcc").value.trim();
    saveState(state);
    render();
  });

  document.getElementById("exportData").addEventListener("click", () => exportJson());
  document.getElementById("importData").addEventListener("click", () => importJson());

  document.getElementById("resetAll").addEventListener("click", async () => {
    if (!confirm("Reset ALL tasks and invoices? This cannot be undone.")) return;
    if (window.supabaseClient) {
      const allTaskIds = state.tasks.map(t => t.id);
      const allInvIds = state.invoices.map(inv => inv.id);
      if (allTaskIds.length > 0) await supabaseClient.from('tasks').delete().in('id', allTaskIds);
      if (allInvIds.length > 0) await supabaseClient.from('invoices').delete().in('id', allInvIds);
    }
    localStorage.removeItem(APP_STORAGE_KEY);
    state = loadState();
    render();
  });
}

function exportJson() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cc-custom-engraving-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
      state = {
        meta: { createdAt: Date.now(), updatedAt: Date.now() },
        settings: { ...state.settings, ...(parsed.settings || {}) },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      };
      saveState(state);
      render();
      alert("Import complete.");
    } catch (e) {
      alert(`Import failed: ${e?.message || e}`);
    }
  });
  input.click();
}

function render() {
  if (route === "dashboard") renderDashboard();
  else if (route === "tasks") renderTasks();
  else if (route === "invoices") renderInvoices();
  else renderSettings();
}

async function renderPublicInvoice(invoiceId) {
  const topbar = document.querySelector(".topbar");
  const footer = document.querySelector(".footer");
  if (topbar) topbar.style.display = "none";
  if (footer) footer.style.display = "none";

  appEl.innerHTML = '<div style="padding: 40px; text-align: center;">Loading invoice...</div>';

  if (!window.supabaseClient) {
    appEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #ff4444;">Database connection error.</div>';
    return;
  }

  try {
    const [invRes, setRes] = await Promise.all([
      window.supabaseClient.from('invoices').select('*').eq('id', invoiceId).single(),
      window.supabaseClient.from('settings').select('*').eq('id', 1).single()
    ]);

    if (!invRes.data) throw new Error("Invoice not found.");
    
    if (setRes.data) {
      state.settings = { ...state.settings, ...setRes.data };
    }

    const inv = invRes.data;

    renderPrintOnly(inv);

    const actionRow = document.createElement('div');
    actionRow.className = 'row';
    actionRow.style.justifyContent = 'center';
    actionRow.style.marginBottom = '20px';
    actionRow.innerHTML = `<button class="btn btnPrimary" onclick="window.print()">Print / Save as PDF</button>`;
    
    appEl.insertBefore(actionRow, appEl.firstChild);

  } catch (err) {
    console.error(err);
    appEl.innerHTML = '<div style="padding: 40px; text-align: center; color: #ff4444;">Invoice not found or could not be loaded.</div>';
  }
}


function renderGuestApp() {
  document.querySelector(".tabs").style.display = "none";
  appEl.innerHTML = `
    <div class="grid" style="margin-top: 20px;">
      <section class="card" style="grid-column: span 12; max-width: 600px; margin: 0 auto; width: 100%;">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">New Engraving Order</div>
            <div class="muted">Submit your order details directly to our system.</div>
          </div>
          <button class="btn btnGhost" id="guestLogout" style="font-size: 12px; padding: 6px 10px;">Logout</button>
        </div>
        <div class="cardBody">
          <div class="fields">
            <div class="field col12">
              <label for="g_customer">Customer / Organization Name</label>
              <input id="g_customer" value="Sweetwater IT" />
            </div>
            <div class="field col6">
              <label for="g_contact">Contact Name</label>
              <input id="g_contact" value="Chelsi Prince" />
            </div>
            <div class="field col6">
              <label for="g_contactInfo">Contact Info (Phone/Email)</label>
              <input id="g_contactInfo" value="(260) 432 - 8176 ext 2180" />
            </div>
            <div class="field col8">
              <label for="g_type">Type of Order</label>
              <input id="g_type" placeholder="e.g. New Hire Tumbler Engraving" />
            </div>
            <div class="field col4">
              <label for="g_qty">Quantity</label>
              <input id="g_qty" type="number" inputmode="numeric" value="1" />
            </div>
            <div class="field col12">
              <label for="g_names">Name(s) on Tumblers</label>
              <textarea id="g_names" placeholder="List the names exactly as they should be engraved..."></textarea>
            </div>
            <div class="field col12">
              <label for="g_notes">Special Notes</label>
              <textarea id="g_notes" placeholder="Any other details or instructions..."></textarea>
            </div>
          </div>
          <div class="row" style="margin-top: 20px; justify-content: flex-end;">
             <button class="btn btnPrimary" id="submitGuestOrder">Submit Order</button>
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("guestLogout").addEventListener("click", () => {
    sessionStorage.removeItem("authPin");
    window.location.reload();
  });

  document.getElementById("submitGuestOrder").addEventListener("click", async () => {
    const btn = document.getElementById("submitGuestOrder");
    const cust = document.getElementById("g_customer").value.trim();
    const contact = document.getElementById("g_contact").value.trim();
    const info = document.getElementById("g_contactInfo").value.trim();
    const type = document.getElementById("g_type").value.trim();
    const qty = document.getElementById("g_qty").value.trim();
    const names = document.getElementById("g_names").value.trim();
    const notes = document.getElementById("g_notes").value.trim();

    if (!type) {
      alert("Please enter the Type of Order.");
      return;
    }

    const compiledNotes = `Contact: ${contact} (${info})\nQuantity: ${qty}\n\nNames to engrave:\n${names}\n\nNotes:\n${notes}`;

    const t = {
      id: uid("task"),
      title: `[New Order] ${type}`,
      status: "todo",
      dueDate: "",
      customerName: cust,
      jobName: type,
      notes: compiledNotes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    btn.disabled = true;
    btn.textContent = "Submitting...";

    if (window.supabaseClient) {
      await window.supabaseClient.from('tasks').upsert(t);
    }
    
    appEl.innerHTML = `
      <div class="card" style="max-width: 500px; margin: 40px auto; text-align: center;">
         <div class="cardBody">
           <h2 style="color: var(--ok); font-weight: 800; letter-spacing: .2px;">Order Submitted!</h2>
           <p class="muted" style="margin: 16px 0;">Thank you, ${escapeHtml(contact.split(' ')[0])}. Your order for <strong>${escapeHtml(type)}</strong> has been sent directly to the engraving queue.</p>
           <button class="btn" style="margin-top: 20px;" id="submitAnother">Submit Another Order</button>
         </div>
      </div>
    `;

    document.getElementById("submitAnother").addEventListener("click", renderGuestApp);
  });
}

async function loadDashboard() {
  document.querySelector(".tabs").style.display = "flex";
  if (window.supabaseClient) {
    try {
      const [tasksRes, invoicesRes, settingsRes] = await Promise.all([
        window.supabaseClient.from('tasks').select('*'),
        window.supabaseClient.from('invoices').select('*'),
        window.supabaseClient.from('settings').select('*').eq('id', 1).single()
      ]);
      
      let changed = false;
      if (settingsRes.data) {
        state.settings = { ...state.settings, ...settingsRes.data };
        delete state.settings.id;
        changed = true;
      }
      if (tasksRes.data && tasksRes.data.length) {
        state.tasks = tasksRes.data;
        changed = true;
      }
      if (invoicesRes.data && invoicesRes.data.length) {
        state.invoices = invoicesRes.data;
        changed = true;
      }
      
      if (changed) {
        localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
      }
    } catch (err) {
      console.error("Initial cloud sync failed", err);
    }
  }
  render();
}

async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const invoiceId = urlParams.get('invoice');

  if (invoiceId) {
    document.getElementById("pinOverlay").style.display = "none";
    document.getElementById("mainApp").style.display = "flex";
    document.getElementById("mainApp").style.flexDirection = "column";
    await renderPublicInvoice(invoiceId);
    return;
  }

  const savedPin = sessionStorage.getItem('authPin');
  if (!savedPin) {
    document.getElementById("pinOverlay").style.display = "flex";
    const submitBtn = document.getElementById("pinSubmit");
    const input = document.getElementById("pinInput");
    const err = document.getElementById("pinError");
    
    setTimeout(() => input.focus(), 50);
    
    const handleLogin = () => {
      const pin = input.value;
      if (pin === "1013") {
        sessionStorage.setItem('authPin', '1013');
        document.getElementById("pinOverlay").style.display = "none";
        document.getElementById("mainApp").style.display = "flex";
        document.getElementById("mainApp").style.flexDirection = "column";
        loadDashboard();
      } else if (pin === "1979") {
        sessionStorage.setItem('authPin', '1979');
        document.getElementById("pinOverlay").style.display = "none";
        document.getElementById("mainApp").style.display = "flex";
        document.getElementById("mainApp").style.flexDirection = "column";
        renderGuestApp();
      } else {
        err.style.display = "block";
        input.value = "";
        input.focus();
      }
    };
    
    submitBtn.addEventListener("click", handleLogin);
    input.addEventListener("keyup", (e) => {
       if(e.key === "Enter") handleLogin();
    });
    return;
  }

  document.getElementById("mainApp").style.display = "flex";
  document.getElementById("mainApp").style.flexDirection = "column";
  if (savedPin === "1979") {
    renderGuestApp();
  } else {
    loadDashboard();
  }
}

initApp();

