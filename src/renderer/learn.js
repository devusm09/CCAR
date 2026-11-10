/* Claude Cert Coach — Learn tab: a curriculum of 30 lessons (one per CCA-F task statement).
 * Each lesson is a guided 5-step page: Learn (plain words, diagram, deep dive, myths, real-world story),
 * Example (Python / C# / TypeScript), Playground (exam scenario lab with mock runs), Revise (key points, rule, traps) and Quiz.
 * Lessons live in data/learn.json; study material in data/study/*.json (merged by main.js as l.study).
 * Also: ⚡ rule drill (spaced-repetition trap flashcards), 📅 exam-date countdown with a daily plan, and a
 * 🖨️ printable one-page cheat sheet. Uses globals from app.js and bank.js, and startExam() from exam.js
 * (loaded later, called only on click). */
'use strict';

const learn = { lessons: [], glossary: [], loaded: false, view: 'overview', filter: '', step: 0, quiz: null, lab: null };
const DOMAIN_BLURB = {
  1: 'Agentic loops, coordinator–subagent orchestration, hooks, enforcement and session state.',
  2: 'Tool descriptions, structured MCP errors, tool distribution, tool_choice and MCP servers.',
  3: 'CLAUDE.md hierarchy, commands and skills, path rules, plan mode, iteration and CI/CD.',
  4: 'Explicit criteria, few-shot examples, structured output, validation loops and batch processing.',
  5: 'Long-context reliability, escalation, error propagation, human review and provenance.',
};
const DOMAIN_ICON = { 1: '🧭', 2: '🔧', 3: '⌨️', 4: '✍️', 5: '🛡️' };
const STEPS = [
  ['learn', '📖', 'Learn'],
  ['example', '💻', 'Example'],
  ['play', '🧪', 'Playground'],
  ['revise', '📝', 'Revise'],
  ['quiz', '🎯', 'Quiz'],
];

