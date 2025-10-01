// ===============================
// Helpers
// ===============================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtDate = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD

function showAlert(container, msg, type = "note") {
  container.innerHTML = `<div class="alert ${type}">${msg}</div>`;
  setTimeout(() => (container.innerHTML = ""), 3500);
}

// ===============================
// Tabs (left sidebar)
// ===============================
(function initTabs() {
  const tabButtons = $$(".sidebar .tab");
  const sections = $$(".tab-content");

  function activate(name) {
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    sections.forEach((s) => {
      if (s.id === name) {
        s.classList.remove("hidden");
      } else {
        s.classList.add("hidden");
      }
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.tab));
  });

  // default active is the one with .active on the button (HTML has math active)
  const activeBtn = tabButtons.find((b) => b.classList.contains("active")) || tabButtons[0];
  if (activeBtn) activate(activeBtn.dataset.tab);
})();

// ===============================
// Download current tab as PDF
// ===============================
(function initDownload() {
  const btn = $("#download-pdf");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // simplest zero-dependency approach: print current page;
    // because each tab content has class 'printable' for important areas
    window.print();
  });
})();

// ===============================
// History
// ===============================
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    if (!data || !Array.isArray(data.history)) return;
    const wrap = $("#history-container");
    wrap.innerHTML = data.history
      .map(
        (h) => `
        <div class="card mb-2">
          <div style="font-weight:700; margin-bottom:.25rem;">Q:</div>
          <div>${escapeHTML(h.q || "")}</div>
          <div class="hr" style="margin:.75rem 0;"><span></span></div>
          <div style="font-weight:700; margin-bottom:.25rem;">A:</div>
          <div>${escapeHTML(h.a || "")}</div>
        </div>`
      )
      .join("");
  } catch (e) {
    console.error(e);
  }
}

// ===============================
// Math Solver (text + optional image)
// ===============================
(function initMath() {
  const submit = $("#math-submit");
  if (!submit) return;

  submit.addEventListener("click", async () => {
    const q = ($("#math-question").value || "").trim();
    const img = $("#math-image").files?.[0];

    const out = $("#math-answer");
    if (!q && !img) {
      showAlert(out, "Please enter a question or select a photo.", "error");
      return;
    }

    // Test mode: we don't process the image on the backend yet.
    // If image exists, we add a friendly note and still send the text.
    const note = img ? " (Image attached — image analysis coming soon in Test Mode)" : "";
    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q || "[Photo-only question]" + note, mode: "explain" }),
      });
      const data = await res.json();
      out.innerHTML = `<div class="card"><div>${escapeHTML(data.answer || "No answer.")}</div></div>`;
      // also refresh history
      loadHistory();
    } catch (e) {
      console.error(e);
      showAlert(out, "Something went wrong. Try again.", "error");
    }
  });
})();

// ===============================
// Step-by-Step
// ===============================
(function initSteps() {
  const btn = $("#step-submit");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const q = ($("#step-question").value || "").trim();
    const out = $("#step-answer");
    if (!q) {
      showAlert(out, "Please type a question.", "error");
      return;
    }
    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode: "explain" }),
      });
      const data = await res.json();
      out.innerHTML = stepsify(data.answer || "");
      loadHistory();
    } catch (e) {
      console.error(e);
      showAlert(out, "Something went wrong. Try again.", "error");
    }
  });
})();

function stepsify(text) {
  // Simple step popups: split by sentences/lines and render collapsible items
  const lines = (text || "").split(/\n+/).filter(Boolean);
  if (!lines.length) return `<div class="card">No steps yet.</div>`;
  const items = lines
    .map(
      (t, i) => `
      <details class="card mb-1">
        <summary style="cursor:pointer;font-weight:700;">Step ${i + 1}</summary>
        <div style="margin-top:.5rem;">${escapeHTML(t)}</div>
      </details>`
    )
    .join("");
  return `<div>${items}</div>`;
}

// ===============================
// Flashcards
// ===============================
async function loadFlashcards() {
  try {
    const res = await fetch("/api/flashcards");
    const data = await res.json();
    const list = Array.isArray(data.flashcards) ? data.flashcards : [];
    renderFlashcards(list);
  } catch (e) {
    console.error(e);
  }
}

