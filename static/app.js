// simple tab switcher
function setActive(tab) {
  document.querySelectorAll('.side-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // tabs
  document.querySelectorAll('.side-tab').forEach(btn => {
    btn.addEventListener('click', () => setActive(btn.dataset.tab));
  });

  // history load
  fetch('/api/history')
    .then(r => r.json())
    .then(d => {
      if (!d || !d.history) return;
      const box = document.getElementById('history-container');
      box.innerHTML = '';
      d.history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML = `<strong>Q:</strong> ${item.q || ''}<br><strong>A:</strong> ${item.a || ''}`;
        box.appendChild(div);
      });
    })
    .catch(()=>{});

  // flashcards
  const fcContainer = document.getElementById('flashcard-container');
  fetch('/api/flashcards')
    .then(r=>r.json())
    .then(d=>{
      if (!d || !d.flashcards) return;
      fcContainer.innerHTML = '';
      d.flashcards.forEach(c => addCardEl(c));
    });

  function addCardEl(card){
    const wrap = document.createElement('div');
    wrap.className = 'flashcard';
    wrap.innerHTML = `
      <div class="face front">${card.front}</div>
      <div class="face back">${card.back}</div>
    `;
    wrap.addEventListener('click', ()=> wrap.classList.toggle('flipped'));
    fcContainer.appendChild(wrap);
  }

  document.getElementById('add-flashcard').addEventListener('click', async () => {
    const front = document.getElementById('fc-front').value.trim();
    const back  = document.getElementById('fc-back').value.trim();
    if(!front || !back) return;
    const res = await fetch('/api/flashcards', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({front, back})
    });
    const data = await res.json();
    if(data && data.card) addCardEl(data.card);
  });

  // math ask
  document.getElementById('math-submit').addEventListener('click', async () => {
    const q = document.getElementById('math-question').value.trim();
    const res = await fetch('/ask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({question: q, mode: 'explain'})
    });
    const data = await res.json();
    document.getElementById('math-answer').textContent = data.answer || 'No answer';
  });

  // step-by-step
  document.getElementById('step-submit').addEventListener('click', async () => {
    const q = document.getElementById('step-question').value.trim();
    const res = await fetch('/ask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({question: q, mode: 'example'})
    });
    const data = await res.json();
    document.getElementById('step-answer').textContent = data.answer || 'No answer';
  });

  // planner/calendar
  let viewDate = new Date();
  const titleEl = document.getElementById('cal-title');
  const gridEl  = document.getElementById('cal-grid');

  function renderCalendar(events){
    gridEl.innerHTML = '';
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    titleEl.textContent = viewDate.toLocaleString(undefined, {month:'long', year:'numeric'});

    const first = new Date(year, month, 1);
    const startDay = first.getDay(); // 0..6
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // leading blanks
    for (let i=0;i<startDay;i++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      gridEl.appendChild(cell);
    }
    // days
    for (let d=1; d<=daysInMonth; d++){
      const date = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<div class="date">${d}</div>`;
      (events || []).filter(e => e.date === date).forEach(e=>{
        const tag = document.createElement('div');
        tag.className = 'event';
        tag.textContent = e.title;
        cell.appendChild(tag);
      });
      gridEl.appendChild(cell);
    }
  }

  async function loadPlanner(){
    const res = await fetch('/api/planner');
    const data = await res.json();
    renderCalendar((data && data.planner) || []);
  }

  document.getElementById('prev-month').addEventListener('click', ()=>{
    viewDate.setMonth(viewDate.getMonth()-1);
    loadPlanner();
  });
  document.getElementById('next-month').addEventListener('click', ()=>{
    viewDate.setMonth(viewDate.getMonth()+1);
    loadPlanner();
  });

  document.getElementById('add-event').addEventListener('click', async ()=>{
    const title = document.getElementById('event-title').value.trim();
    const date  = document.getElementById('event-date').value;
    if(!title) return;
    await fetch('/api/planner', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({title, date})
    });
    loadPlanner();
  });

  loadPlanner();

  // simple download current tab content to PDF (prints current view)
  document.getElementById('download-pdf').addEventListener('click', () => {
    window.print();
  });
});
