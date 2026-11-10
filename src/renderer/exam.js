/* Claude Cert Coach — full exam simulation: 60 questions, 120 minutes, 4 random scenarios, offline.
 * Free navigation, changeable answers, flag for review, a review screen and auto-submit at 0:00.
 * State is saved after every change, so an exam survives closing the app (the clock keeps running).
 * Loaded after app.js and bank.js and uses their globals. */
'use strict';

const EXAM = { n: 60, minutes: 120, scenarios: 4, key: 'examState' };
const EXAM_DOMAIN_TARGET = { 1: 16, 2: 11, 3: 12, 4: 12, 5: 9 }; // 27/18/20/20/15% of 60
let exam = null; // { id, startedAt, deadline, scenarios, ids, answers, flags, spent, current, view, borrowed }
let examTick = 0;

const examActive = () => !!exam && !exam.submitted;
const examItem = (i) => bank.items.find((it) => it.id === exam.ids[i]);

function saveExam() {
  try {
    if (exam && !exam.submitted) localStorage.setItem(EXAM.key, JSON.stringify(exam));
    else localStorage.removeItem(EXAM.key);
  } catch {}
}
function savedExam() {
  try {
    return JSON.parse(localStorage.getItem(EXAM.key) || 'null');
  } catch {
    return null;
  }
}

// Picks 60 questions: 4 random scenarios, the official domain split, Exam-level and Expert first.
// A domain the drawn scenarios cannot fill borrows from the other scenarios (counted in `borrowed`).
function buildExam() {
  const scenarios = shuffle(SCENARIOS).slice(0, EXAM.scenarios);
  const stats = bankStats();
  const rank = (it) => (it.difficulty === 'Diabolical' ? 2 : 0) + (stats[it.id] ? 1 : 0) + Math.random(); // fair, unseen first
  const ids = [];
  let borrowed = 0;
  for (const [d, n] of Object.entries(EXAM_DOMAIN_TARGET)) {
    const inDomain = bank.items.filter((it) => it.task_statement[0] === d);
    const own = inDomain.filter((it) => scenarios.includes(it.scenario)).sort((a, b) => rank(a) - rank(b));
    const other = inDomain.filter((it) => !scenarios.includes(it.scenario)).sort((a, b) => rank(a) - rank(b));
    const pick = own.slice(0, n);
    if (pick.length < n) {
      const extra = other.slice(0, n - pick.length);
      borrowed += extra.length;
      pick.push(...extra);
    }
    ids.push(...pick.map((it) => it.id));
  }
  return { ids: shuffle(ids), scenarios, borrowed };
}

async function startExam() {
  if (!bank.items.length) await refreshBank();
  if (bank.items.length < EXAM.n) return toast(`The exam needs ${EXAM.n} bank questions; your bank has ${bank.items.length}.`);
  if (examActive() || savedExam()) {
    if (!confirm('You already have an exam in progress. Discard it and start a new one?')) return resumeExam();
  }
  if (chat.mode) {
    if (!chat.offline && !confirm(`End the current session (“${chat.title}”) and start the exam?`)) return;
    if (chat.running) await ipc.abort(chat.requestId);
    await endChat();
  }
  const { ids, scenarios, borrowed } = buildExam();
  const now = Date.now();
  exam = { id: `x${now}`, startedAt: now, deadline: now + EXAM.minutes * 60e3, scenarios, ids, answers: {}, flags: [], spent: {}, current: 0, view: 'question', visitAt: now, borrowed };
  saveExam();
  qCache = await ipc.listQuestions();
  show('exam');
}

function resumeExam() {
  if (!exam) exam = savedExam();
  if (!exam) return;
  exam.visitAt = Date.now();
  if (Date.now() >= exam.deadline) return submitExam(true);
  show('exam');
}

function discardExam() {
  if (!confirm('Discard the exam in progress? Nothing from it is saved.')) return;
  exam = null;
  saveExam();
  show('home');
}

// Time on the current question is added when the learner moves away from it.
function leaveQuestion() {
  if (!exam || exam.view !== 'question') return;
  const i = exam.current;
  exam.spent[i] = (exam.spent[i] || 0) + Math.max(0, Date.now() - (exam.visitAt || Date.now()));
  exam.visitAt = Date.now();
}
function goTo(i, view = 'question') {
  leaveQuestion();
  exam.current = Math.max(0, Math.min(exam.ids.length - 1, i));
  exam.view = view;
  exam.visitAt = Date.now();
  saveExam();
  renderExam();
}

