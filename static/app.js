document.addEventListener("DOMContentLoaded", () => {
  // ----- Tabs -----
  const buttons = Array.from(document.querySelectorAll(".tab-btn"));
  const sections = Array.from(document.querySelectorAll(".tab-content"));
  function showTab(id){
    buttons.forEach(b => b.classList.toggle("active", b.dataset.tab === id));
    sections.forEach(s => s.classList.toggle("active", s.id === id));
    try { localStorage.setItem("hh_last_tab", id); } catch {}
  }
  const last = (()=>{ try{return localStorage.getItem("hh_last_tab")}catch{return null} })();
  if (last && document.getElementById(last)) showTab(last);
  buttons.forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

  // ----- PDF export (current tab) -----
  const pdfBtn = document.getElementById("download-pdf");
  if (pdfBtn){
    pdfBtn.addEventListener("click", () => {
      const visible = document.querySelector(".tab-content.active");
      if(!visible) return alert("Nothing to export.");
      const printable = visible.querySelector(".printable");
      const html = printable ? printable.outerHTML : visible.outerHTML;
      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Export</title>
        <style>
          body{font-family:Segoe UI,Arial,sans-serif;padding:16px}
          .answer-box,.history-list,.flashcards-grid,.calendar-wrap{border:1px solid #ddd;border-radius:8px;padding:12px}
          .flashcard{display:inline-block;margin:8px;border:1px solid #ccc;border-radius:8px;padding:16px}
        </style>
      </head><body>${html}</body></html>`);
      w.document.close(); w.focus(); w.print();
    });
  }

  // ----- History helpers -----
  const historyBox = document.getElementById("history-container");
  function appendHistory(q, a){
    if(!historyBox) return;
    const item = document.createElement("div");
    item.className = "hist-item";
    item.innerHTML = `<div class="hist-q">${q}</div><div class="hist-a">${a}</div>`;
    historyBox.prepend(item);
  }
  async function loadHistory(){
    if(!historyBox) return;
    try{
      const r = await fetch("/api/history");
      const data = await r.json();
      historyBox.innerHTML = "";
      (data.history || []).forEach(h => appendHistory(h.q, h.a));
    }catch{}
  }

  // ----- Math (Test Mode) -----
  const mathSubmit = document.getElementById("math-submit");
  const mathQ = document.getElementById("math-question");
  const mathA = document.getElementById("math-answer");
  if (mathSubmit){
    mathSubmit.addEventListener("click", async () => {
      const q = (mathQ.value || "").trim() || "1+1";
      mathA.textContent = "Thinking…";
      try{
        const r = await fetch("/ask", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({question:q, mode:"example"})
        });
        const data = await r.json();
        mathA.textContent = data.error ? data.error : data.answer;
        if(!data.error) appendHistory(q, data.answer);
      }catch{ mathA.textContent = "Error contacting the app."; }
    });
  }

  // ----- Step-by-Step (Test Mode) -----
  const stepBtn = document.getElementById("step-submit");
  const stepQ = document.getElementById("step-question");
  const stepA = document.getElementById("step-answer");
  if (stepBtn){
    stepBtn.addEventListener("click", async () => {
      const q = (stepQ.value || "").trim();
      if(!q){ stepA.textContent = "Please type a question."; return; }
      stepA.textContent = "Working…";
      try{
        const r = await fetch("/ask", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({question:q, mode:"explain"})
        });
        const data = await r.json();
        stepA.textContent = data.error ? data.error : data.answer;
        if(!data.error) appendHistory(q, data.answer);
      }catch{ stepA.textContent = "Error contacting the app."; }
    });
  }

  // ----- Flashcards (persist to server) -----
  const fcFront = document.getElementById("fc-front");
  const fcBack  = document.getElementById("fc-back");
  const fcAdd   = document.getElementById("add-flashcard");
  const fcWrap  = document.getElementById("flashcard-container");

  function renderFlashcard(front, back){
    const card = document.createElement("div");
    card.className = "flashcard";
    card.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-face front">${front}</div>
        <div class="flashcard-face back">${back}</div>
      </div>`;
    card.addEventListener("click", () => card.classList.toggle("flipped"));
    fcWrap.appendChild(card);
  }

  async function loadFlashcards(){
    if(!fcWrap) return;
    try{
      const r = await fetch("/api/flashcards");
      const data = await r.json();
      fcWrap.innerHTML = "";
      (data.flashcards || []).forEach(c => renderFlashcard(c.front, c.back));
    }catch{}
  }

  if (fcAdd){
    fcAdd.addEventListener("click", async () => {
      const f = (fcFront.value || "").trim();
      const b = (fcBack.value  || "").trim();
      if(!f || !b) return;
      try{
        const r = await fetch("/api/flashcards", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({front:f, back:b})
        });
        const data = await r.json();
        if (data.ok) {
          renderFlashcard(f, b);
          fcFront.value = ""; fcBack.value = "";
        }
      }catch{}
    });
  }

  // ----- Planner (persist to server) -----
  const calTitle = document.getElementById('cal-title');
  const calGrid  = document.getElementById('cal-grid');
  const prevBtn  = document.getElementById('prev-month');
  const nextBtn  = document.getElementById('next-month');
  const evTitle  = document.getElementById("event-title");
  const evDate   = document.getElementById("event-date");
  const evAdd    = document.getElementById("add-event");
  const calList  = document.getElementById("calendar");

  let plannerData = []; // loaded from server
  let view = new Date(); view.setDate(1);

  function renderCalendar(){
    if(!calGrid) return;
    calGrid.innerHTML = '';
    const year = view.getFullYear(), month = view.getMonth();
    const monthName = view.toLocaleString(undefined, {month:'long', year:'numeric'});
    if(calTitle) calTitle.textContent = monthName;

    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekdays.forEach(d => {
      const h = document.createElement('div');
      h.className = 'cal-head';
      h.textContent = d; calGrid.appendChild(h);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();

    for(let i=0;i<firstDay;i++){
      const cell = document.createElement('div');
      cell.className = 'cal-cell blank'; calGrid.appendChild(cell);
    }
    for(let day=1; day<=daysInMonth; day++){
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      cell.innerHTML = `<div class="cal-num">${day}</div><div class="cal-notes" data-date="${dateStr}"></div>`;
      calGrid.appendChild(cell);
    }

    // dots from plannerData
    plannerData.forEach(ev => {
      if (!ev.date) return;
      const t = document.querySelector(`.cal-notes[data-date="${ev.date}"]`);
      if (t){
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        dot.title = ev.title;
        t.appendChild(dot);
      }
    });
  }

  function renderPlannerList(){
    if(!calList) return;
    calList.innerHTML = "";
    plannerData.forEach(ev => {
      const row = document.createElement("div");
      row.className = "cal-row";
      row.innerHTML = `<div class="cal-date">${ev.date || "—"}</div><div class="cal-title">${ev.title}</div>`;
      calList.appendChild(row);
    });
  }

  async function loadPlanner(){
    try{
      const r = await fetch("/api/planner");
      const data = await r.json();
      plannerData = data.planner || [];
      renderCalendar();
      renderPlannerList();
    }catch{
      plannerData = [];
      renderCalendar();
      renderPlannerList();
    }
  }

  if(prevBtn) prevBtn.addEventListener('click', ()=>{ view.setMonth(view.getMonth()-1); renderCalendar(); });
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ view.setMonth(view.getMonth()+1); renderCalendar(); });

  if(evAdd){
    evAdd.addEventListener("click", async () => {
      const title = (evTitle.value || "").trim();
      const date  = evDate.value || "";
      if(!title) return;
      try{
        const r = await fetch("/api/planner", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({title, date})
        });
        const data = await r.json();
        if (data.ok){
          plannerData.push(data.event);
          evTitle.value = ""; evDate.value = "";
          renderCalendar();
          renderPlannerList();
        }
      }catch{}
    });
  }

  // ----- Initial loads -----
  loadHistory();
  loadFlashcards();
  loadPlanner();
});