// Small per-computer stores. Every access is guarded: storage can be unavailable.
function getStore(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function setStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
// Which lessons the learner has marked as read.
const readLessons = () => new Set(getStore('lessonsRead', []));
function setRead(id, on) {
  const s = readLessons();
  on ? s.add(id) : s.delete(id);
  setStore('lessonsRead', [...s]);
}
const quizScores = () => getStore('quizScores', {});
// Called by Reset history (app.js): clears curriculum progress but keeps settings (exam date, code language).
const LEARN_PROGRESS_KEYS = ['lessonsRead', 'lessonStep', 'quizScores', 'labScores', 'drillBoxes'];
function resetLearnProgress() {
  for (const k of LEARN_PROGRESS_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
  Object.assign(learn, { quiz: null, lab: null, drill: null, step: 0 });
}
const savedStep = (id) => getStore('lessonStep', {})[id] || 0;
function saveStep(id, i) {
  const m = getStore('lessonStep', {});
  m[id] = i;
  setStore('lessonStep', m);
}

async function loadLearn() {
  if (learn.loaded) return;
  try {
    const r = await ipc.getLearn();
    learn.lessons = r.lessons || [];
    learn.glossary = r.glossary || [];
  } catch {}
  learn.loaded = true;
}

// Accuracy per task statement over the last 30 answers for it.
function taskStats() {
  const m = {};
  for (const q of doneQs(qCache)) (m[q.task_statement] = m[q.task_statement] || []).push(q.isCorrect ? 1 : 0);
  return Object.fromEntries(
    Object.entries(m).map(([t, a]) => {
      const r = a.slice(-30);
      return [t, { asked: a.length, pct: Math.round((100 * r.reduce((x, y) => x + y, 0)) / r.length) }];
    })
  );
}

const lessonById = (id) => learn.lessons.find((l) => l.id === id);
const bankFor = (id) => bank.items.filter((it) => it.task_statement === id);
const taskName = (l) => (TASK_NAMES[l.id] || l.title).replace(/`/g, "");
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function renderLearn() {
  await loadLearn();
  qCache = await ipc.listQuestions();
  if (!bank.items.length) await refreshBank();
  renderLearnNav();
  if (learn.view === 'glossary') renderGlossary();
  else if (learn.view === 'drill') renderDrill();
  else if (lessonById(learn.view)) renderLesson(learn.view);
  else renderOverview();
}

function renderLearnNav() {
  const read = readLessons();
  const stats = taskStats();
  const qs = quizScores();
  const doms = [1, 2, 3, 4, 5]
    .map((d) => {
      const ls = learn.lessons.filter((l) => l.domain === d);
      const r = ls.filter((l) => read.has(l.id)).length;
      const items = ls
        .map((l) => {
          const s = stats[l.id];
          const q = qs[l.id];
          return `<button class="ln-item${read.has(l.id) ? ' read' : ''}${learn.view === l.id ? ' active' : ''}" data-lesson="${esc(l.id)}">
            <span class="ln-check">${read.has(l.id) ? '✓' : ''}</span><span class="ln-title"><span class="ln-id">${esc(l.id)}</span> ${esc(taskName(l))}</span>${
              q ? `<span class="ln-quiz ${q.score >= 3 ? 'ok' : 'bad'}" title="Last quiz score">${q.score}/${q.total}</span>` : ''
            }${s ? `<span class="ln-pct ${s.pct >= 70 ? 'ok' : 'bad'}" title="Recent accuracy on practice questions">${s.pct}%</span>` : ''}</button>`;
        })
        .join('');
      return `<div class="ln-dom" style="--dc: var(--d${d})"><div class="ln-dom-h"><span><i class="ln-dot"></i>D${d} ${esc(DOMAIN_NAMES[d])}</span><span>${r}/${ls.length}</span></div>${items}</div>`;
    })
    .join('');
  $('#learnNav').innerHTML = `<button class="ln-top${learn.view === 'overview' ? ' active' : ''}" data-view="overview">📚 Curriculum</button>
    <button class="ln-top${learn.view === 'drill' ? ' active' : ''}" data-view="drill">⚡ Rule drill <span class="ln-due">${drillDue()}</span></button>
    ${doms}
    <button class="ln-top${learn.view === 'glossary' ? ' active' : ''}" data-view="glossary">🔎 Quick reference &amp; glossary</button>`;
}

function renderOverview() {
  const read = readLessons();
  const stats = taskStats();
  const qs = quizScores();
  const total = learn.lessons.length;
  const done = learn.lessons.filter((l) => read.has(l.id)).length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  const next = learn.lessons.find((l) => !read.has(l.id));
  const nextStep = next ? savedStep(next.id) : 0;
  const cards = [1, 2, 3, 4, 5]
    .map((d) => {
      const ls = learn.lessons.filter((l) => l.domain === d);
      const r = ls.filter((l) => read.has(l.id)).length;
      const answered = ls.reduce((a, l) => a + ((stats[l.id] || {}).asked || 0), 0);
      const quizzed = ls.filter((l) => qs[l.id]);
      const avg = quizzed.length ? Math.round((100 * quizzed.reduce((a, l) => a + qs[l.id].score / qs[l.id].total, 0)) / quizzed.length) : null;
      return `<button class="dom-card" style="--dc: var(--d${d})" data-lesson="${esc((ls.find((l) => !read.has(l.id)) || ls[0] || {}).id || '')}">
        <div class="dc-top"><span class="dc-icon">${DOMAIN_ICON[d]}</span><span class="dc-code">Domain ${d}</span><span class="dc-weight">${DOMAIN_WEIGHT[d]}% of exam</span></div>
        <div class="dc-title">${esc(DOMAIN_FULL[d])}</div>
        <div class="dc-desc">${esc(DOMAIN_BLURB[d])}</div>
        <div class="dc-bar"><i style="width:${ls.length ? (100 * r) / ls.length : 0}%"></i></div>
        <div class="dc-foot"><span>${r}/${ls.length} lessons</span><span>${avg == null ? 'No quizzes yet' : `Quiz avg ${avg}%`}</span><span>${plural(answered, 'answer')}</span></div>
      </button>`;
    })
    .join('');
  $('#learnMain').innerHTML = `<div class="lv">
    <div class="ov-hero">
      <div class="ov-ring" style="--p:${pct}"><div><b>${pct}%</b><span>${done}/${total} read</span></div></div>
      <div class="ov-text">
        <div class="eyebrow">CCA-F curriculum</div>
        <h1>Learn the CCA-F exam, one step at a time</h1>
        <p>${total} lessons, one for each task statement in the official outline. Each lesson walks you through 5 steps:</p>
        <div class="ov-steps">${STEPS.map(([, ic, n], i) => `<span><b>${i + 1}</b>${ic} ${n}</span>`).join('')}</div>
        ${
          next
            ? `<button class="primary big" data-lesson="${esc(next.id)}">${done || nextStep ? 'Continue' : 'Start'}: ${esc(next.id)} ${esc(taskName(next))}${nextStep ? ` · ${STEPS[nextStep][2]}` : ''} →</button>`
            : '<div class="ok-text">✓ All lessons read. Take a mock exam on the Train tab.</div>'
        }
      </div>
    </div>
    ${planHtml()}
    <div class="facts"><span><b>60</b> questions</span><span><b>120</b> minutes</span><span><b>720</b>/1000 to pass</span><span><b>4 of 6</b> scenarios drawn</span><span>Single and multiple response</span></div>
    <h2 class="ov-h">Domains</h2>
    <div class="dom-cards">${cards}</div>
  </div>`;
}

/* ---------- Lesson: 5-step guided page ---------- */

function renderLesson(id) {
  const l = lessonById(id);
  if (!l) return renderOverview();
  const read = readLessons().has(id);
  const i = learn.lessons.indexOf(l);
  const next = learn.lessons[i + 1];
  // Opened from a mistake (guide.js): open Revise and highlight the trap that was picked.
  const f = learn.focus && learn.focus.task === id ? learn.focus : null;
  learn.focus = null;
  const hlTrap = f ? f.trap : -1;
  if (!learn.quiz || learn.quiz.id !== id) learn.quiz = { id, i: 0, picks: [] };
  if (!learn.lab || learn.lab.id !== id) learn.lab = { id, i: 0, s: [] };
  const s = l.study || {};
  const panels = {
    learn: learnPanel(l),
    example: examplePanel(l),
    play: labsHtml(l),
    revise: revisePanel(l, hlTrap, f),
    quiz: `<div id="quizBox">${quizHtml(l)}</div>${practiseCard(l)}`,
  };
  $('#learnMain').innerHTML = `<div class="lv lsn" style="--dc: var(--d${l.domain})">
    <div class="crumbs"><a data-view="overview">CCA-F</a> <span>/</span> D${l.domain} ${esc(DOMAIN_NAMES[l.domain])} <span>/</span> ${esc(l.id)}</div>
    ${
      f
        ? `<div class="focus-banner"><div><b>Studying a mistake.</b> ${hlTrap >= 0 ? 'The trap you picked is highlighted below. ' : ''}Read the key points and the decision rule, then try the quiz.</div>${
            f.from === 'session' ? '<button class="secondary small-btn" data-guide="back">← Back to session</button>' : ''
          }</div>`
        : ''
    }
    <header class="lsn-head">
      <div class="chips"><span class="chip dom-chip">${DOMAIN_ICON[l.domain]} Domain ${l.domain} · ${DOMAIN_WEIGHT[l.domain]}%</span><span class="chip">Task ${esc(l.id)}</span><span class="chip read-chip"${read ? '' : ' hidden'}>✓ Read</span></div>
      <h1>${inline(l.title)}</h1>
      <p class="lesson-sum">${inline(l.summary)}</p>
      ${(l.scenarios || []).length ? `<div class="lsn-scen">Appears in: ${l.scenarios.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    </header>
    <nav class="stepper" aria-label="Lesson steps">${STEPS.map(([k, ic, n], si) => `<button class="st" data-step="${si}"><span class="st-n">${si + 1}</span><span class="st-ic">${ic}</span><span class="st-l">${n}</span></button>`).join('')}</nav>
    <div class="st-progress"><i></i></div>
    ${STEPS.map(([k], si) => `<section class="step-panel" data-panel="${si}" hidden>${panels[k]}</section>`).join('')}
    <div class="step-foot">
      <button class="ghost" data-stepgo="-1">← Back</button>
      <span class="st-count"></span>
      <button class="primary" data-stepgo="1">Next →</button>
      ${next ? `<button class="primary" data-lesson="${esc(next.id)}" data-last hidden>Next lesson: ${esc(next.id)} →</button>` : ''}
    </div>
  </div>`;
  goStep(f ? 3 : savedStep(id), true);
  if (s.labs) labRender();
  const target = $('#learnMain .trap.hl');
  if (target) target.scrollIntoView({ block: 'center' });
}

// Switch steps in the DOM only, so a playground run or a half-done quiz survives tab changes.
function goStep(si, initial) {
  si = Math.max(0, Math.min(STEPS.length - 1, si));
  learn.step = si;
  saveStep(learn.view, si);
  document.querySelectorAll('#learnMain .step-panel').forEach((p) => (p.hidden = Number(p.dataset.panel) !== si));
  document.querySelectorAll('#learnMain .st').forEach((b) => {
    const n = Number(b.dataset.step);
    b.classList.toggle('active', n === si);
    b.classList.toggle('done', n < si);
  });
  $('#learnMain .st-progress i').style.width = `${(100 * (si + 1)) / STEPS.length}%`;
  $('#learnMain .st-count').textContent = `Step ${si + 1} of ${STEPS.length} · ${STEPS[si][2]}`;
  $('#learnMain [data-stepgo="-1"]').style.visibility = si ? 'visible' : 'hidden';
  const last = si === STEPS.length - 1;
  $('#learnMain [data-stepgo="1"]').hidden = last;
  $('#learnMain [data-stepgo="1"]').textContent = last ? '' : `Next: ${STEPS[si + 1][2]} →`;
  const nl = $('#learnMain [data-last]');
  if (nl) nl.hidden = !last;
  if (!initial) $('#learnMain').scrollTop = 0;
  else $('#learnMain').scrollTop = 0;
}

function learnPanel(l) {
  const s = l.study;
  if (!s) return `<p class="lesson-sum">${inline(l.summary)}</p>`;
  return `
    ${s.plain ? `<div class="card plain-box"><div class="eyebrow">In plain words</div><p>${inline(s.plain)}</p>${s.analogy ? `<div class="analogy"><span>💡 Think of it like this</span>${inline(s.analogy)}</div>` : ''}</div>` : ''}
    ${s.currentNote ? `<div class="callout now"><div class="eyebrow">🆕 In current models and tools</div><div>${inline(s.currentNote)}</div><div class="small muted">The exam follows the official outline; answer exam questions with the lesson's rule.</div></div>` : ''}
    ${s.diagram ? `<section class="lesson-sec"><h2>See it</h2><div class="card diagram">${diagramHtml(s.diagram)}</div></section>` : ''}
    ${(s.sections || []).length ? `<section class="lesson-sec"><h2>Deep dive</h2>${s.sections
      .map((x, i) => `<details class="deep"${i === 0 ? ' open' : ''}><summary><span class="deep-n">${i + 1}</span>${esc(x.h)}</summary><div class="md">${md(x.body)}</div></details>`)
      .join('')}</section>` : ''}
    ${(s.misconceptions || []).length ? `<section class="lesson-sec"><h2>Myth vs fact</h2><div class="myths">${s.misconceptions
      .map((m) => `<div class="myth"><div class="myth-m"><span>Myth</span>${inline(m.myth)}</div><div class="myth-f"><span>Fact</span>${inline(m.fact)}</div></div>`)
      .join('')}</div></section>` : ''}
    ${s.scenario ? `<section class="lesson-sec"><h2>In the real world</h2><div class="card story"><div class="eyebrow">📍 ${esc(s.scenario.title || 'Scenario')}</div><div class="md">${md(s.scenario.story || '')}</div></div></section>` : ''}`;
}

function examplePanel(l) {
  const ex = l.study && l.study.example;
  if (!ex) return '<p class="muted">No worked example for this lesson yet.</p>';
  return `<h2 class="panel-h">${esc(ex.title || 'Worked example')}</h2>
    <p class="muted">Switch the language with the tabs. Your choice is remembered for every lesson.</p>
    <div data-codeof="ex">${codePanel(ex, 'Worked example')}</div>
    ${(ex.notes || []).length ? `<div class="card ex-notes"><div class="eyebrow">What to notice</div><ol>${ex.notes.map((n) => `<li>${inline(n)}</li>`).join('')}</ol></div>` : ''}`;
}

function revisePanel(l, hlTrap, f) {
  const checks = (l.study && l.study.checks) || [];
  return `
    ${l.rule ? `<div class="callout rule"><div class="eyebrow">Decision rule</div><div>${inline(l.rule)}</div></div>` : ''}
    <section class="lesson-sec"><h2>Key points</h2><ul class="kp">${(l.keyPoints || []).map((k) => `<li>${inline(k)}</li>`).join('')}</ul></section>
    <section class="lesson-sec"><h2>Common traps</h2><div class="traps">${(l.traps || [])
      .map((t, ti) => `<div class="trap${ti === hlTrap ? ' hl' : ''}">${ti === hlTrap ? '<div class="eyebrow">Closest to your answer</div>' : ''}<div class="t-wrong">✗ ${inline(t.wrong)}</div><div class="t-why">${inline(t.why)}</div>${
        ti === hlTrap && f && f.from === 'session' ? '<button class="secondary small-btn t-back" data-guide="back">← Back to session</button>' : ''
      }</div>`)
      .join('')}</div></section>
    ${l.examTip ? `<div class="callout tip"><div class="eyebrow">Exam tip</div><div>${inline(l.examTip)}</div></div>` : ''}
    ${checks.length ? `<section class="lesson-sec"><h2>Quick recall</h2><div class="recalls">${checks
      .map((x) => `<details class="recall"><summary>${inline(x.q)}</summary><div class="recall-a">${inline(x.a)}</div></details>`)
      .join('')}</div></section>` : ''}`;
}

function practiseCard(l) {
  const read = readLessons().has(l.id);
  const s = taskStats()[l.id];
  const n = bankFor(l.id).length;
  return `<div class="card lesson-practice">
    <div><b>Practise ${esc(l.id)} with exam questions</b><div class="small muted">${plural(n, 'question')} in your bank${s ? ` · you've answered ${s.asked}, ${s.pct}% correct recently` : ' · not practised yet'}</div></div>
    <div class="row wrap">
      <button class="ghost" data-act="toggle-read">${read ? 'Mark as unread' : '✓ Mark as read'}</button>
      <button class="primary" data-act="practise" ${n ? '' : 'disabled'}>Practise ${plural(n, 'question')} →</button>
    </div>
  </div>`;
}

/* ---------- Diagrams: data-driven boxes and arrows (flow, hub, compare) ---------- */

function diagramHtml(d) {
  if (!d) return '';
  const node = (x, cls = '') => `<div class="dg-node ${cls} k-${esc(x.kind || 'step')}"><b>${inline(x.label || '')}</b>${x.note ? `<span>${inline(x.note)}</span>` : ''}</div>`;
  if (d.type === 'flow') {
    const steps = d.steps || [];
    const loop = d.loop && steps[d.loop.from] && steps[d.loop.to]
      ? `<div class="dg-loop"><span class="dg-loop-ic">↻</span><span>${inline(d.loop.label || '')}</span><span class="dg-loop-p">${esc(steps[d.loop.from].label)} → back to ${esc(steps[d.loop.to].label)}</span></div>`
      : '';
    return `${d.title ? `<div class="dg-title">${esc(d.title)}</div>` : ''}<div class="dg-flow">${steps
      .map((x, i) => `${i ? '<div class="dg-arrow" aria-hidden="true">→</div>' : ''}${node(x)}`)
      .join('')}</div>${loop}`;
  }
  if (d.type === 'hub') {
    return `${d.title ? `<div class="dg-title">${esc(d.title)}</div>` : ''}<div class="dg-hub">${node(d.center || {}, 'dg-center')}<div class="dg-stem"></div><div class="dg-spokes">${(d.spokes || [])
      .map((x) => `<div class="dg-spoke">${node(x)}</div>`)
      .join('')}</div></div>`;
  }
  if (d.type === 'compare') {
    const side = (x) => `<div class="dg-side t-${esc((x && x.tone) || 'neutral')}"><div class="dg-side-h">${esc((x && x.title) || '')}</div><ul>${((x && x.items) || [])
      .map((it) => `<li>${inline(it)}</li>`)
      .join('')}</ul></div>`;
    return `${d.title ? `<div class="dg-title">${esc(d.title)}</div>` : ''}<div class="dg-compare">${side(d.left)}<div class="dg-vs">vs</div>${side(d.right)}</div>`;
  }
  return '';
}

/* ---------- Quiz: one question at a time, instant feedback ---------- */

function quizHtml(l) {
  const qz = (l.study && l.study.quiz) || [];
  if (!qz.length) return '<p class="muted">No quiz for this lesson yet. Practise with exam questions below.</p>';
  const st = learn.quiz;
  if (st.i >= qz.length) {
    const score = st.picks.filter((p, i) => p === qz[i].answer).length;
    const pass = score >= Math.ceil(qz.length * 0.75);
    return `<div class="card quiz-done ${pass ? 'ok' : 'bad'}">
      <div class="qd-score"><b>${score}/${qz.length}</b><span>${pass ? 'Well done' : 'Keep going'}</span></div>
      <div class="qd-text"><h2>${pass ? '✓ You have got this lesson' : 'Review and try again'}</h2>
        <p>${pass ? 'The lesson is marked as read. Lock it in with real exam-style questions.' : 'Look at the Revise step (rule and traps), then retry the quiz.'}</p>
        <div class="row wrap"><button class="ghost" data-qretry>↻ Retry quiz</button>${pass ? '' : '<button class="secondary" data-step="3">Go to Revise</button>'}</div>
      </div></div>
      <div class="quiz-review">${qz
        .map((q, i) => `<div class="qr ${st.picks[i] === q.answer ? 'ok' : 'bad'}"><span>${st.picks[i] === q.answer ? '✓' : '✗'}</span><div><b>${inline(q.q)}</b><div class="small muted">${inline(q.why || '')}</div></div></div>`)
        .join('')}</div>`;
  }
  const q = qz[st.i];
  const picked = st.picks[st.i];
  const answered = picked != null;
  return `<div class="card quiz">
    <div class="quiz-top"><span class="eyebrow">Question ${st.i + 1} of ${qz.length}</span><span class="quiz-dots">${qz
      .map((x, i) => `<i class="${i < st.i ? (st.picks[i] === x.answer ? 'ok' : 'bad') : i === st.i ? 'cur' : ''}"></i>`)
      .join('')}</span></div>
    <div class="quiz-q">${inline(q.q)}</div>
    <div class="quiz-opts">${q.options
      .map((o, oi) => {
        const cls = !answered ? '' : oi === q.answer ? ' right' : oi === picked ? ' wrong' : ' dim';
        return `<button class="quiz-opt${cls}" data-qopt="${oi}" ${answered ? 'disabled' : ''}><span class="qo-l">${String.fromCharCode(65 + oi)}</span><span>${inline(o)}</span></button>`;
      })
      .join('')}</div>
    ${
      answered
        ? `<div class="quiz-why ${picked === q.answer ? 'ok' : 'bad'}"><b>${picked === q.answer ? '✓ Correct.' : `✗ Not quite. The answer is ${String.fromCharCode(65 + q.answer)}.`}</b> ${inline(q.why || '')}</div>
           <div class="row end"><button class="primary" data-qnext>${st.i + 1 < qz.length ? 'Next question →' : 'See my score →'}</button></div>`
        : ''
    }
  </div>`;
}

function quizRefresh() {
  const l = lessonById(learn.view);
  const box = $('#quizBox');
  if (l && box) box.innerHTML = quizHtml(l);
}
function quizAnswer(choice) {
  const st = learn.quiz;
  if (st.picks[st.i] != null) return;
  st.picks[st.i] = choice;
  quizRefresh();
}
function quizNext() {
  const l = lessonById(learn.view);
  const qz = l.study.quiz;
  learn.quiz.i++;
  if (learn.quiz.i >= qz.length) {
    const score = learn.quiz.picks.filter((p, i) => p === qz[i].answer).length;
    const all = quizScores();
    all[l.id] = { score, total: qz.length, at: Date.now() };
    setStore('quizScores', all);
    if (score >= Math.ceil(qz.length * 0.75)) setRead(l.id, true), markReadUi(true);
    renderLearnNav();
  }
  quizRefresh();
}

function markReadUi(on) {
  const chip = $('#learnMain .read-chip');
  if (chip) chip.hidden = !on;
  document.querySelectorAll('#learnMain [data-act="toggle-read"]').forEach((b) => (b.textContent = on ? 'Mark as unread' : '✓ Mark as read'));
}

/* ---------- Code panels (Python / C# / TypeScript) ---------- */

// Code snippets are written in Python with `variants` for C# and TypeScript; config, prompts and
// shell are language-neutral. The learner's pick is remembered on this computer.
const CODE_LANGS = [['python', 'Python'], ['csharp', 'C#'], ['typescript', 'TypeScript']];
const LANG_NAME = { json: 'JSON', markdown: 'Markdown', yaml: 'YAML', bash: 'Shell', text: 'Plain text', javascript: 'JavaScript' };
function codeLang() {
  const v = getStore('codeLang', 'python');
  return CODE_LANGS.some(([k]) => k === v) ? v : 'python';
}
function codePanel(x, title) {
  const multi = !!x.variants;
  const lang = multi ? codeLang() : x.lang;
  const code = multi && lang !== 'python' ? x.variants[lang] || x.code : x.code;
  const right = multi
    ? `<div class="lang-tabs" role="tablist">${CODE_LANGS.map(([k, n]) => `<button class="lang-tab${k === lang ? ' active' : ''}" data-codelang="${k}" role="tab">${n}</button>`).join('')}</div>`
    : `<span class="lang-fixed">${esc(LANG_NAME[x.lang] || x.lang || '')}${['python', 'javascript'].includes(x.lang) ? '' : ' · same in every language'}</span>`;
  return `<div class="code-card"><div class="code-card-h"><span class="code-title">${esc(title || '')}</span>${right}</div><pre class="code"><code>${esc(code || '')}</code></pre></div>`;
}
// Switch every code panel on the page in place (worked example and lab code), so a running trace is not reset.
function setCodeLang(lang) {
  setStore('codeLang', lang);
  const l = lessonById(learn.view);
  const s = l && l.study;
  if (!s) return;
  document.querySelectorAll('#learnMain [data-codeof]').forEach((el) => {
    const [li, oi] = el.dataset.codeof.split(':');
    if (li === 'ex') return (el.innerHTML = codePanel(s.example, 'Worked example'));
    const o = s.labs && s.labs[li] && s.labs[li].options[oi];
    if (o) el.innerHTML = codePanel(o, `Option ${String.fromCharCode(65 + Number(oi))}`);
  });
}

/* ---------- Playground: exam scenario lab ----------
 * Each lesson has 3 scenarios in the official exam scenarios. The learner picks an answer, locks it in,
 * watches a mock run of that choice, sees the best answer and why, then can run the others to compare. */

const PG_WHO = { user: '👤 User', claude: '🤖 Claude', tool: '🔧 Tool', app: '⚙️ App', hook: '🪝 Hook', system: '🖥️ System' };
const SCEN_ICON = {
  'Customer Support Resolution Agent': '🎧',
  'Code Generation with Claude Code': '💻',
  'Multi-Agent Research System': '🔬',
  'Developer Productivity with Claude': '🛠️',
  'Claude Code for Continuous Integration': '🔁',
  'Structured Data Extraction': '📄',
};
const letter = (i) => String.fromCharCode(65 + i);
const labScores = () => getStore('labScores', {});
let pgTimer = null;

function labState(li) {
  const st = learn.lab || (learn.lab = { id: learn.view, i: 0, s: [] });
  return st.s[li] || (st.s[li] = { sel: null, locked: false, cmp: null });
}

function labsHtml(l) {
  const labs = (l.study && l.study.labs) || [];
  if (!labs.length) return '<p class="muted">No scenario lab for this lesson yet.</p>';
  return `<section class="playground">
    <div class="pg-head"><div><h2>🧪 Scenario lab</h2><div class="pg-sub">Answer like it's the exam, then run your choice to see what happens.</div></div><span class="pg-badge">Mock runs · nothing is sent to the API</span></div>
    <div class="lab-tabs" role="tablist">${labs
      .map((lab, li) => `<button class="lab-tab" data-lab="${li}" role="tab"><span class="lab-tab-n">${li + 1}</span><span class="lab-tab-t"><b>${esc(lab.title)}</b><span>${SCEN_ICON[lab.scenario] || '📍'} ${esc(lab.scenario)}</span></span><span class="lab-mark"></span></button>`)
      .join('')}</div>
    <div class="pg-body" id="labBox"></div>
  </section>`;
}

// Draw the current lab from its state. Animation of a run is done separately by labRun().
function labRender() {
  const l = lessonById(learn.view);
  const box = $('#labBox');
  if (!l || !box || !learn.lab) return;
  clearTimeout(pgTimer);
  const li = learn.lab.i;
  const lab = l.study.labs[li];
  const st = labState(li);
  const scores = labScores()[l.id] || {};
  document.querySelectorAll('#learnMain .lab-tab').forEach((b) => {
    const i = Number(b.dataset.lab);
    b.classList.toggle('active', i === li);
    const m = b.querySelector('.lab-mark');
    const r = scores[i];
    m.className = `lab-mark${r == null ? '' : r ? ' ok' : ' bad'}`;
    m.textContent = r == null ? '' : r ? '✓' : '✗';
  });
  const sel = st.sel;
  const opts = lab.options
    .map((o, oi) => {
      let cls = oi === sel ? ' picked' : '';
      if (st.locked) cls += oi === lab.answer ? ' right' : oi === sel ? ' wrong' : ' dim';
      return `<button class="lab-opt${cls}" data-lopt="${oi}" ${st.locked ? 'disabled' : ''}><span class="qo-l">${letter(oi)}</span><span>${inline(o.text)}</span>${
        st.locked && oi === lab.answer ? '<span class="lab-tag ok">Best answer</span>' : st.locked && oi === sel ? '<span class="lab-tag bad">Your pick</span>' : ''
      }</button>`;
    })
    .join('');
  const preview = !st.locked && sel != null && lab.options[sel].code
    ? `<div class="lab-preview"><div class="lab-lbl">What option ${letter(sel)} looks like in practice</div><div data-codeof="${li}:${sel}">${codePanel(lab.options[sel], `Option ${letter(sel)}`)}</div></div>`
    : '';
  box.innerHTML = `
    <div class="lab-scen">${SCEN_ICON[lab.scenario] || '📍'} Scenario: <b>${esc(lab.scenario)}</b></div>
    <h3 class="lab-title">${inline(lab.title)}</h3>
    <p class="lab-context">${inline(lab.context)}</p>
    <div class="lab-question">${inline(lab.question)}</div>
    <div class="pg-step-h"><span class="pg-num">1</span>${st.locked ? 'Your answer' : 'Choose your answer'}</div>
    <div class="lab-opts">${opts}</div>
    ${preview}
    ${
      st.locked
        ? `<div class="pg-step-h"><span class="pg-num">2</span>What happened when option ${letter(sel)} ran</div><ol class="pg-trace" id="labTrace"></ol><div id="labVerdict"></div>`
        : `<div class="lab-lock"><button class="primary big" data-lrun ${sel == null ? 'disabled' : ''}>🔒 Lock in ${sel == null ? 'an answer' : letter(sel)} and run (mock)</button><span class="muted small">${sel == null ? 'Pick A–D first. Think it through as you would in the exam.' : 'You can still change your pick.'}</span></div>`
    }`;
  if (st.locked) {
    const trace = $('#labTrace');
    lab.options[sel].trace.forEach((t) => trace.insertAdjacentHTML('beforeend', traceStep(t)));
    labVerdict(l, li);
  }
}

const traceStep = (t) => `<li class="pg-ev who-${esc(t.who)}"><span class="pg-who">${PG_WHO[t.who] || esc(t.who)}</span><div class="pg-msg">${inline(t.text)}</div></li>`;

// Play trace steps one by one into a container, then call done().
function playTrace(container, steps, done) {
  clearTimeout(pgTimer);
  container.innerHTML = '';
  let n = 0;
  const step = () => {
    if (!container.isConnected) return;
    const t = steps[n++];
    if (!t) return done && done();
    container.insertAdjacentHTML('beforeend', traceStep(t));
    if (!container.closest('[hidden]')) container.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    pgTimer = setTimeout(step, 550);
  };
  step();
}

function labVerdict(l, li) {
  const lab = l.study.labs[li];
  const st = labState(li);
  const pick = lab.options[st.sel];
  const best = lab.options[lab.answer];
  const ok = st.sel === lab.answer;
  const cmp = st.cmp;
  const others = lab.options
    .map((o, oi) => `<button class="lab-cmp${cmp === oi ? ' active' : ''} ${o.result === 'good' ? 'g' : 'b'}" data-lcmp="${oi}">${o.result === 'good' ? '✓' : '✗'} Run ${letter(oi)}</button>`)
    .join('');
  const next = li < l.study.labs.length - 1
    ? `<button class="primary" data-lab="${li + 1}">Next scenario →</button>`
    : `<button class="primary" data-step="3">Revise the rule →</button>`;
  $('#labVerdict').innerHTML = `
    <div class="pg-result ${ok ? 'ok' : 'bad'}"><div class="pg-res-h"><span class="pg-res-tag">${ok ? '✓ Correct' : '✗ Not the best answer'}</span><b>${inline(pick.verdict)}</b></div><div class="pg-res-why">${inline(pick.why)}</div></div>
    ${ok ? '' : `<div class="pg-result ok lab-best"><div class="pg-res-h"><span class="pg-res-tag">Best answer: ${letter(lab.answer)}</span><b>${inline(best.text)}</b></div><div class="pg-res-why">${inline(best.why)}</div></div>`}
    <div class="callout lab-take"><div class="eyebrow">🎯 Exam takeaway</div><div>${inline(lab.takeaway)}</div></div>
    <div class="pg-step-h"><span class="pg-num">3</span>Compare: run any option and see why it works or fails</div>
    <div class="lab-cmps">${others}</div>
    <div id="labCmp"></div>
    <div class="lab-foot"><button class="ghost" data-lretry>↻ Try this scenario again</button>${next}</div>`;
  if (cmp != null) labCompare(cmp, false);
}

function labSelect(oi) {
  const st = labState(learn.lab.i);
  if (st.locked) return;
  st.sel = oi;
  labRender();
}

function labRun() {
  const l = lessonById(learn.view);
  const li = learn.lab.i;
  const st = labState(li);
  if (st.sel == null) return;
  st.locked = true;
  const all = labScores();
  const mine = all[l.id] || (all[l.id] = {});
  if (mine[li] == null) mine[li] = st.sel === l.study.labs[li].answer; // first attempt counts
  setStore('labScores', all);
  labRender(); // draws the options; replace the instant trace with an animated one
  $('#labVerdict').hidden = true;
  playTrace($('#labTrace'), l.study.labs[li].options[st.sel].trace, () => {
    const v = $('#labVerdict');
    if (!v) return;
    v.hidden = false;
    v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function labCompare(oi, animate = true) {
  const l = lessonById(learn.view);
  const li = learn.lab.i;
  const o = l.study.labs[li].options[oi];
  labState(li).cmp = oi;
  document.querySelectorAll('#learnMain .lab-cmp').forEach((b) => b.classList.toggle('active', b.dataset.lcmp === String(oi)));
  const box = $('#labCmp');
  box.innerHTML = `<div class="lab-cmp-card ${o.result === 'good' ? 'g' : 'b'}">
    <div class="lab-lbl">Option ${letter(oi)}: ${inline(o.text)}</div>
    ${o.code ? `<div data-codeof="${li}:${oi}">${codePanel(o, `Option ${letter(oi)}`)}</div>` : ''}
    <ol class="pg-trace"></ol><div class="lab-cmp-v"></div></div>`;
  const tr = box.querySelector('.pg-trace');
  const fin = () => {
    box.querySelector('.lab-cmp-v').innerHTML = `<div class="pg-result ${o.result === 'good' ? 'ok' : 'bad'}"><div class="pg-res-h"><span class="pg-res-tag">${o.result === 'good' ? '✓ Works' : '✗ Fails'}</span><b>${inline(o.verdict)}</b></div><div class="pg-res-why">${inline(o.why)}</div></div>`;
  };
  if (animate) playTrace(tr, o.trace, fin);
  else (o.trace.forEach((t) => tr.insertAdjacentHTML('beforeend', traceStep(t))), fin());
}

function labGo(li) {
  learn.lab.i = li;
  labRender();
  const p = $('#learnMain .playground');
  if (p && !p.closest('[hidden]')) p.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ---------- Weak-lesson ranking (shared by the daily plan and the cheat sheet) ---------- */

// Lower is weaker: recent practice accuracy and the last quiz score, whichever is worse. null = no data.
function lessonScore(l, stats, qs) {
  const parts = [];
  if (stats[l.id]) parts.push(stats[l.id].pct);
  if (qs[l.id]) parts.push(Math.round((100 * qs[l.id].score) / qs[l.id].total));
  return parts.length ? Math.min(...parts) : null;
}
function weakLessons() {
  const stats = taskStats();
  const qs = quizScores();
  const read = readLessons();
  return learn.lessons
    .map((l) => ({ l, read: read.has(l.id), score: lessonScore(l, stats, qs), w: DOMAIN_WEIGHT[l.domain] }))
    .sort((a, b) => (a.read !== b.read ? (a.read ? 1 : -1) : (a.score ?? 101) - (b.score ?? 101) || b.w - a.w));
}

/* ---------- ⚡ Rule drill: spaced-repetition flashcards built from every lesson's traps ---------- */

const DRILL_DAYS = [0, 1, 3, 7, 14]; // Leitner box -> days until the card is due again
const DRILL_SIZE = 15;
const drillStore = () => getStore('drillBoxes', {});
const drillCards = () => learn.lessons.flatMap((l) => (l.traps || []).map((t, ti) => ({ id: `${l.id}#${ti}`, l, t })));
function drillDue() {
  const box = drillStore();
  const now = Date.now();
  return drillCards().filter((c) => !box[c.id] || box[c.id].due <= now).length;
}

function drillStart() {
  const box = drillStore();
  const now = Date.now();
  const weak = new Map(weakLessons().map((x, i) => [x.l.id, i]));
  const pick = drillCards()
    .map((c) => {
      const b = box[c.id];
      // Due reviews first (lowest box first), then new cards from weaker lessons; jitter keeps rounds varied.
      const rank = b ? (b.due <= now ? b.box : 50 + (b.due - now) / 864e5) : 10 + weak.get(c.l.id) / 3;
      return { c, rank: rank + Math.random() * 2 };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, DRILL_SIZE)
    .map((x) => x.c.id);
  learn.drill = { queue: pick, i: 0, shown: false, got: 0, missed: [], requeued: new Set() };
  renderDrill();
}

function drillGrade(ok) {
  const d = learn.drill;
  const id = d.queue[d.i];
  const box = drillStore();
  const cur = box[id] || { box: 0 };
  const nb = ok ? Math.min(cur.box + 1, DRILL_DAYS.length - 1) : 0;
  box[id] = { box: nb, due: Date.now() + DRILL_DAYS[nb] * 864e5 };
  setStore('drillBoxes', box);
  if (ok) d.got++;
  else {
    if (!d.missed.includes(id)) d.missed.push(id);
    if (!d.requeued.has(id)) d.requeued.add(id), d.queue.push(id); // one more go at the end of the round
  }
  d.i++;
  d.shown = false;
  renderDrill();
}

function renderDrill() {
  const box = drillStore();
  const cards = drillCards();
  const mastered = cards.filter((c) => box[c.id] && box[c.id].box >= 3).length;
  const head = `<div class="crumbs"><a data-view="overview">CCA-F</a> <span>/</span> Rule drill</div>
    <h1>⚡ Rule drill</h1>
    <p class="muted">A candidate's tempting wrong answer is shown. Say which rule beats it and why, then flip the card. Cards you miss come back sooner. Keys: <kbd>Space</kbd> flip · <kbd>1</kbd> missed · <kbd>2</kbd> got it.</p>
    <div class="drill-stats"><span><b>${mastered}</b>/${cards.length} mastered</span><span><b>${drillDue()}</b> due now</span></div>`;
  const d = learn.drill;
  if (!d) {
    $('#learnMain').innerHTML = `<div class="lv">${head}<div class="card drill-start"><p>${DRILL_SIZE} cards per round, about 5 minutes. Due cards come first, then new ones from your weakest lessons.</p><button class="primary big" data-drill="start">Start a round →</button></div></div>`;
    return;
  }
  if (d.i >= d.queue.length) {
    const total = d.queue.length - d.requeued.size;
    const missed = [...new Set(d.missed)].map((id) => cards.find((c) => c.id === id)).filter(Boolean);
    $('#learnMain').innerHTML = `<div class="lv">${head}
      <div class="card quiz-done ${d.missed.length ? 'bad' : 'ok'}"><div class="qd-score"><b>${Math.max(0, total - missed.length)}/${total}</b><span>first try</span></div>
        <div class="qd-text"><h2>${missed.length ? 'Round done. Review the ones you missed.' : '✓ Clean round!'}</h2><p>Missed cards are due again straight away; correct ones move to a longer interval.</p>
        <div class="row wrap"><button class="primary" data-drill="start">Another round →</button><button class="ghost" data-view="overview">Back to curriculum</button></div></div></div>
      ${missed.length ? `<h2 class="ov-h">Missed this round</h2><div class="traps">${missed
        .map((c) => `<div class="trap"><div class="t-wrong">✗ ${inline(c.t.wrong)}</div><div class="t-why"><b>Rule:</b> ${inline(c.l.rule || '')}</div><button class="ghost small-btn" data-lesson="${esc(c.l.id)}" data-at="3">Revise ${esc(c.l.id)} →</button></div>`)
        .join('')}</div>` : ''}</div>`;
    return;
  }
  const c = cards.find((x) => x.id === d.queue[d.i]);
  const b = box[c.id];
  $('#learnMain').innerHTML = `<div class="lv">${head}
    <div class="drill-bar"><i style="width:${(100 * d.i) / d.queue.length}%"></i></div>
    <div class="card drill-card" style="--dc: var(--d${c.l.domain})">
      <div class="drill-top"><span class="chip dom-chip">${DOMAIN_ICON[c.l.domain]} ${esc(c.l.id)} ${esc(taskName(c.l))}</span><span class="muted small">Card ${d.i + 1} of ${d.queue.length}${b ? ` · box ${b.box + 1}/5` : ' · new'}</span></div>
      <div class="eyebrow">A candidate picks</div>
      <div class="drill-front">✗ ${inline(c.t.wrong)}</div>
      <div class="drill-ask">Which rule beats this, and why does it fail?</div>
      ${
        d.shown
          ? `<div class="drill-back"><div class="callout rule"><div class="eyebrow">Decision rule</div><div>${inline(c.l.rule || '')}</div></div><div class="drill-why"><b>Why it fails:</b> ${inline(c.t.why)}</div></div>
             <div class="drill-grade"><button class="secondary" data-drill="miss">✗ Missed <kbd>1</kbd></button><button class="primary" data-drill="got">✓ Got it <kbd>2</kbd></button></div>`
          : `<div class="drill-grade"><button class="primary big" data-drill="flip">Show answer <kbd>Space</kbd></button></div>`
      }
    </div></div>`;
}

document.addEventListener('keydown', (e) => {
  if (learn.view !== 'drill' || !learn.drill || !$('#screen-learn').classList.contains('active')) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  const d = learn.drill;
  if (d.i >= d.queue.length) return;
  if (e.code === 'Space' && !d.shown) (e.preventDefault(), (d.shown = true), renderDrill());
  else if (d.shown && e.key === '1') drillGrade(false);
  else if (d.shown && e.key === '2') drillGrade(true);
});

/* ---------- 📅 Exam date countdown and today's plan ---------- */

function planHtml() {
  const date = getStore('examDate', '');
  if (!date) {
    return `<div class="card plan plan-empty"><div><div class="eyebrow">📅 Exam date</div><b>Set your exam date to get a countdown and a daily plan.</b></div>
      <input type="date" id="examDate" min="${new Date().toISOString().slice(0, 10)}" /></div>`;
  }
  const today = new Date(new Date().toDateString());
  const days = Math.round((new Date(`${date}T00:00:00`) - today) / 864e5);
  const weak = weakLessons();
  const scores = labScores();
  const items = [];
  if (days < 0) {
    items.push(['🎓', 'Exam date has passed. Set a new date if you are retaking.', '']);
  } else if (days === 0) {
    items.push(['🧘', '<b>Exam day.</b> No new material. Skim the cheat sheet, then rest.', '<button class="secondary small-btn" data-act="print">🖨️ Cheat sheet</button>']);
    items.push(['⚡', 'One short rule drill to warm up.', '<button class="secondary small-btn" data-view="drill">Drill →</button>']);
  } else {
    weak.slice(0, 2).forEach(({ l, read, score }) => {
      items.push([read ? '📝' : '📖', `<b>${esc(l.id)} ${esc(taskName(l))}</b> <span class="muted">${read ? `weakest so far${score != null ? ` · ${score}%` : ''}` : 'not studied yet'}</span>`, `<button class="secondary small-btn" data-lesson="${esc(l.id)}" data-at="${read ? 3 : 0}">${read ? 'Revise' : 'Study'} →</button>`]);
    });
    const labLesson = weak.find(({ l }) => (l.study && l.study.labs || []).some((_, i) => (scores[l.id] || {})[i] == null));
    if (labLesson) items.push(['🧪', `Scenario lab: <b>${esc(labLesson.l.id)} ${esc(taskName(labLesson.l))}</b>`, `<button class="secondary small-btn" data-lesson="${esc(labLesson.l.id)}" data-at="2">Open lab →</button>`]);
    const due = drillDue();
    items.push(['⚡', `Rule drill: <b>${Math.min(due, DRILL_SIZE)}</b> cards (${due} due)`, '<button class="secondary small-btn" data-view="drill">Drill →</button>']);
    const every = days <= 7 ? 2 : 5;
    if (days <= 2 || days % every === 0) items.push(['⏱️', `<b>Full mock exam</b> <span class="muted">60 questions, 120 minutes${days <= 7 ? ' · final week: every other day' : ''}</span>`, '<button class="primary small-btn" data-act="mock">Start →</button>']);
    if (days === 1) items.push(['🖨️', 'Print the cheat sheet for tomorrow morning.', '<button class="secondary small-btn" data-act="print">Print →</button>']);
  }
  return `<div class="card plan">
    <div class="plan-head"><div class="plan-count"><b>${Math.max(days, 0)}</b><span>day${days === 1 ? '' : 's'} left</span></div>
      <div class="plan-title"><div class="eyebrow">📅 Today's plan</div><div class="muted small">Exam on ${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · <a data-act="clear-date">change date</a></div></div></div>
    <ol class="plan-list">${items.map(([ic, t, btn]) => `<li><span class="plan-ic">${ic}</span><span class="plan-t">${t}</span>${btn}</li>`).join('')}</ol>
  </div>`;
}

/* ---------- 🖨️ One-page cheat sheet (all 30 decision rules + traps of your weakest lessons) ---------- */

function printSheet() {
  const weak = weakLessons().filter((x) => x.read && x.score != null).slice(0, 6);
  const rules = [1, 2, 3, 4, 5]
    .map((d) => `<h3>D${d} ${esc(DOMAIN_FULL[d])} · ${DOMAIN_WEIGHT[d]}%</h3><ul>${learn.lessons
      .filter((l) => l.domain === d)
      .map((l) => `<li><b>${esc(l.id)}</b> ${inline(l.rule || l.title)}</li>`)
      .join('')}</ul>`)
    .join('');
  const traps = weak.length
    ? `<h2>Traps to watch: your weakest lessons</h2>${weak
        .map(({ l, score }) => `<h3>${esc(l.id)} ${esc(taskName(l))} · ${score}%</h3><ul>${(l.traps || []).slice(0, 3).map((t) => `<li>✗ ${inline(t.wrong)}</li>`).join('')}</ul>`)
        .join('')}`
    : '';
  let el = document.getElementById('printSheet');
  if (!el) (el = document.createElement('div')), (el.id = 'printSheet'), document.body.appendChild(el);
  el.innerHTML = `<h1>CCA-F cheat sheet</h1><p class="ps-sub">60 questions · 120 min · 720/1000 to pass · 4 of 6 scenarios. Deterministic guarantees (money, identity, order, schema) need code-level enforcement, not prompt wording.</p><h2>Decision rules</h2>${rules}${traps}`;
  window.print();
}

/* ---------- Quick reference & glossary ---------- */

function renderGlossary() {
  const q = learn.filter.trim().toLowerCase();
  const rows = learn.glossary.filter((g) => !q || `${g.term} ${g.def} ${g.task}`.toLowerCase().includes(q));
  const byDomain = [1, 2, 3, 4, 5]
    .map((d) => {
      const gs = rows.filter((g) => String(g.task)[0] === String(d));
      if (!gs.length) return '';
      return `<h2 class="g-dom" style="--dc: var(--d${d})"><i class="ln-dot"></i>D${d} ${esc(DOMAIN_FULL[d])}</h2><div class="g-grid">${gs
        .map((g) => `<div class="g-card" style="--dc: var(--d${d})"><div class="g-term"><code>${esc(g.term)}</code><button class="g-task" data-lesson="${esc(g.task)}" title="Open lesson">${esc(g.task)} →</button></div><div class="g-def">${inline(g.def)}</div></div>`)
        .join('')}</div>`;
    })
    .join('');
  const focused = document.activeElement && document.activeElement.id === 'glossSearch';
  $('#learnMain').innerHTML = `<div class="lv">
    <div class="crumbs"><a data-view="overview">CCA-F</a> <span>/</span> Quick reference</div>
    <div class="row between wrap"><h1>Quick reference &amp; glossary</h1><button class="secondary" data-act="print">🖨️ Print cheat sheet</button></div>
    <p class="muted">One decision rule per lesson, then every key term. Click a card to open its lesson.</p>
    <div class="ref-grid">
      ${learn.lessons.map((l) => `<button class="ref-card" style="--dc: var(--d${l.domain})" data-lesson="${esc(l.id)}"><b>${esc(l.id)}</b> ${inline(l.rule || l.title)}</button>`).join('')}
    </div>
    <h2 class="ov-h">Glossary</h2>
    <input id="glossSearch" placeholder="🔎 Search ${learn.glossary.length} terms…" value="${esc(learn.filter)}" autocomplete="off" />
    ${byDomain || '<p class="muted">No matching terms.</p>'}
  </div>`;
  if (focused) {
    const el = $('#glossSearch');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function openLesson(id) {
  learn.view = id;
  show('learn');
}

// Practise one task statement: every bank question for it, unseen first.
function practiseTask(id) {
  const items = bankFor(id);
  if (!items.length) return toast('No bank questions for this task statement yet.');
  setRead(id, true);
  startBankSession({ length: String(items.length), focus: 'task', items, level: 'adaptive', title: `Task ${id} · ${TASK_NAMES[id] || ''}` });
}

$('#screen-learn').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lesson], [data-view], [data-act], [data-step], [data-stepgo], [data-lab], [data-lopt], [data-lrun], [data-lcmp], [data-lretry], [data-codelang], [data-qopt], [data-qnext], [data-qretry], [data-drill]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.step) return goStep(Number(d.step));
  if (d.stepgo) return goStep(learn.step + Number(d.stepgo));
  if (d.lab) return labGo(Number(d.lab));
  if (d.lopt) return labSelect(Number(d.lopt));
  if ('lrun' in d) return labRun();
  if (d.lcmp) return labCompare(Number(d.lcmp));
  if ('lretry' in d) {
    learn.lab.s[learn.lab.i] = { sel: null, locked: false, cmp: null };
    return labRender();
  }
  if (d.codelang) return setCodeLang(d.codelang);
  if (d.qopt) return quizAnswer(Number(d.qopt));
  if ('qnext' in d) return quizNext();
  if ('qretry' in d) {
    learn.quiz = { id: learn.view, i: 0, picks: [] };
    return quizRefresh();
  }
  if (d.drill === 'start') return drillStart();
  if (d.drill === 'flip') return (learn.drill.shown = true), renderDrill();
  if (d.drill) return drillGrade(d.drill === 'got');
  if (d.act === 'print') return printSheet();
  if (d.act === 'mock') return startExam();
  if (d.act === 'clear-date') return setStore('examDate', ''), renderOverview();
  if (d.lesson) {
    if (d.at != null) saveStep(d.lesson, Number(d.at));
    learn.view = d.lesson;
    return renderLearn();
  }
  if (d.view) {
    learn.view = d.view;
    return renderLearn();
  }
  if (d.act === 'toggle-read') {
    const on = !readLessons().has(learn.view);
    setRead(learn.view, on);
    markReadUi(on);
    return renderLearnNav();
  }
  if (d.act === 'practise') practiseTask(learn.view);
});
$('#screen-learn').addEventListener('input', (e) => {
  if (e.target.id === 'examDate') {
    if (e.target.value) setStore('examDate', e.target.value), renderOverview();
    return;
  }
  if (e.target.id !== 'glossSearch') return;
  learn.filter = e.target.value;
  renderGlossary();
});

// "Study" links on a session's result card open the matching lesson.
$('#log').addEventListener('click', (e) => {
  const b = e.target.closest('[data-study]');
  if (b) openLesson(b.dataset.study);
});