const remaining = () => Math.max(0, exam.deadline - Date.now());
function hms(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderExamHead() {
  const answered = Object.keys(exam.answers).filter((k) => (exam.answers[k] || []).length).length;
  const left = remaining();
  $('#examHead').innerHTML = `<div class="xh-title"><b>Exam simulation</b><span class="muted small">${exam.scenarios.map(esc).join(' · ')}</span></div>
    <div class="xh-meta"><span class="xh-count">${answered}/${exam.ids.length} answered</span>
      <span class="xh-timer ${left < 10 * 60e3 ? 'low' : ''}" title="Time remaining">⏱ ${hms(left)}</span>
      ${exam.view === 'question' ? '<button class="primary" data-x="review">Review &amp; submit</button>' : '<button class="secondary" data-x="back">Back to questions</button>'}</div>`;
}

function renderExam() {
  if (!exam) return;
  if (exam.submitted) return; // results stay on screen
  renderExamHead();
  if (exam.view === 'review') return renderExamReview();
  const i = exam.current;
  const item = examItem(i);
  if (!item) return;
  const sel = exam.answers[i] || [];
  const two = item.format === 'select_two';
  const flagged = exam.flags.includes(i);
  const palette = exam.ids
    .map((_, k) => {
      const a = (exam.answers[k] || []).length;
      return `<button class="pal${a ? ' ans' : ''}${exam.flags.includes(k) ? ' flag' : ''}${k === i ? ' cur' : ''}" data-go-q="${k}" title="Question ${k + 1}">${k + 1}</button>`;
    })
    .join('');
  $('#examBody').innerHTML = `<div class="x-main">
      <div class="qcard x-card">
        <div class="q-top"><span class="q-num">Question ${i + 1} of ${exam.ids.length}</span>${two ? '<span class="chip two">Select TWO</span>' : ''}${flagged ? '<span class="chip flag-chip">⚑ Flagged</span>' : ''}</div>
        <div class="q-meta"><span>Scenario: ${esc(item.scenario)}</span></div>
        <div class="q-stem">${inline(item.question)}</div>
        ${optionsHTML(item)}
        <div class="muted tiny">${two ? 'Choose two options' : 'Choose one option'} · you can change your answer until you submit · keys <kbd>A</kbd>–<kbd>D</kbd>, <kbd>F</kbd> flag, <kbd>←</kbd> <kbd>→</kbd> move</div>
      </div>
      <div class="x-nav">
        <button class="secondary" data-x="prev" ${i === 0 ? 'disabled' : ''}>← Previous</button>
        <button class="ghost${flagged ? ' on' : ''}" data-x="flag">${flagged ? '⚑ Unflag' : '⚐ Flag for review'}</button>
        ${i === exam.ids.length - 1 ? '<button class="primary" data-x="review">Review &amp; submit</button>' : '<button class="primary" data-x="next">Next →</button>'}
      </div>
    </div>
    <aside class="x-side card">
      <div class="card-h"><span class="h-ico t-purple">#</span>Questions</div>
      <div class="palette">${palette}</div>
      <div class="legend small muted"><span><i class="pal ans"></i>Answered</span><span><i class="pal flag"></i>Flagged</span><span><i class="pal"></i>Not answered</span></div>
    </aside>`;
  $('#examBody').querySelectorAll('.q-opt').forEach((b) => b.classList.toggle('sel', sel.includes(b.dataset.letter)));
}

function renderExamReview() {
  const n = exam.ids.length;
  const unanswered = exam.ids.map((_, k) => k).filter((k) => !(exam.answers[k] || []).length);
  const rows = exam.ids
    .map((_, k) => {
      const it = examItem(k);
      const a = exam.answers[k] || [];
      const stem = it.question.length > 120 ? `${it.question.slice(0, 117)}…` : it.question;
      return `<button class="x-row${a.length ? '' : ' empty'}" data-go-q="${k}"><span class="r-num">${k + 1}</span><span class="r-stem">${inline(stem)}</span>${exam.flags.includes(k) ? '<span class="chip flag-chip">⚑</span>' : ''}<span class="x-ans">${a.length ? esc(a.join(' + ')) : '—'}</span></button>`;
    })
    .join('');
  $('#examBody').innerHTML = `<div class="x-review">
    <div class="card x-sum">
      <div class="card-h"><span class="h-ico t-purple">✓</span>Review before you submit</div>
      <div class="x-stats"><span><b>${n - unanswered.length}</b> answered</span><span class="${unanswered.length ? 'warn-text' : ''}"><b>${unanswered.length}</b> not answered</span><span><b>${exam.flags.length}</b> flagged</span><span><b>${hms(remaining())}</b> left</span></div>
      <p class="small muted">Unanswered questions count as wrong, as on the real exam. Click any question to go back to it.</p>
      <div class="row wrap">
        ${exam.flags.length ? `<button class="secondary" data-go-q="${exam.flags[0]}">Go to first flagged</button>` : ''}
        ${unanswered.length ? `<button class="secondary" data-go-q="${unanswered[0]}">Go to first unanswered</button>` : ''}
        <span class="rail-spacer"></span>
        <button class="primary big" data-x="submit">Submit exam</button>
      </div>
    </div>
    <div class="x-rows">${rows}</div>
  </div>`;
}

function pickOption(letter) {
  const i = exam.current;
  const item = examItem(i);
  let sel = (exam.answers[i] || []).slice();
  if (item.format === 'select_two') {
    sel = sel.includes(letter) ? sel.filter((l) => l !== letter) : [...sel, letter];
    if (sel.length > 2) sel.shift();
  } else sel = sel.includes(letter) ? [] : [letter];
  exam.answers[i] = sel.sort();
  saveExam();
  renderExam();
}

// Scores the exam and records every question in the question log, so readiness, levels, weak areas
// and spaced repetition all see it. Records are built here (not via logQuestion, which needs a chat session).
async function submitExam(auto) {
  if (!exam || exam.submitted) return;
  if (!auto) {
    const left = exam.ids.filter((_, k) => !(exam.answers[k] || []).length).length;
    if (!confirm(left ? `Submit with ${left} unanswered question${left > 1 ? 's' : ''}? They count as wrong.` : 'Submit the exam?')) return;
  }
  leaveQuestion();
  exam.submitted = true;
  saveExam(); // clears the saved state
  const end = Math.min(Date.now(), exam.deadline);
  const results = [];
  for (let k = 0; k < exam.ids.length; k++) {
    const item = examItem(k);
    if (!item) continue;
    const sel = (exam.answers[k] || []).slice().sort();
    const rec = {
      id: `${item.id}~${exam.id}`,
      sessionId: exam.id,
      date: new Date(exam.startedAt).toISOString(),
      answeredAt: new Date(end).toISOString(),
      mode: 'practice',
      model: 'Offline bank',
      number: k + 1,
      task_statement: item.task_statement,
      domain: `D${item.task_statement[0]} ${DOMAIN_FULL[item.task_statement[0]]}`,
      scenario: item.scenario,
      difficulty: item.difficulty,
      format: item.format,
      concept: item.concept,
      why: item.why,
      correct: item.correct.slice().sort(),
      selected: sel.length ? sel : null,
      status: sel.length ? 'answered' : 'skipped',
      isCorrect: sel.length > 0 && sel.join() === item.correct.slice().sort().join(),
      seconds: Math.max(1, Math.round((exam.spent[k] || 0) / 1000)),
      bankId: item.id,
    };
    ipc.upsertQuestion(rec);
    qCache.push(rec);
    results.push({ rec, item });
  }
  const correct = results.filter((r) => r.rec.isCorrect).length;
  const byDomain = [1, 2, 3, 4, 5].map((d) => {
    const rs = results.filter((r) => r.item.task_statement[0] === String(d));
    return { domain: `D${d} ${DOMAIN_NAMES[d]}`, asked: rs.length, correct: rs.filter((r) => r.rec.isCorrect).length };
  });
  const missed = [...new Set(results.filter((r) => !r.rec.isCorrect).map((r) => r.item.task_statement))];
  await ipc.addHistory({
    kind: 'mock_exam',
    title: 'Exam simulation (60 questions)',
    correct,
    answered: results.length,
    skipped: results.filter((r) => r.rec.status === 'skipped').length,
    by_domain: byDomain,
    missed_task_statements: missed,
    focus_next: missed.length ? `Study ${missed.slice(0, 6).join(', ')}` : '',
    model: 'Offline bank',
    cost: 0,
    date: new Date().toISOString(),
  });
  renderExamResults(results, correct, byDomain, missed, end - exam.startedAt, auto);
}

function renderExamResults(results, correct, byDomain, missed, usedMs, auto) {
  const pct = Math.round((100 * correct) / results.length);
  const tone = pct >= 80 ? 'ok' : pct >= 65 ? 'mid' : 'bad';
  $('#examHead').innerHTML = `<div class="xh-title"><b>Exam simulation · results</b><span class="muted small">${exam.scenarios.map(esc).join(' · ')}</span></div>
    <div class="xh-meta"><button class="secondary" data-x="home">Back to Train</button><button class="primary" data-x="again">New exam</button></div>`;
  $('#examBody').innerHTML = `<div class="x-results">
    ${auto ? '<div class="note">Time ran out, so the exam was submitted automatically.</div>' : ''}
    <div class="result-card">
      <div class="rc-score ${tone}"><b>${pct}%</b><span>${correct}/${results.length} correct</span></div>
      <div class="rc-body">
        <div class="eyebrow">Exam simulation complete</div>
        <div class="small muted">⏱ ${clock(usedMs / 1000)} of ${EXAM.minutes}:00 used · ${results.filter((r) => r.rec.status === 'skipped').length} unanswered${exam.borrowed ? ` · ${exam.borrowed} question${exam.borrowed > 1 ? 's' : ''} borrowed from other scenarios to keep the official domain weights` : ''}</div>
        <div class="doms">${byDomain
          .map((x) => `<div class="dom">${esc(x.domain)} · ${x.correct}/${x.asked} (${x.asked ? Math.round((100 * x.correct) / x.asked) : 0}%)<div class="bar"><i style="width:${x.asked ? (100 * x.correct) / x.asked : 0}%"></i></div></div>`)
          .join('')}</div>
        ${studyPlanHTML(results)}
        <div class="muted tiny">The real exam reports a scaled score (pass mark 720 of 1,000), not a percentage, and practice questions are harder than the real ones. Use this as a readiness check, not a predicted score.</div>
      </div>
    </div>
    <div id="examReview"></div>
  </div>`;
  renderReview(results, 0, $('#examReview'));
  $('#examBody').scrollTop = 0;
}

// ---------- Events ----------
$('#screen-exam').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled || !exam) return;
  if (b.dataset.study) return openLesson(b.dataset.study);
  if (b.dataset.goQ !== undefined) return goTo(Number(b.dataset.goQ));
  if (b.dataset.letter && !exam.submitted && exam.view === 'question') return pickOption(b.dataset.letter);
  const x = b.dataset.x;
  if (x === 'prev') goTo(exam.current - 1);
  else if (x === 'next') goTo(exam.current + 1);
  else if (x === 'review') goTo(exam.current, 'review');
  else if (x === 'back') goTo(exam.current);
  else if (x === 'submit') submitExam(false);
  else if (x === 'flag') {
    const i = exam.current;
    exam.flags = exam.flags.includes(i) ? exam.flags.filter((k) => k !== i) : [...exam.flags, i].sort((a, b2) => a - b2);
    saveExam();
    renderExam();
  } else if (x === 'home') {
    exam = null;
    show('home');
  } else if (x === 'again') {
    exam = null;
    startExam();
  }
});

