// ---------- Tabs (left sidebar) ----------
function setupTabs() {
  const tabs = document.querySelectorAll(".side-tab");
  const panels = {
    math: document.getElementById("panel-math"),
    flashcards: document.getElementById("panel-flashcards"),
    planner: document.getElementById("panel-planner"),
    stepbystep: document.getElementById("panel-stepbystep"),
    history: document.getElementById("panel-history"),
  };

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.target;
      Object.values(panels).forEach(p => p.classList.remove("active"));
      panels[target].classList.add("active");
    });
  });
}

// ---------- Simple printable download (uses browser print) ----------
function setupDownloadPDF() {
  const btn = document.getElementById("download-pdf");
  if (!btn) return;
  btn.addEventListener("click", () => {
    window.print(); // keeps it simple for test mode
  });
}

// ---------- Math ----------
function setupMath() {
  const submit = document.getElementById("math-submit");
  const qEl = document.getElementById("math-question");
  const ans = document.getElementById("math-answer");

  if (!submit) return;
  submit.addEventListener("click", async () => {
    const question = (qEl.value || "").trim();
    if (!question) {
      ans.textContent = "Please type a question.";
      return;
    }
    ans.textContent = "Working...";
    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ question, mode: "explain" })
      });
      const data = await res.json();
      ans.textContent = data.answer || "No answer.";
    } catch (e) {
      ans.textContent = "Error reaching server.";
    }
  });
}

// ---------- Step-by-step ----------
function setupSteps() {
  const submit = document.getElementById("step-submit");
  const qEl = document.getElementById("step-question");
  const ans = document.getElementById("step-answer");
  if (!submit) return;

  submit.addEventListener("click", async () => {
    const question = (qEl.value || "").trim();
    if (!question) {
      ans.textContent = "Please type a question.";
      return;
    }
    ans.textContent = "Working...";
    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ question, mode: "explain" })
      });
      const data = await res.json();
      ans.textContent = data.answer || "No answer.";
    } catch (e) {
      ans.textContent = "Error reaching server.";
    }
  });
}

// ---------- Flashcards ----------
function renderFlashcards(list) {
  const wrap = document.getElementById("flashcard-container");
  if (!wrap) return;
  wrap.innerHTML = "";

  list.forEach(card => {
    const div = document.createElement("div");
    div.className = "flashcard";
    div.innerHTML = `
      <div class="face front"><strong>${card.front}</strong></div>
      <div class="face back">${card.back}</div>
    `;
    div.addEventListener("click", () => div.classList.toggle("flipped"));
    wrap.appendChild(div);
  });
}

async function loadFlashcards() {
  try {
    const res = await fetch("/api/flashcards");
    const data = await res.json();
    if (data.flashcards) renderFlashcards(data.flashcards);
  } catch (e) {
    console.warn("flashcards load error", e);
  }
}

function setupFlashcards() {
  const addBtn = document.getElementById("add-flashcard");
  const f = document.getElementById("fc-front");
  const b = document.getElementById("fc-back");
  if (!addBtn) return;

  addBtn.addEventListener("click", async () => {
    const front = (f.value || "").trim();
    const back = (b.value || "").trim();
    if (!front || !back) return;

    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ front, back })
      });
      const data = await res.json();
      if (data.ok) {
        f.value = ""; b.value = "";
        loadFlashcards();
      }
    } catch (e) {
      console.warn("add flashcard error", e);
    }
  });

  loadFlashcards();
}

// ---------- Planner ----------
function buildCalendarGrid(current) {
  const grid = document.getElementById("cal-grid");
  const title = document.getElementById("cal-title");
  if (!grid || !title) return;

  const y = current.getFullYear();
  const m = current.getMonth();
  const first = new Date(y, m, 1);
  const startDay = first.getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  title.textContent = current.toLocaleString(undefined, { month: "long", year: "numeric" });

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push("");
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  grid.innerHTML = "";
  cells.forEach((v) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (v) {
      const date = document.createElement("div");
      date.className = "date";
      date.textContent = v;
      cell.appendChild(date);
      cell.dataset.day = String(v);
    }
    grid.appendChild(cell);
  });
}

function renderPlannerEvents(list, current) {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;
  const m = current.getMonth() + 1; // 1-12
  const y = current.getFullYear();

  const byDay = {};
  list.forEach(e => {
    if (!e.date) return;
    const [yy, mm, dd] = e.date.split("-").map(n => parseInt(n, 10));
    if (yy === y && mm === m) {
      byDay[dd] = byDay[dd] || [];
      byDay[dd].push(e);
    }
  });

  grid.querySelectorAll(".cell").forEach(cell => {
    const d = parseInt(cell.dataset.day || "NaN", 10);
    if (!d || !byDay[d]) return;
    byDay[d].forEach(ev => {
      const tag = document.createElement("div");
      tag.className = "event";
      tag.textContent = ev.title;
      cell.appendChild(tag);
    });
  });
}

let _plannerMonth = new Date();

async function loadPlanner() {
  try {
    const res = await fetch("/api/planner");
    const data = await res.json();
    if (!data.planner) return;
    buildCalendarGrid(_plannerMonth);
    renderPlannerEvents(data.planner, _plannerMonth);
  } catch (e) {
    console.warn("planner load error", e);
  }
}

function setupPlanner() {
  buildCalendarGrid(_plannerMonth);
  loadPlanner();

  const add = document.getElementById("add-event");
  const title = document.getElementById("event-title");
  const date = document.getElementById("event-date");
  const prev = document.getElementById("prev-month");
  const next = document.getElementById("next-month");

  if (add) {
    add.addEventListener("click", async () => {
      const t = (title.value || "").trim();
      const d = (date.value || "").trim();
      if (!t) return;
      try {
        const res = await fetch("/api/planner", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ title: t, date: d })
        });
        const data = await res.json();
        if (data.ok) {
          title.value = ""; date.value = "";
          loadPlanner();
        }
      } catch (e) {
        console.warn("add planner error", e);
      }
    });
  }

  if (prev) prev.addEventListener("click", () => {
    _plannerMonth = new Date(_plannerMonth.getFullYear(), _plannerMonth.getMonth() - 1, 1);
    loadPlanner();
  });
  if (next) next.addEventListener("click", () => {
    _plannerMonth = new Date(_plannerMonth.getFullYear(), _plannerMonth.getMonth() + 1, 1);
    loadPlanner();
  });
}

// ---------- History ----------
async function loadHistory() {
  const wrap = document.getElementById("history-container");
  if (!wrap) return;
  wrap.innerHTML = "Loading...";
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    const list = data.history || [];
    wrap.innerHTML = "";
    list.forEach(item => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `<strong>Q:</strong> ${item.q}<br/><strong>A:</strong> ${item.a}`;
      wrap.appendChild(div);
    });
  } catch (e) {
    wrap.textContent = "Error loading history.";
  }
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupDownloadPDF();
  setupMath();
  setupSteps();
  setupFlashcards();
  setupPlanner();
  loadHistory();
});