function renderFlashcards(cards) {
  const wrap = $("#flashcard-container");
  wrap.innerHTML = "";
  cards.forEach((c) => {
    const el = document.createElement("div");
    el.className = "flashcard";
    el.innerHTML = `
      <div class="face front">${escapeHTML(c.front)}</div>
      <div class="face back">${escapeHTML(c.back)}</div>
    `;
    el.addEventListener("click", () => el.classList.toggle("flipped"));
    wrap.appendChild(el);
  });
}

(function initFlashcardAdd() {
  const btn = $("#add-flashcard");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const front = ($("#fc-front").value || "").trim();
    const back = ($("#fc-back").value || "").trim();
    if (!front || !back) {
      alert("Please fill both sides.");
      return;
    }
    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });
      const data = await res.json();
      if (data.ok && data.card) {
        // refresh list
        loadFlashcards();
        $("#fc-front").value = "";
        $("#fc-back").value = "";
      }
    } catch (e) {
      console.error(e);
    }
  });
})();

// ===============================
// Planner / Calendar
// ===============================
let calState = (function () {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), events: [] }; // month: 0-11
})();

async function loadPlanner() {
  try {
    const res = await fetch("/api/planner");
    const data = await res.json();
    calState.events = Array.isArray(data.planner) ? data.planner : [];
    renderCalendar();
  } catch (e) {
    console.error(e);
  }
}

(function initPlannerControls() {
  const addBtn = $("#add-event");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const title = ($("#event-title").value || "").trim();
      const date = $("#event-date").value || "";
      if (!title) {
        alert("Please enter an event title.");
        return;
      }
      try {
        const res = await fetch("/api/planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, date }),
        });
        const data = await res.json();
        if (data.ok && data.event) {
          calState.events.push(data.event);
          renderCalendar();
          $("#event-title").value = "";
          $("#event-date").value = "";
        }
      } catch (e) {
        console.error(e);
      }
    });
  }

  const prev = $("#prev-month");
  const next = $("#next-month");
  if (prev) {
    prev.addEventListener("click", () => {
      calState.month--;
      if (calState.month < 0) {
        calState.month = 11;
        calState.year--;
      }
      renderCalendar();
    });
  }
  if (next) {
    next.addEventListener("click", () => {
      calState.month++;
      if (calState.month > 11) {
        calState.month = 0;
        calState.year++;
      }
      renderCalendar();
    });
  }
})();

function renderCalendar() {
  const title = $("#cal-title");
  const grid = $("#cal-grid");
  if (!title || !grid) return;

  const y = calState.year;
  const m = calState.month; // 0-11
  const first = new Date(y, m, 1);
  const startDay = first.getDay(); // 0=Sun..6=Sat
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  title.textContent = `${first.toLocaleString("default", { month: "long" })} ${y}`;

  grid.innerHTML = "";
  grid.className = "grid"; // reset
  grid.style.gridTemplateColumns = "repeat(7, 1fr)";

  // Weekday headers
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  weekdays.forEach((w) => {
    const h = document.createElement("div");
    h.className = "cell";
    h.style.fontWeight = "700";
    h.style.background = "#f8fafc";
    h.textContent = w;
    grid.appendChild(h);
  });

  // blanks before first
  for (let i = 0; i < startDay; i++) {
    const blank = document.createElement("div");
    blank.className = "cell";
    grid.appendChild(blank);
  }

  // days
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const showDate = document.createElement("div");
    showDate.className = "date";
    showDate.textContent = d;
    cell.appendChild(showDate);

    const thisISO = fmtDate(new Date(y, m, d));
    const todaysEvents = calState.events.filter((e) => (e.date || "") === thisISO);
    todaysEvents.forEach((ev) => {
      const chip = document.createElement("div");
      chip.className = "event";
      chip.textContent = ev.title;
      cell.appendChild(chip);
    });

    grid.appendChild(cell);
  }
}

// ===============================
// Utilities (escape)
// ===============================
function escapeHTML(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ===============================
// Initial loads
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  loadFlashcards();
  loadPlanner();
});