document.addEventListener('keydown', (e) => {
  if (!examActive() || exam.view !== 'question' || !$('#screen-exam').classList.contains('active')) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const l = LETTERS.includes(k) ? k : LETTERS['1234'.indexOf(k)];
  if (l) pickOption(l);
  else if (k === 'F') $('#examBody [data-x="flag"]').click();
  else if (k === 'ArrowRight' && exam.current < exam.ids.length - 1) goTo(exam.current + 1);
  else if (k === 'ArrowLeft' && exam.current > 0) goTo(exam.current - 1);
  else return;
  e.preventDefault();
});

// Countdown: refresh the header every second; submit automatically at 0:00.
setInterval(() => {
  if (!examActive()) return;
  if (Date.now() >= exam.deadline) return submitExam(true);
  if ($('#screen-exam').classList.contains('active')) {
    const t = $('#examHead .xh-timer');
    if (t) {
      t.textContent = `⏱ ${hms(remaining())}`;
      t.classList.toggle('low', remaining() < 10 * 60e3);
    }
  }
}, 1000);

// Home banner for an exam left in progress (also after restarting the app).
function refreshExamBanner() {
  const s = examActive() ? exam : savedExam();
  const el = $('#examBanner');
  el.hidden = !s;
  if (!s) return;
  const left = Math.max(0, s.deadline - Date.now());
  const answered = Object.values(s.answers || {}).filter((a) => a && a.length).length;
  $('#examBannerText').textContent = left ? `${answered}/${s.ids.length} answered · ${hms(left)} left on the clock` : 'Time is up: open it to see your results';
}
$('#examResume').addEventListener('click', resumeExam);
$('#examDiscard').addEventListener('click', discardExam);
