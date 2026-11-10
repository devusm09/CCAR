/* Claude Cert Coach — renderer. Owns the UI and the conversation state. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const ipc = window.api;
document.documentElement.dataset.platform = ipc.platform; // title-bar spacing per OS (styles.css)

marked.setOptions({ gfm: true, breaks: true });
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));
// Escaped text with `inline code` and *emphasis* rendered (bank questions use both).
// Asterisks count as emphasis only around whole words, so globs like **/*.ts stay as typed.
const inline = (s) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2
        ? `<code>${part.slice(1, -1)}</code>`
        : part
            .replace(/(^|[\s(])\*\*(\w[^*]*?\w|\w)\*\*(?=[\s.,;:!?)]|$)/g, '$1<b>$2</b>')
            .replace(/(^|[\s(])\*(\w[^*]*?\w|\w)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    )
    .join('');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let settings = null;
let models = [];

// ---------- Navigation ----------
// Leaving the chat screen only hides it; a running request keeps streaming into the hidden log.
function show(screen) {
  if (screen === 'chat' && !chat.mode) screen = 'home';
  if (screen === 'exam' && !exam) screen = 'home';
  // Exam clock per question: pause while the learner is on another screen.
  if (examActive()) {
    if (screen !== 'exam' && !exam.away) {
      leaveQuestion();
      exam.away = true;
      saveExam();
    } else if (screen === 'exam' && exam.away) {
      exam.away = false;
      exam.visitAt = Date.now();
    }
  }
  $('#navExam').hidden = !examActive();
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${screen}`));
  $('#navSession').hidden = !chat.mode;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === screen));
  if (screen === 'history') renderHistory();
  if (screen === 'learn') renderLearn();
  if (screen === 'exam') renderExam();
  if (screen === 'browse') renderBrowse();
  if (screen === 'settings') fillSettingsForm();
  if (screen === 'home') {
    refreshHome();
    refreshResumeBanner();
    refreshExamBanner();
  }
}

$('#nav').addEventListener('click', (e) => {
  const go = e.target.closest('button')?.dataset.go;
  if (!go) return;
  show(go);
});

function updateBadge() {
  const m = models.find((x) => x.id === settings.model);
  const live = settings.hasKey && settings.model;
  $('#modelBadge').textContent = live ? (m ? m.name : settings.model) : 'Offline mode';
  $('#modelBadge').title = live ? 'Model used for live sessions' : 'Practising from the question bank. Add an API key in Settings for live features.';
  $('#modelBadge').classList.toggle('off', !live);
}

// Live features need a key; offline bank practice never does.
const hasLive = () => !!(settings && settings.hasKey && settings.model);
function needLive(feature) {
  if (hasLive()) return false;
  toast(`${feature} uses the Claude API. Add your API key here to turn it on; the question bank keeps working without it.`);
  show('settings');
  return true;
}

// ---------- Settings ----------
function fillSettingsForm() {
  const first = !settings.hasKey;
  $('#settingsTitle').textContent = 'Settings';
  $('#settingsIntro').textContent = first
    ? 'An API key is optional. The question bank works fully offline. Add a key only for live sessions with Claude, generating new questions and the certification evaluator.'
    : '';
  $('#apiKey').value = '';
  $('#apiKey').placeholder = settings.hasKey ? `Saved (${settings.keyHint}) — paste a new key to replace` : 'sk-ant-…';
  $('#keyHint').textContent = '';
  $('#thinkingSelect').value = settings.thinking;
  $('#themeSelect').value = settings.theme || 'light';
  $('#maxTokens').value = settings.maxTokens;
  $('#priceIn').value = settings.priceIn;
  $('#priceOut').value = settings.priceOut;
  $('#clearKey').hidden = !settings.hasKey;
  renderModelOptions();
  setMsg('');
}

function renderModelOptions() {
  const sel = $('#modelSelect');
  if (!models.length) {
    sel.innerHTML = settings.model
      ? `<option value="${esc(settings.model)}">${esc(settings.model)}</option>`
      : '<option value="">Load models first</option>';
    sel.disabled = !settings.model;
    return;
  }
  sel.innerHTML = models
    .map((m) => {
      const tag = /opus/i.test(m.id) ? ' — recommended' : /haiku/i.test(m.id) ? ' — not recommended' : '';
      return `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.id)})${tag}</option>`;
    })
    .join('');
  sel.disabled = false;
  const current = models.find((m) => m.id === settings.model);
  sel.value = current ? current.id : defaultModel();
  if (!current) fillDefaultPrices(sel.value);
}

// Same defaults as main.js; the user can overwrite them.
function fillDefaultPrices(model) {
  const table = [
    [/fable|mythos/i, 10, 50],
    [/opus-5-5/i, 4, 20],
    [/opus/i, 5, 25],
    [/sonnet-5/i, 2, 10],
    [/sonnet/i, 3, 15],
    [/haiku-5-5/i, 0.1, 0.5],
    [/haiku/i, 1, 5],
  ];
  const row = table.find(([re]) => re.test(model)) || [null, 3, 15];
  const p = [row[1], row[2]];
  $('#priceIn').value = p[0];
  $('#priceOut').value = p[1];
}
$('#modelSelect').addEventListener('change', (e) => fillDefaultPrices(e.target.value));
// Appearance saves on its own, so offline users without a key can change it too.
$('#themeSelect').addEventListener('change', async (e) => {
  settings = await ipc.saveSettings({ theme: e.target.value });
});

// API returns newest first → first Opus is the newest Opus.
function defaultModel() {
  const opus = models.find((m) => /opus/i.test(m.id));
  const sonnet = models.find((m) => /sonnet/i.test(m.id));
  return (opus || sonnet || models[0] || {}).id || '';
}

function setMsg(text, kind) {
  const el = $('#settingsMsg');
  el.textContent = text;
  el.className = `msg ${kind || ''}`;
}

async function loadModels(silent) {
  const typed = $('#apiKey').value.trim();
  if (!typed && !settings.hasKey) return setMsg('Paste your API key first.', 'err');
  if (!silent) setMsg('Loading models…');
  try {
    models = await ipc.listModels(typed || undefined);
    renderModelOptions();
    updateBadge();
    if (!silent) setMsg(`Found ${models.length} models. Pick one and press Save.`, 'ok');
  } catch (err) {
    if (!silent) setMsg(cleanErr(err), 'err');
  }
}

$('#loadModels').addEventListener('click', () => loadModels(false));

$('#saveSettings').addEventListener('click', async () => {
  const key = $('#apiKey').value.trim();
  const model = $('#modelSelect').value;
  if (!key && !settings.hasKey) return setMsg('Paste your API key first.', 'err');
  if (!model) return setMsg('Load models and pick one first.', 'err');
  const maxTokens = Math.max(2048, Math.min(64000, parseInt($('#maxTokens').value, 10) || 16000));
  const priceIn = Math.max(0, parseFloat($('#priceIn').value) || 0);
  const priceOut = Math.max(0, parseFloat($('#priceOut').value) || 0);
  settings = await ipc.saveSettings({ apiKey: key || undefined, model, thinking: $('#thinkingSelect').value, maxTokens, priceIn, priceOut });
  updateBadge();
  fillSettingsForm();
  setMsg('Saved.', 'ok');
  setTimeout(() => show('home'), 500);
});

$('#clearKey').addEventListener('click', async () => {
  if (!confirm('Remove the saved API key from this computer?')) return;
  settings = await ipc.clearKey();
  models = [];
  updateBadge();
  fillSettingsForm();
});

// ---------- Home: start sessions ----------
const attached = { practice: [], fit: [] };

function renderFiles(kind) {
  const ul = kind === 'practice' ? $('#practiceFiles') : $('#fitFiles');
  ul.innerHTML = attached[kind]
    .map((f, i) => {
      const cost = f.tokens
        ? ` <span class="muted">· ≈ ${fmt(f.tokens)} tokens sent with every request (≈ ${money(f.costFirst)} the first time, then ≈ ${money(f.costTurn)} per turn from cache)</span>`
        : '';
      return `<li><span>📄 ${esc(f.name)}${cost}</span><button data-rm="${i}" title="Remove">✕</button></li>`;
    })
    .join('');
  ul.onclick = (e) => {
    const i = e.target.dataset.rm;
    if (i === undefined) return;
    attached[kind].splice(Number(i), 1);
    renderFiles(kind);
  };
  if (kind === 'fit') $('#startFit').disabled = attached.fit.length === 0;
}

async function attach(kind) {
  try {
    const files = await ipc.pickFiles();
    attached[kind].push(...files);
    renderFiles(kind);
  } catch (err) {
    alert(cleanErr(err));
  }
}
$('#attachPractice').addEventListener('click', () => attach('practice'));
$('#attachFit').addEventListener('click', () => attach('fit'));

// ---------- Training engine: adaptive level, exam readiness, recommendation ----------
// Everything is derived from the question log, so clearing history resets it.
const LEVELS = [
  null,
  { name: 'Foundation', desc: 'Real exam difficulty', mix: 'Exam-level only.' },
  { name: 'Developing', desc: 'Mostly exam-level, some Expert', mix: 'Difficulty mix: about 60% Exam-level and 40% Expert, no Diabolical.' },
  { name: 'Proficient', desc: 'Exam-level, Expert and Diabolical', mix: '' }, // the prompt's default mix
  { name: 'Advanced', desc: 'Expert and Diabolical', mix: 'Difficulty mix: about 60% Expert and 40% Diabolical, no Exam-level.' },
  { name: 'Master', desc: 'Diabolical only', mix: 'Diabolical only.' },
];
const LEVEL_WINDOW = 8; // judged on the last 8 answers
const LEVEL_UP = 6; // 6/8 correct → harder
const LEVEL_DOWN = 3; // 3/8 or fewer → easier
const READY_TARGET = 80;
// Missing a hard practice question is weaker evidence of missing a real exam question.
const WRONG_CREDIT = { 'Exam-level': 0, Expert: 0.2, Diabolical: 0.35 };
const DOMAIN_TARGET = { 1: 11, 2: 7, 3: 8, 4: 8, 5: 6 }; // ≈ 40 recent questions in exam proportions
const MAX_Q_SECONDS = 600; // longer gaps are idle time, not thinking time

let qCache = []; // question log, kept in sync locally so level changes are seen instantly
let training = { level: 1 };

// Answered or skipped CCA-F questions with a valid task statement like "1.4", oldest first.
const doneQs = (qs) =>
  qs.filter((q) => q.mode === 'practice' && (q.status === 'answered' || q.status === 'skipped') && /^[1-5]\.\d$/.test(q.task_statement));

// Replays the answer history: a sliding window of 8; a level change starts a fresh window.
function trainingLevel(done) {
  let level = 1;
  let win = [];
  for (const q of done) {
    win.push(q.isCorrect ? 1 : 0);
    if (win.length < LEVEL_WINDOW) continue;
    const correct = win.reduce((a, b) => a + b, 0);
    if (correct >= LEVEL_UP && level < 5) {
      level++;
      win = [];
    } else if (correct <= LEVEL_DOWN && level > 1) {
      level--;
      win = [];
    } else {
      win.shift();
    }
  }
  return { level, window: win };
}

function readiness(done) {
  const per = {};
  let total = 0;
  for (const d of [1, 2, 3, 4, 5]) {
    const qs = done.filter((q) => q.task_statement[0] === String(d)).slice(-30);
    const credit = qs.reduce((a, q) => a + (q.isCorrect ? 1 : q.status === 'skipped' ? 0 : WRONG_CREDIT[q.difficulty] || 0), 0);
    const score = qs.length ? credit / qs.length : 0;
    const coverage = Math.min(1, qs.length / DOMAIN_TARGET[d]);
    per[d] = { asked: qs.length, score, coverage, value: score * coverage };
    total += (DOMAIN_WEIGHT[d] / 100) * per[d].value;
  }
  // The domain costing the most readiness points.
  const gap = [1, 2, 3, 4, 5].sort((a, b) => DOMAIN_WEIGHT[b] * (1 - per[b].value) - DOMAIN_WEIGHT[a] * (1 - per[a].value))[0];
  return { pct: Math.round(100 * total), per, gap };
}

const stageOf = (p) => (p >= READY_TARGET ? 'Exam ready' : p >= 65 ? 'Almost ready' : p >= 40 ? 'Building' : 'Getting started');

function timeStats(done) {
  const secs = done.map((q) => q.seconds).filter((s) => s > 0);
  const recent = secs.slice(-30);
  return {
    total: secs.reduce((a, s) => a + Math.min(s, MAX_Q_SECONDS), 0),
    avg: recent.length ? Math.round(recent.reduce((a, s) => a + Math.min(s, MAX_Q_SECONDS), 0) / recent.length) : 0,
  };
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const duration = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);

function recommend(st, rd) {
  const g = rd.gap;
  const gp = rd.per[g];
  if (st.total < 5) return { length: '5', focus: 'all', why: 'Start with a quick drill so the app can measure your level.' };
  if (gp.coverage < 1) {
    return { length: '5', focus: 'domain', domain: g, why: `Domain ${g} (${DOMAIN_WEIGHT[g]}% of the exam) needs more practice: ${gp.asked} of ${DOMAIN_TARGET[g]} questions answered.` };
  }
  if (st.weak.length) return { length: '5', focus: 'weak', why: `${st.weak.length} task statement${st.weak.length > 1 ? 's are' : ' is'} below 70%: ${st.weak.map((w) => w.task).join(', ')}.` };
  if (rd.pct >= READY_TARGET) return { length: 'mock', focus: 'all', why: 'You are in the exam-ready zone. Check it under exam conditions.' };
  return { length: '10', focus: 'domain', domain: g, why: `Domain ${g} is holding your readiness back (score ${Math.round(100 * gp.score)}%).` };
}

// Shared readiness block for Home and Progress.
function readinessHTML(rd, lv, ts) {
  const L = LEVELS[lv.level];
  const correct = lv.window.reduce((a, b) => a + b, 0);
  const left = LEVEL_WINDOW - lv.window.length;
  const pips = Array.from({ length: LEVEL_WINDOW }, (_, i) => {
    const v = lv.window[i];
    return `<i class="${v === 1 ? 'ok' : v === 0 ? 'bad' : ''}"></i>`;
  }).join('');
  const levelHint =
    lv.level === 5 && lv.window.length < LEVEL_WINDOW
      ? 'Top level. Keep your accuracy up.'
      : left > 0
        ? `${correct}/${lv.window.length} correct so far. ${left} more answer${left > 1 ? 's' : ''} before the next level check (${LEVEL_UP}/${LEVEL_WINDOW} needed to level up).`
        : `${correct}/${LEVEL_WINDOW} in your last ${LEVEL_WINDOW}. ${LEVEL_UP} needed to level up.`;
  const g = rd.per[rd.gap];
  const hint =
    rd.pct >= READY_TARGET
      ? 'You are in the exam-ready zone across the weighted domains.'
      : g.coverage < 1
        ? `Biggest gain: answer ${DOMAIN_TARGET[rd.gap] - g.asked} more Domain ${rd.gap} question${DOMAIN_TARGET[rd.gap] - g.asked > 1 ? 's' : ''} (${esc(DOMAIN_NAMES[rd.gap])}).`
        : `Biggest gain: raise Domain ${rd.gap} (${esc(DOMAIN_NAMES[rd.gap])}), now scoring ${Math.round(100 * g.score)}%.`;
  const note = 'A practice estimate from accuracy, difficulty and coverage per domain, weighted like the exam. Not a predicted exam score.';
  return `<div class="rc-grid">
    <div class="rc-main">
      <div class="rc-top">
        <div><div class="eyebrow" title="${note}">Exam readiness <span class="info">ⓘ</span></div><span class="ready-pct">${rd.pct}%</span> <span class="ready-stage">${stageOf(rd.pct)}</span></div>
        <div class="level-chip" title="${esc(L.desc)}">Level ${lv.level} · ${L.name}</div>
      </div>
      <div class="ready-bar" role="progressbar" aria-valuenow="${rd.pct}" aria-valuemin="0" aria-valuemax="100"><i class="${rd.pct >= READY_TARGET ? 'done' : ''}" style="width:${rd.pct}%"></i><span class="target" style="left:${READY_TARGET}%" title="Exam-ready zone"></span></div>
      <div class="ready-scale"><span>Getting started</span><span>Building</span><span>Almost ready</span><span>Exam ready</span></div>
    </div>
    <div class="rc-side small">
      <p>${hint}</p>
      <div class="level-row"><span class="pips">${pips}</span><span class="muted">${levelHint}</span></div>
      ${ts.avg ? `<div class="muted">⏱ Average ${clock(ts.avg)} per question · ${duration(ts.total)} trained</div>` : ''}
    </div>
  </div>`;
}

// ---------- Home: session builder (type → focus → difficulty) ----------
const plan = { source: 'bank', length: '5', focus: 'all', level: 'adaptive' };
let sourceTouched = false; // until the user picks, the source follows whether the bank has questions
let weakTasks = [];
let rec = null;

function pick(group, value) {
  plan[group] = value;
  $$(`[data-group="${group}"] .choice`).forEach((b) => b.classList.toggle('sel', b.dataset.value === value));
  renderPlan();
}

$$('.choices').forEach((box) =>
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.choice');
    if (!b || b.disabled) return;
    if (box.dataset.group === 'source') sourceTouched = true;
    pick(box.dataset.group, b.dataset.value);
  })
);
$('#domainSel').addEventListener('change', renderPlan);
$('#scenarioSel').addEventListener('change', renderPlan);

function renderPlan() {
  const mock = plan.length === 'mock' || plan.length === 'exam';
  $('#stepFocus').classList.toggle('off', mock);
  $('#stepLevel').classList.toggle('off', mock);
  $('#mockNote').hidden = !mock;
  $('#mockNote').textContent =
    plan.length === 'exam'
      ? 'Like the real exam: 60 questions in 120 minutes from 4 random scenarios, in the official domain split. Move freely between questions, change answers, flag questions for review, and submit when ready. The clock keeps running if you leave.'
      : 'A mock exam copies the real exam: 4 random scenarios, the official domain split, Exam-level and Expert questions only, and no feedback until the end.';
  $('#domainSel').hidden = mock || plan.focus !== 'domain';
  $('#scenarioSel').hidden = mock || plan.focus !== 'scenario';
  const fromBank = plan.source === 'bank';
  // "Practice all" only makes sense for the bank; live sessions fall back to a quick drill.
  $('#lenAll').hidden = !fromBank;
  $('#focusMissed').hidden = !fromBank;
  $('#lenExam').hidden = !fromBank;
  if (!fromBank && plan.length === 'all') return pick('length', '5');
  if (!fromBank && plan.length === 'exam') return pick('length', 'mock');
  if (!fromBank && plan.focus === 'missed') return pick('focus', 'all');
  $('#planSummary').textContent = (fromBank ? 'From your question bank · ' : 'Live with Claude · ') + planText().summary + (fromBank ? bankAvailability() : '');
  $('#startTraining').textContent = fromBank ? 'Start instantly →' : 'Start training →';
}

// Builds the request sent to Claude (in the prompt's own command words) plus a title and summary.
function planText() {
  const p = plan;
  const n = p.length === 'exam' ? 60 : p.length === 'mock' ? 20 : p.length === 'all' ? 'all' : Number(p.length);
  const kind = { 5: 'Quick drill', 10: 'Quiz', mock: 'Mock exam', all: 'Practice all', exam: 'Exam simulation' }[p.length];
  const parts = [];
  const title = [kind];
  const summary = [`${n} questions`];

  if (p.length === 'exam') {
    summary.push('120 minutes', '4 random scenarios', 'official domain split');
  } else if (p.length === 'mock') {
    parts.push('Mock exam.');
    summary.push('real exam format');
  } else {
    if (p.focus === 'domain') {
      const d = $('#domainSel').value;
      parts.push(`Domain ${d}.`);
      title.push(`Domain ${d}`);
      summary.push(`Domain ${d}: ${DOMAIN_NAMES[d]}`);
    } else if (p.focus === 'scenario') {
      const s = $('#scenarioSel').value;
      parts.push(`Focus on the "${s}" scenario.`);
      title.push(s);
      summary.push(s);
    } else if (p.focus === 'weak' && weakTasks.length) {
      parts.push(`Target my weak task statements: ${weakTasks.join(', ')}. Spread the questions across them, each from a fresh angle, using a different scenario where the pairing rules allow.`);
      title.push('Weak areas');
      summary.push(`weak areas (${weakTasks.join(', ')})`);
    } else if (p.focus === 'missed') {
      title.push('Review mistakes');
      summary.push('questions you got wrong last time');
    } else {
      summary.push('all domains');
    }
    if (p.level === 'adaptive') {
      const L = LEVELS[training.level];
      if (L.mix) parts.push(L.mix);
      title.push(`Level ${training.level}`);
      summary.push(`adaptive: Level ${training.level} ${L.name}`);
    } else {
      parts.push(`${p.level} only.`);
      title.push(p.level);
      summary.push(`${p.level} only`);
    }
    parts.push(p.length === '10' ? 'Quiz me.' : `Generate ${n} questions.`);
  }
  if ($('#staticList').checked) {
    parts.unshift('Static list.');
    summary.push('printable list');
  }
  return { request: parts.join(' '), title: title.join(' · '), summary: summary.join(' · ') };
}
$('#staticList').addEventListener('change', renderPlan);

$('#startTraining').addEventListener('click', () => {
  const { request, title } = planText();
  if (plan.source === 'bank' && plan.length === 'exam') return startExam();
  if (plan.source === 'bank') {
    return startBankSession({ ...plan, domain: $('#domainSel').value, scenario: $('#scenarioSel').value, title });
  }
  startPractice(request, title, plan.level === 'adaptive' && plan.length !== 'mock');
});

function applyRec(r) {
  pick('length', r.length);
  if (r.domain) $('#domainSel').value = r.domain;
  pick('focus', r.focus);
  pick('level', 'adaptive');
}
$('#readyCard').addEventListener('click', (e) => {
  if (!e.target.closest('#startRec') || !rec) return;
  applyRec(rec);
  $('#startTraining').click();
});

// Clicking a domain in the readiness panel preselects it in the builder.
$('#readiness').addEventListener('click', (e) => {
  const row = e.target.closest('[data-domain]');
  if (!row) return;
  if (plan.length === 'mock') pick('length', '5');
  $('#domainSel').value = row.dataset.domain;
  pick('focus', 'domain');
  $('.train').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#startCustom').addEventListener('click', () => {
  const t = $('#customPractice').value.trim();
  if (t) startPractice(t, 'Custom practice');
});
$('#customPractice').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#startCustom').click();
});

function startPractice(request, title, adaptive = false) {
  const content = attached.practice.map((f) => f.block);
  if (content.length) request = `The official exam guide is attached.\n\n${request}`;
  content.push({ type: 'text', text: request });
  startChat('practice', `CCA-F Practice · ${title}`, content, request, adaptive);
}

$('#startFit').addEventListener('click', () => {
  const names = attached.fit.map((f) => f.name).join(', ');
  const text = `I've attached ${attached.fit.length} official exam guide(s): ${names}. Please begin.`;
  startChat('fit', 'Certification Fit Evaluator', [...attached.fit.map((f) => f.block), { type: 'text', text }], text);
});

// ---------- Per-session randomization ----------
// The prompts use a fixed answer-position sequence and tend to repeat favourite examples.
// Each session gets its own random plan, sent as an extra system block.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Balanced A/B/C/D positions (each letter equally often per block of 8), never 3 in a row.
function answerSequence(n) {
  const seq = [];
  while (seq.length < n) {
    let block;
    do {
      block = shuffle(['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D']);
    } while (block.some((l, i) => {
      const s = seq.concat(block);
      const k = seq.length + i;
      return k >= 2 && s[k] === s[k - 1] && s[k] === s[k - 2];
    }));
    seq.push(...block);
  }
  return seq.slice(0, n);
}

const SCENARIOS = [
  'Customer Support Resolution Agent',
  'Code Generation with Claude Code',
  'Multi-Agent Research System',
  'Developer Productivity with Claude',
  'Claude Code for Continuous Integration',
  'Structured Data Extraction',
];
const TASKS = { 1: 7, 2: 5, 3: 6, 4: 6, 5: 6 };

function sessionPlan(mode, past) {
  const seq = answerSequence(40).map((l, i) => `Q${i + 1} ${l}`).join(' · ');
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const lines = [
    '## Session randomization (generated by the app for this session only)',
    `- Answer positions: IGNORE the fixed sequence in the prompt. Use this one instead: ${seq}. After Q40, restart from Q1. For a Select-TWO item, use the question's slot plus the next slot; if both are the same letter, use the next different letter after it. Never mention this sequence.`,
  ];
  if (mode === 'practice') {
    const scen = shuffle(SCENARIOS);
    const tasks = Object.entries(TASKS)
      .map(([d, n]) => `D${d}: ${shuffle(Array.from({ length: n }, (_, i) => `${d}.${i + 1}`)).join(', ')}`)
      .join(' | ');
    lines.push(
      `- Scenario rotation order: ${scen.join(' → ')}. Follow it (pairing rules still win). For a mock exam, use the first four as the randomly drawn scenarios.`,
      `- Task-statement order: when choosing a task statement within a domain, take the next unused one in this order: ${tasks}.`
    );
  }
  // Concepts already asked in earlier sessions of this mode (most recent 80).
  const prior = (past || []).filter((q) => q.mode === mode && q.concept).slice(-80);
  if (prior.length) {
    lines.push(
      `- Already asked in earlier sessions — do NOT reuse these concepts, stems or scenario details. The same task statement is fine, but take a different angle and a different concept pair:`,
      ...prior.map((q) => `  - [${q.task_statement}${q.scenario ? ' · ' + q.scenario : ''}] ${q.concept}`)
    );
  }
  lines.push(
    `- Variety seed ${seed}: invent fresh company names, numbers, failure symptoms and situations for every question. Do not fall back on your most typical example for a task statement, and vary which concept pair is in tension.`
  );
  return lines.join('\n');
}

// ---------- Chat engine ----------
const chat = {
  sessionId: null,
  mode: null,
  title: '',
  plan: '',
  messages: [],
  pending: null, // { toolUses: [...], askEl } when waiting on the user
  openQ: null, // logged question awaiting the user's answer
  running: false,
  requestId: null,
  usage: { in: 0, out: 0, cacheRead: 0, cost: 0 },
};
const freshUsage = () => ({ in: 0, out: 0, cacheRead: 0, cost: 0 });

async function startChat(mode, title, firstContent, displayText, adaptive = false) {
  if (needLive(mode === 'fit' ? 'The certification evaluator' : 'Live practice with Claude')) return;
  // An offline bank session has nothing in flight and its answers are already saved.
  if (chat.mode && !chat.offline) {
    if (!confirm(`End the current session (“${chat.title}”) and start a new one?`)) return;
    if (chat.running) await ipc.abort(chat.requestId);
  }
  const past = await ipc.listQuestions();
  qCache = past;
  $('#composer').hidden = false;
  $('#sessionBar').hidden = true;
  Object.assign(chat, {
    offline: false,
    bank: null,
    sessionId: `s${Date.now()}`,
    mode,
    title,
    plan: sessionPlan(mode, past),
    messages: [],
    pending: null,
    openQ: null,
    repairs: 0,
    running: false,
    requestId: null,
    usage: freshUsage(),
    adaptive,
    level: trainingLevel(doneQs(past)).level,
    levelNote: '',
    awaitingFeedback: false,
    noFeedback: mode === 'fit' || /mock exam/i.test(displayText), // these hold feedback until the end
    activeMs: 0,
    activeSince: null,
    localNext: null,
    localNextRow: null,
  });
  $('#chatTitle').textContent = title;
  $('#log').innerHTML = '';
  updateUsage();
  show('chat');
  addUser(displayText);
  chat.messages.push({ role: 'user', content: firstContent });
  runTurn();
}

async function endChat() {
  chat.mode = null;
  chat.running = false;
  chat.pending = null;
  chat.openQ = null;
  chat.offline = false;
  chat.bank = null;
  chat.localNext = null;
  chat.localNextRow = null;
  $('#composer').hidden = false;
  $('#sessionBar').hidden = true;
  await ipc.clearSession();
  show('home');
}

$('#endChat').addEventListener('click', async () => {
  if (chat.running) {
    if (!confirm('A response is in progress. End the session anyway?')) return;
    await ipc.abort(chat.requestId);
  } else if (chat.messages.length > 2 && !confirm('End this session? It can no longer be resumed.')) {
    return;
  } else if (chat.offline && chat.bank && chat.bank.done > 0 && chat.bank.done < chat.bank.n) {
    if (!confirm('End this session now? Your answers so far are saved.')) return;
  }
  endChat();
});

$('#stopBtn').addEventListener('click', () => chat.requestId && ipc.abort(chat.requestId));

// Free-text input. If buttons are pending, the text answers the pending tool call.
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#input').value.trim();
  if (!text || chat.running) return;
  $('#input').value = '';
  addUser(text);
  if (chat.localNext != null) return sendLocalNext(text, true);
  if (chat.pending) {
    if (chat.openQ && chat.pending.letterAsk) {
      const letters = parseLetters(text);
      if (letters) answerQuestion(letters);
      else if (/^skip\b/i.test(text)) answerQuestion(null);
    }
    resolvePending(`The user did not click a button; they typed: "${text}"`);
  } else {
    chat.messages.push({ role: 'user', content: text });
    runTurn();
  }
});

// "B", "b", "A and C", "A, C", "A+C" → ['A'] / ['A','C']
function parseLetters(text) {
  const m = text.match(/^\s*([A-D])\s*(?:(?:,|\+|&|and)?\s*([A-D]))?\s*\.?$/i);
  if (!m) return null;
  return [m[1], m[2]].filter(Boolean).map((l) => l.toUpperCase());
}

// Active time: the clock runs only while it's the user's turn, never while Claude is writing.
const activeNow = () => (chat.activeMs || 0) + (chat.activeSince ? Date.now() - chat.activeSince : 0);

function setRunning(on) {
  chat.running = on;
  if (on && chat.activeSince) {
    chat.activeMs += Date.now() - chat.activeSince;
    chat.activeSince = null;
  } else if (!on && chat.mode && !chat.activeSince) {
    chat.activeSince = Date.now();
  }
  $('#stopBtn').hidden = !on;
  $('#composer button').disabled = on;
  $('#input').placeholder = on ? 'Claude is writing…' : 'Click an answer above, or type a letter or a question';
}

async function runTurn() {
  setRunning(true);
  const requestId = `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  chat.requestId = requestId;

  const bubble = addAssistant('');
  const body = bubble.querySelector('.md');
  let streamed = '';
  let raf = 0;
  // Until the question text starts streaming: a live timer. (Thinking stays hidden on purpose:
  // a summary could reveal the answer before the question appears.)
  const started = Date.now();
  const renderWaiting = () => {
    if (streamed) return;
    const secs = Math.floor((Date.now() - started) / 1000);
    body.innerHTML = `<div class="thinking-live"><span class="typing">${chat.messages.length <= 1 ? 'Preparing your first question' : 'Thinking'}</span> <span class="muted small">${secs}s</span></div>`;
  };
  renderWaiting();
  const tick = setInterval(renderWaiting, 1000);
  const offText = ipc.onDelta(({ requestId: id, delta }) => {
    if (id !== requestId) return;
    streamed += delta;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        body.innerHTML = md(streamed) + '<span class="typing"></span>';
        scrollDown();
      });
    }
  });
  // The question arrives in the button tool's `message`; show it as it streams.
  const offMsg = ipc.onMessage(({ requestId: id, text }) => {
    if (id !== requestId) return;
    streamed = text;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        body.innerHTML = md(streamed) + '<span class="typing"></span>';
        scrollDown();
      });
    }
  });
  const off = () => {
    offMsg();
    offText();
    clearInterval(tick);
  };

  try {
    const res = await ipc.send({ requestId, mode: chat.mode, messages: chat.messages, plan: chat.plan, costSoFar: chat.usage.cost });
    off();
    cancelAnimationFrame(raf);
    if (!chat.mode || chat.requestId !== requestId) return; // session ended or replaced while waiting
    chat.messages.push({ role: 'assistant', content: res.content });
    addUsage(res.usage, res.cost);

    const text = visibleContent(res.content);
    if (text.trim()) body.innerHTML = md(text);
    else bubble.remove();

    if (res.stop_reason === 'max_tokens') {
      addNotice('The response hit the max-token limit. Raise it in Settings, or type “continue”.');
    }

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    setRunning(false);
    if (toolUses.length) handleTools(toolUses, false, text);
    saveSession();
    scrollDown();
  } catch (err) {
    off();
    cancelAnimationFrame(raf);
    if (chat.requestId !== requestId) return; // a newer session owns the UI now
    bubble.remove();
    setRunning(false);
    if (!chat.mode) return;
    const aborted = /abort/i.test(String(err && err.message));
    addError(aborted ? 'Stopped.' : cleanErr(err), () => runTurn());
  }
}

const isLetterAsk = (q) => q && Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => /^[A-D]$/.test(o));

// What the user should see for one assistant response. Opus 5.5 / Sonnet 5.5 return text written
// between tool calls as hidden thinking blocks, so the button tool's `message` field is the
// reliable channel; plain text is only a fallback (e.g. a first turn with no tool calls).
function visibleContent(content) {
  const messages = content
    .filter((b) => b.type === 'tool_use' && b.name === 'ask_user_input_v0')
    .map((b) => String((b.input && b.input.message) || '').trim())
    .filter(Boolean);
  if (messages.length) return messages.join('\n\n');
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
}

const MISSING_QUESTION_REPLY =
  'ERROR — not an answer. The user sees answer buttons but no question: the question was not in the `message` field. ' +
  'Call log_question and ask_user_input_v0 again now, with the complete question (header block, stem, and options A–D in full) in ask_user_input_v0.message. Same question, same answer key.';

const MISSING_FEEDBACK_REPLY =
  'ERROR — not an answer. The user answered the question, but no explanation was shown. ' +
  'Call ask_user_input_v0 again with the same buttons, and put 1–2 sentences on why the correct answer is right in its `message` field (the app already showed right/wrong and the letter).';

// replay = true when rebuilding a resumed session: don't log again, don't auto-continue.
// visibleText = the text Claude wrote in this response (used to catch a missing question).
function handleTools(toolUses, replay, visibleText = '') {
  const asks = toolUses.filter((t) => t.name === 'ask_user_input_v0');
  const logs = toolUses.filter((t) => t.name === 'log_question');
  const askQs = asks.flatMap((t) => (t.input && t.input.questions) || []);

  // Answer buttons with no question on screen: ask Claude to resend it (once per question).
  if (!replay && askQs.length === 1 && isLetterAsk(askQs[0]) && !/(^|\n)\s*[*_]*[A-D][).:]/.test(visibleText)) {
    if ((chat.repairs || 0) < 1) {
      chat.repairs = (chat.repairs || 0) + 1;
      addNotice('The question text was missing — asking Claude to show it again…');
      const content = toolUses.map((t) => ({
        type: 'tool_result',
        tool_use_id: t.id,
        content: t.name === 'ask_user_input_v0' ? MISSING_QUESTION_REPLY : t.name === 'log_question' ? 'Not logged yet — log it again with the re-sent question.' : 'OK',
      }));
      chat.messages.push({ role: 'user', content });
      runTurn();
      return;
    }
    addNotice('Claude still did not show the question text. Type “show the question” to ask again.');
  }
  chat.repairs = 0;

  // The user answered but Claude replied with buttons and no explanation: ask for it (once).
  const wantedFeedback = chat.awaitingFeedback;
  chat.awaitingFeedback = false;
  if (!replay && wantedFeedback && asks.length && !logs.length && visibleText.trim().length < 80) {
    addNotice('The explanation was missing — asking Claude for it…');
    const content = toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: t.name === 'ask_user_input_v0' ? MISSING_FEEDBACK_REPLY : 'OK' }));
    chat.messages.push({ role: 'user', content });
    runTurn();
    return;
  }

  if (toolUses.some((t) => t.name === 'save_session_result')) addNotice('✓ Result saved to Progress');

  if (!replay) {
    for (const t of logs) {
      // A previously logged question that never got an answer is closed as unanswered.
      if (chat.openQ) closeQuestion(chat.openQ, { status: 'unanswered' });
      chat.openQ = logQuestion(t);
    }
  }

  if (!asks.length) {
    chat.pending = { toolUses, askEl: null, letterAsk: false };
    resolvePending(null);
    return;
  }
  // Render all questions from all ask calls in one widget.
  const questions = asks.flatMap((t) => (t.input && Array.isArray(t.input.questions) ? t.input.questions : []));
  // Eager-streamed tool input isn't validated by the API: a cut-off call can arrive without buttons.
  if (!replay && !questions.some((q) => q && Array.isArray(q.options) && q.options.length)) {
    addNotice('The answer buttons did not arrive — asking Claude to resend them…');
    chat.pending = { toolUses, askEl: null, letterAsk: false };
    resolvePending('ERROR — the buttons could not be shown because the tool input was incomplete. Call ask_user_input_v0 again with the same message and options.');
    return;
  }
  const letterAsk = questions.length === 1 && isLetterAsk(questions[0]);
  const askEl = renderAsk(questions, (answers) => {
    addUser(answers.map((a) => a.selected.join(' + ')).join(' · '));
    const rec = letterAsk ? chat.openQ : null;
    if (rec) answerQuestion(answers[0].selected);
    const lines = answers.map((a) => `${a.question} ${a.selected.join(', ')}`).join('\n');
    if (rec && localNextOk(rec)) return showLocalNext(lines);
    resolvePending(lines);
  });
  chat.pending = { toolUses, askEl, letterAsk };
}

// ---------- Local "What next?" menu (live practice) ----------
// The app already shows right/wrong, the key and Claude's `why`, so a separate API turn just to
// show "Next question / Explain in depth" is wasted. The app shows those buttons itself and sends
// the answer and the choice to Claude in one tool result (see APP_ADDENDUM in main.js).
const localNextOk = (rec) => chat.mode === 'practice' && !chat.offline && !chat.noFeedback && !!rec.why;

function showLocalNext(answerText) {
  if (chat.pending && chat.pending.askEl) disableAsk(chat.pending.askEl);
  chat.localNext = answerText;
  chat.localNextRow = actionRow(
    [
      ['next', 'Next question →', true],
      ['explain', '🔍 Explain in depth'],
    ],
    (act) => sendLocalNext(act === 'next' ? '➡️ Next question' : '🔍 Explain in depth', false)
  );
  $('#input').placeholder = 'Pick an option above, or type a question';
}

function sendLocalNext(choice, typed) {
  const answer = chat.localNext;
  if (answer == null || chat.running) return;
  chat.localNext = null;
  if (chat.localNextRow) closeRow(chat.localNextRow);
  chat.localNextRow = null;
  if (!typed) addUser(choice);
  resolvePending(`${answer}\n\n${typed ? `Then the user typed: "${choice}"` : `What next? ${choice}`}`);
}

// Build one user message with a tool_result for every tool_use in the last assistant turn.
function resolvePending(answerText) {
  const { toolUses, askEl } = chat.pending;
  if (askEl) disableAsk(askEl);
  chat.pending = null;
  if (answerText && chat.levelNote) answerText += `\n\n${chat.levelNote}`;
  chat.levelNote = '';
  const reply = { ask_user_input_v0: answerText || 'No answer.', save_session_result: 'Saved to history.', log_question: 'Logged.' };
  const content = toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: reply[t.name] || 'OK' }));
  chat.messages.push({ role: 'user', content });
  runTurn();
}

// ---------- Question log ----------
function logQuestion(t) {
  const q = t.input || {};
  const rec = {
    id: t.id,
    sessionId: chat.sessionId,
    date: new Date().toISOString(),
    mode: chat.mode,
    model: settings.model,
    number: q.number ?? null,
    task_statement: String(q.task_statement || '').trim(),
    domain: q.domain || '',
    scenario: q.scenario || '',
    difficulty: q.difficulty || '',
    format: q.format || ((q.correct || []).length > 1 ? 'select_two' : 'single'),
    concept: q.concept || '',
    why: q.why || '',
    correct: (q.correct || []).map((l) => String(l).toUpperCase()).sort(),
    selected: null,
    status: 'open',
    isCorrect: null,
    startActive: activeNow(), // question clock starts once the question is on screen
  };
  ipc.upsertQuestion(rec);
  qCache.push(rec);
  return rec;
}

// letters = array of selected letters, or null for a skip.
function answerQuestion(letters) {
  const rec = chat.openQ;
  if (!rec) return;
  const sel = letters ? letters.map((l) => l.toUpperCase()).sort() : null;
  closeQuestion(rec, {
    selected: sel,
    status: sel ? 'answered' : 'skipped',
    isCorrect: !!sel && sel.join() === rec.correct.join(),
    seconds: Math.max(1, Math.round((rec.startActive != null ? activeNow() - rec.startActive : Date.now() - Date.parse(rec.date)) / 1000)),
  });
  chat.openQ = null;
  if (!chat.noFeedback) {
    if (chat.pending && chat.pending.askEl) markAnswer(chat.pending.askEl, rec);
    addVerdict(rec);
    chat.awaitingFeedback = !rec.why; // only chase Claude for an explanation if the log had none
  }
  checkLevel();
}

// Colours the answer buttons: correct letter(s) green, a wrong pick red.
function markAnswer(askEl, rec) {
  askEl.querySelectorAll('.opt').forEach((b) => {
    const l = b.textContent.trim();
    if (rec.correct.includes(l)) b.classList.add('right');
    else if (rec.selected && rec.selected.includes(l)) b.classList.add('wrong');
  });
}

// The app's own verdict, straight from the logged answer key, plus Claude's one-line why.
function addVerdict(rec) {
  if (!rec.correct.length) return;
  const key = rec.correct.map((l) => `<span class="key">${esc(l)}</span>`).join(' ');
  const session = qCache.filter((q) => q.sessionId === chat.sessionId && (q.status === 'answered' || q.status === 'skipped'));
  const score = `Score ${session.filter((q) => q.isCorrect).length}/${session.length}`;
  const meta = `<span class="muted">${score}${rec.seconds ? ` · ⏱ ${clock(rec.seconds)}` : ''}</span>`;
  const head =
    rec.status === 'skipped'
      ? `<b>Skipped</b> · correct answer ${key}`
      : rec.isCorrect
        ? `<b>✓ Correct</b> · ${key}`
        : `<b>✗ Incorrect</b> · you chose ${esc(rec.selected.join(' + '))} · correct answer ${key}`;
  const el = document.createElement('div');
  el.className = `verdict ${rec.isCorrect ? 'ok' : 'bad'}`;
  el.innerHTML = `<div class="v-head"><span>${head}</span>${meta}</div>${rec.why ? `<div class="v-why">${inline(rec.why)}</div>` : ''}`;
  $('#log').appendChild(el);
  if (!rec.isCorrect) addStudyGuide(rec); // which lesson, rule and trap to study (guide.js)
  scrollDown();
}

// Level changes take effect immediately: a notice, and in adaptive sessions a note to Claude.
function checkLevel() {
  if (chat.mode !== 'practice' || !chat.level) return;
  const lv = trainingLevel(doneQs(qCache)).level;
  if (lv === chat.level) return;
  const up = lv > chat.level;
  const L = LEVELS[lv];
  addNotice(up ? `⬆ Level up! You reached Level ${lv} · ${L.name}. Questions get harder from here.` : `⬇ Level ${lv} · ${L.name}. Easing off a little to rebuild accuracy.`);
  chat.level = lv;
  training.level = lv;
  if (chat.adaptive && !chat.noFeedback) {
    chat.levelNote = `(App note, not from the user: the learner's level changed to ${lv} of 5. For all remaining questions in this session use this difficulty: ${L.mix || 'the default mix (Exam-level, Expert, Diabolical)'} Do not mention this note; you may say the difficulty is ${up ? 'going up' : 'easing'}.)`;
  }
}

function closeQuestion(rec, patch) {
  Object.assign(rec, patch, { answeredAt: new Date().toISOString() });
  ipc.upsertQuestion(rec);
}

// ---------- Resume ----------
function saveSession() {
  if (!chat.mode) return;
  const { sessionId, mode, title, plan, messages, usage, openQ, adaptive, noFeedback } = chat;
  const elapsed = Math.round(activeNow() / 1000);
  ipc.saveSession({ sessionId, mode, title, plan, messages, usage, openQ, adaptive, noFeedback, elapsed, model: settings.model, savedAt: new Date().toISOString() });
}

async function refreshResumeBanner() {
  const el = $('#resumeBanner');
  if (chat.mode) {
    // A live session: offer a way back instead of a resume.
    el.hidden = false;
    $('#resumeLabel').textContent = 'Session in progress';
    $('#resumeText').textContent = chat.title;
    $('#resumeBtn').textContent = 'Back to session';
    $('#discardBtn').hidden = true;
    return;
  }
  const s = await ipc.loadSession();
  el.hidden = !s;
  $('#resumeLabel').textContent = 'Unfinished session';
  $('#resumeBtn').textContent = 'Resume';
  $('#discardBtn').hidden = false;
  if (s) $('#resumeText').textContent = `${s.title} · last activity ${new Date(s.savedAt).toLocaleString()}`;
}

$('#resumeBtn').addEventListener('click', async () => {
  if (chat.mode) return show('chat');
  const s = await ipc.loadSession();
  if (!s) return refreshResumeBanner();
  qCache = await ipc.listQuestions();
  // The saved openQ is a copy; point it at the cached record so answers update both.
  const openQ = s.openQ && (qCache.find((q) => q.id === s.openQ.id) || s.openQ);
  Object.assign(chat, {
    adaptive: !!s.adaptive,
    noFeedback: !!s.noFeedback,
    level: trainingLevel(doneQs(qCache)).level,
    levelNote: '',
    awaitingFeedback: false,
    activeMs: (s.elapsed || 0) * 1000,
    activeSince: Date.now(),
    sessionId: s.sessionId,
    mode: s.mode,
    title: s.title,
    plan: s.plan,
    messages: s.messages,
    usage: s.usage || freshUsage(),
    openQ: openQ || null,
    pending: null,
    running: false,
    requestId: null,
  });
  $('#chatTitle').textContent = s.title;
  updateUsage();
  rebuildLog();
  show('chat');
});

$('#discardBtn').addEventListener('click', async () => {
  if (!confirm('Discard the unfinished session?')) return;
  await ipc.clearSession();
  refreshResumeBanner();
});

// Re-render the transcript from the saved messages and re-open the last pending buttons.
function rebuildLog() {
  $('#log').innerHTML = '';
  const msgs = chat.messages;
  const names = {}; // tool_use id -> tool name
  msgs.forEach((m) => Array.isArray(m.content) && m.content.forEach((b) => b.type === 'tool_use' && (names[b.id] = b.name)));
  msgs.forEach((m, i) => {
    const isLast = i === msgs.length - 1;
    if (m.role === 'user') {
      if (typeof m.content === 'string') return addUser(m.content);
      for (const b of m.content) {
        if (b.type === 'text') addUser(b.text);
        else if (b.type === 'tool_result' && names[b.tool_use_id] === 'ask_user_input_v0') addUser(answerDisplay(String(b.content)));
      }
      if (isLast) addError('The last request did not finish.', () => runTurn());
      return;
    }
    const text = visibleContent(m.content);
    if (text.trim()) addAssistant(text);
    const toolUses = m.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) return;
    if (isLast) {
      handleTools(toolUses, true); // re-opens the buttons as pending
    } else {
      const qs = toolUses.filter((t) => t.name === 'ask_user_input_v0').flatMap((t) => t.input.questions || []);
      if (qs.length) disableAsk(renderAsk(qs, () => {}));
      if (toolUses.some((t) => t.name === 'save_session_result')) addNotice('✓ Result saved to Progress');
    }
  });
  addNotice('Session resumed.');
  scrollDown();
}

function answerDisplay(content) {
  const typed = content.match(/they typed: "([\s\S]*)"$/);
  if (typed) return typed[1];
  return content
    .split('\n')
    .map((l) => l.replace(/^.*?[?:]\s*/, ''))
    .join(' · ');
}

function renderAsk(questions, onDone) {
  const wrap = document.createElement('div');
  wrap.className = 'ask';
  const state = questions.map(() => new Set());
  const needsSubmit = questions.length > 1 || questions.some((q) => q.type === 'multi_select');

  questions.forEach((q, qi) => {
    const qEl = document.createElement('div');
    qEl.className = 'q';
    qEl.innerHTML = esc(q.question) + (q.type === 'multi_select' ? '<span class="hint">select all that apply</span>' : '');
    const opts = document.createElement('div');
    opts.className = 'opts';
    (q.options || []).forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.textContent = o;
      b.addEventListener('click', () => {
        if (wrap.classList.contains('done') || chat.running) return;
        const set = state[qi];
        if (q.type === 'multi_select') {
          set.has(o) ? set.delete(o) : set.add(o);
          b.classList.toggle('sel', set.has(o));
        } else {
          set.clear();
          set.add(o);
          opts.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', x === b));
        }
        if (!needsSubmit) finish();
        else submit.disabled = state.some((s) => s.size === 0);
      });
      opts.appendChild(b);
    });
    wrap.append(qEl, opts);
  });

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'primary';
  submit.textContent = 'Submit';
  submit.disabled = true;
  submit.addEventListener('click', finish);
  if (needsSubmit) wrap.appendChild(submit);

  function finish() {
    if (wrap.classList.contains('done')) return;
    const answers = questions.map((q, i) => ({
      question: q.question,
      selected: (q.options || []).filter((o) => state[i].has(o)),
    }));
    onDone(answers);
  }

  $('#log').appendChild(wrap);
  scrollDown();
  return wrap;
}

function disableAsk(el) {
  el.classList.add('done');
  el.querySelectorAll('button').forEach((b) => (b.disabled = true));
}

// ---------- Log helpers ----------
function addAssistant(text) {
  const el = document.createElement('div');
  el.className = 'bubble assistant';
  el.innerHTML = `<div class="md">${md(text)}</div>`;
  $('#log').appendChild(el);
  scrollDown();
  return el;
}
function addUser(text) {
  const el = document.createElement('div');
  el.className = 'bubble user';
  el.innerHTML = `<div>${esc(text)}</div>`;
  $('#log').appendChild(el);
  scrollDown();
}
function addNotice(text) {
  const el = document.createElement('div');
  el.className = 'bubble system';
  el.textContent = text;
  $('#log').appendChild(el);
}
function addError(text, retry) {
  const el = document.createElement('div');
  el.className = 'bubble error';
  el.textContent = text;
  if (retry) {
    const b = document.createElement('button');
    b.className = 'secondary';
    b.textContent = 'Retry';
    b.onclick = () => {
      el.remove();
      retry();
    };
    el.appendChild(b);
  }
  $('#log').appendChild(el);
  scrollDown();
}
function scrollDown() {
  const log = $('#log');
  log.scrollTop = log.scrollHeight;
}
function addUsage(u, cost) {
  if (!u) return;
  chat.usage.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  chat.usage.cacheRead += u.cache_read_input_tokens || 0;
  chat.usage.out += u.output_tokens || 0;
  chat.usage.cost += cost || 0;
  setSpend(getSpend() + (cost || 0));
  updateUsage();
}
function updateUsage() {
  const { in: i, out, cacheRead, cost } = chat.usage;
  $('#costChip').textContent = `≈ ${money(cost)}`;
  $('#costChip').title = `Estimated cost of this session. All training so far: ≈ ${money(getSpend())}`;
  $('#usage').textContent = i ? `${fmt(i)} in (${fmt(cacheRead)} cached) / ${fmt(out)} out tokens` : '';
}

// Running total of API spend across all sessions (this computer only; reset with history).
function getSpend() {
  try {
    return parseFloat(localStorage.getItem('totalSpend')) || 0;
  } catch {
    return 0;
  }
}
function setSpend(v) {
  try {
    localStorage.setItem('totalSpend', String(v));
  } catch {}
}
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const money = (n) => `$${(n || 0).toFixed(n < 1 ? 3 : 2)}`;

function cleanErr(err) {
  const m = String((err && err.message) || err);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- Progress stats (from the question log, practice mode only) ----------
const DOMAIN_NAMES = {
  1: 'Agentic Architecture',
  2: 'Tool Design & MCP',
  3: 'Claude Code Config',
  4: 'Prompt Eng. & Output',
  5: 'Context & Reliability',
};

function practiceStats(qs) {
  // Answered or skipped CCA-F questions with a valid task statement like "1.4". Skips count as wrong.
  const done = qs.filter((q) => q.mode === 'practice' && (q.status === 'answered' || q.status === 'skipped') && /^[1-5]\.\d$/.test(q.task_statement));
  const recent = done.slice(-300);
  const tally = (key) => {
    const m = {};
    for (const q of recent) {
      const k = key(q);
      m[k] = m[k] || { asked: 0, correct: 0, last: '' };
      m[k].asked++;
      if (q.isCorrect) m[k].correct++;
      m[k].last = q.date;
    }
    return m;
  };
  const byDomain = tally((q) => q.task_statement[0]);
  const byTask = tally((q) => q.task_statement);
  const weak = Object.entries(byTask)
    .map(([task, s]) => ({ task, ...s, acc: s.correct / s.asked }))
    .filter((t) => t.acc < 0.7)
    .sort((a, b) => a.acc - b.acc || b.asked - a.asked || b.last.localeCompare(a.last))
    .slice(0, 5);
  const correct = recent.filter((q) => q.isCorrect).length;
  return { total: done.length, recentCount: recent.length, correct, byDomain, weak };
}

const DOMAIN_WEIGHT = { 1: 27, 2: 18, 3: 20, 4: 20, 5: 15 };

// Dashboard: headline stats, per-domain readiness, weak-area availability.
async function refreshHome() {
  const [qs, hist] = await Promise.all([ipc.listQuestions(), ipc.listHistory()]);
  qCache = qs;
  const st = practiceStats(qs);
  const done = doneQs(qs);
  const lv = trainingLevel(done);
  const rd = readiness(done);
  const ts = timeStats(done);
  training = { level: lv.level };
  const pct = (c, a) => (a ? Math.round((100 * c) / a) : 0);

  $('#statAnswered').textContent = st.total;
  $('#statAccuracy').textContent = st.recentCount ? `${pct(st.correct, st.recentCount)}%` : '—';
  $('#statSessions').textContent = hist.length;
  $('#statTime').textContent = ts.total ? duration(ts.total) : '—';
  // First run with spend tracking: seed it from the costs already saved with finished sessions.
  try {
    if (localStorage.getItem('totalSpend') === null) setSpend(hist.reduce((a, h) => a + (h.cost || 0), 0));
  } catch {}
  $('#statSpend').textContent = `≈ ${money(getSpend())}`;
  $('#statSpend').closest('.stat').hidden = !getSpend() && !hasLive(); // offline-only users never spend
  $('#adaptiveText').textContent = `Level ${lv.level} · ${LEVELS[lv.level].desc}`;

  $('#readiness').innerHTML = [1, 2, 3, 4, 5]
    .map((d) => {
      const s = st.byDomain[d] || { asked: 0, correct: 0 };
      const p = pct(s.correct, s.asked);
      const score = s.asked ? `${p}% <span class="muted">(${s.correct}/${s.asked})</span>` : '<span class="muted">not started</span>';
      return `<button class="dom-row" data-domain="${d}" title="Train Domain ${d}">
        <span class="dom-name"><b>D${d}</b> ${esc(DOMAIN_NAMES[d])} <span class="muted small">${DOMAIN_WEIGHT[d]}%</span></span>
        <span class="dom-score small">${score}</span>
        <span class="bar"><i style="width:${p}%"></i></span>
      </button>`;
    })
    .join('');

  weakTasks = st.weak.map((w) => w.task);
  const hasWeak = weakTasks.length > 0;
  $('#focusWeak').disabled = !hasWeak;
  $('#startWeak').disabled = !hasWeak;
  $('#weakText').textContent = hasWeak
    ? weakTasks.join(', ')
    : st.total
      ? 'None below 70% right now'
      : 'Unlocks after a few answers';
  if (!hasWeak && plan.focus === 'weak') pick('focus', 'all');

  rec = recommend(st, rd);
  const kind = { 5: 'Quick drill', 10: 'Quiz', mock: 'Mock exam' }[rec.length];
  const focus = rec.focus === 'domain' ? `Domain ${rec.domain}: ${DOMAIN_NAMES[rec.domain]}` : rec.focus === 'weak' ? 'Weak areas' : 'All domains';
  const level = rec.length === 'mock' ? 'exam format' : `Level ${lv.level} · ${LEVELS[lv.level].name}`;
  $('#readyCard').innerHTML = `${readinessHTML(rd, lv, ts)}
    <div class="rec">
      <div><div class="eyebrow">Recommended next session</div><b>${esc(kind)} · ${esc(focus)} · ${esc(level)}</b><div class="small muted">${esc(rec.why)}</div></div>
      <button id="startRec" class="primary big">Start →</button>
    </div>`;
  renderPlan();
  refreshBank();
}

$('#startWeak').addEventListener('click', () => {
  if (!weakTasks.length) return;
  if (plan.length === 'mock') pick('length', '5');
  pick('focus', 'weak');
  $('#startTraining').click();
});

function renderOverview(qs) {
  const st = practiceStats(qs);
  const box = $('#overview');
  if (!st.total) {
    box.innerHTML = '';
    return;
  }
  const pct = (c, a) => (a ? Math.round((100 * c) / a) : 0);
  const doms = [1, 2, 3, 4, 5]
    .map((d) => {
      const s = st.byDomain[d] || { asked: 0, correct: 0 };
      return `<div class="dom">D${d} ${esc(DOMAIN_NAMES[d])} — ${s.asked ? `${s.correct}/${s.asked} (${pct(s.correct, s.asked)}%)` : 'not yet'}<div class="bar"><i style="width:${pct(s.correct, s.asked)}%"></i></div></div>`;
    })
    .join('');
  const weak = st.weak.length
    ? `<div class="small"><b>Weakest task statements</b><ul class="weaklist">${st.weak.map((w) => `<li>${esc(w.task)} — ${w.correct}/${w.asked} correct</li>`).join('')}</ul></div>`
    : '';
  const done = doneQs(qs);
  box.innerHTML = `<div class="overview">${readinessHTML(readiness(done), trainingLevel(done), timeStats(done))}</div>
  <div class="overview">
    <h2>CCA-F progress</h2>
    <div class="stats">
      <div class="stat"><b>${st.total}</b><span class="muted small">questions answered</span></div>
      <div class="stat"><b>${pct(st.correct, st.recentCount)}%</b><span class="muted small">correct (last ${st.recentCount})</span></div>
    </div>
    <div class="doms">${doms}</div>
    ${weak}
    <p class="muted small">Practice questions are deliberately harder than the real exam, so these numbers run low on purpose. Skips count as wrong.</p>
  </div>`;
}

// ---------- API usage breakdown (from the per-request log kept by main.js) ----------
function renderUsage(usage, qs) {
  const box = $('#usageBox');
  if (!usage.length) {
    if (!hasLive()) return (box.innerHTML = ''); // offline only: nothing to report
    box.innerHTML = '<div class="overview"><h2>API usage</h2><p class="muted small">A cost breakdown appears here after your next request.</p></div>';
    return;
  }
  const sum = (k) => usage.reduce((a, r) => a + (r[k] || 0), 0);
  const total = sum('cost');
  const parts = [
    ['Output (incl. thinking)', 'costOutput', 'output', 'out'],
    ['Cache writes', 'costWrite', 'cacheWrite', 'write'],
    ['Uncached input', 'costInput', 'input', 'in'],
    ['Cache reads', 'costRead', 'cacheRead', 'read'],
  ];
  const since = usage[0].date;
  const answered = qs.filter((q) => q.answeredAt && q.answeredAt >= since && (q.status === 'answered' || q.status === 'skipped')).length;
  const pct = (v) => (total ? Math.round((100 * v) / total) : 0);
  const bar = parts.map(([, k, , cls]) => `<i class="u-${cls}" style="width:${pct(sum(k))}%"></i>`).join('');
  const rows = parts
    .map(([label, k, tok, cls]) => `<tr><td><span class="dot u-${cls}"></span>${label}</td><td>${fmt(sum(tok))} tokens</td><td>≈ ${money(sum(k))}</td><td>${pct(sum(k))}%</td></tr>`)
    .join('');
  const recent = usage
    .slice(-8)
    .reverse()
    .map(
      (r) =>
        `<tr><td>${new Date(r.date).toLocaleTimeString()}</td><td>${fmt(r.input + r.cacheWrite + r.cacheRead)} in · ${fmt(r.cacheRead)} cached</td><td>${fmt(r.output)} out</td><td>≈ ${money(r.cost)}</td></tr>`
    )
    .join('');
  box.innerHTML = `<div class="overview">
    <h2>API usage</h2>
    <div class="stats">
      <div class="stat"><b>≈ ${money(total)}</b><span class="muted small">${usage.length} requests since ${new Date(since).toLocaleDateString()}</span></div>
      <div class="stat"><b>≈ ${money(total / usage.length)}</b><span class="muted small">per request</span></div>
      ${answered ? `<div class="stat"><b>≈ ${money(total / answered)}</b><span class="muted small">per answered question</span></div>` : ''}
    </div>
    <div class="u-bar">${bar}</div>
    <table class="u-table">${rows}</table>
    <details class="more"><summary>Last ${Math.min(8, usage.length)} requests</summary><table class="u-table">${recent}</table></details>
    <p class="muted small">Output includes Claude's hidden thinking. To spend less, set Quality vs. cost to Low in Settings, or use Sonnet 5.5 for drills. Estimates use the prices in Settings.</p>
  </div>`;
}

// ---------- History ----------
async function renderHistory() {
  const [list, qs, usage] = await Promise.all([ipc.listHistory(), ipc.listQuestions(), ipc.listUsage()]);
  renderUsage(usage, qs);
  renderOverview(qs);
  renderInsights(qs);
  const box = $('#historyList');
  if (!list.length) {
    box.innerHTML = '<div class="empty">No finished sessions yet. Results are saved automatically when a quiz or evaluation ends.</div>';
    return;
  }
  box.innerHTML = list
    .map((h) => {
      const pct = h.answered ? Math.round((100 * h.correct) / h.answered) : 0;
      const doms = (h.by_domain || [])
        .map((d) => {
          const p = d.asked ? Math.round((100 * d.correct) / d.asked) : 0;
          return `<div class="dom">${esc(d.domain)} — ${d.correct}/${d.asked}<div class="bar"><i style="width:${p}%"></i></div></div>`;
        })
        .join('');
      const extra = [
        h.recommendation && `<div><b>Recommendation:</b> ${esc(h.recommendation)}</div>`,
        h.missed_task_statements && h.missed_task_statements.length && `<div class="small"><b>Missed:</b> ${esc(h.missed_task_statements.join(', '))}</div>`,
        h.focus_next && `<div class="small"><b>Focus next:</b> ${esc(h.focus_next)}</div>`,
      ]
        .filter(Boolean)
        .join('');
      return `<div class="hist">
        <div class="top">
          <div><b>${esc(h.title || h.kind)}</b><div class="muted small">${new Date(h.date).toLocaleString()} · ${esc(h.model || '')}${h.skipped ? ` · ${h.skipped} skipped` : ''}${h.cost != null ? ` · ≈ ${money(h.cost)}` : ''}</div></div>
          <div class="score">${h.correct}/${h.answered} <span class="muted small">${pct}%</span></div>
        </div>
        <div class="doms">${doms}</div>${extra}
      </div>`;
    })
    .join('');
}

async function resetHistory() {
  if (!confirm('Reset all progress?\n\nThis deletes every saved session result and the question log, and clears your curriculum progress (lessons read, quiz and scenario-lab scores, rule-drill cards). Your readiness, level, weak areas, time stats and repeat-avoidance all start over. Your exam date and settings are kept. This cannot be undone.')) return false;
  await Promise.all([ipc.clearHistory(), ipc.clearQuestions(), ipc.clearUsage()]);
  qCache = [];
  training = { level: 1 };
  setSpend(0);
  resetLearnProgress(); // learn.js: lessons read, steps, quiz/lab scores, drill boxes
  return true;
}
$('#clearHistory').addEventListener('click', async () => (await resetHistory()) && renderHistory());
$('#resetProgress').addEventListener('click', async () => {
  if (await resetHistory()) setMsg('Progress and history reset.', 'ok');
});

// ---------- Timer ----------
setInterval(() => {
  if (!chat.mode) return ($('#timer').textContent = '');
  const now = activeNow();
  const q = chat.openQ && chat.openQ.startActive != null ? ` · this question ${clock((now - chat.openQ.startActive) / 1000)}` : '';
  const budget = chat.bank && chat.bank.mock ? ` / ${clock(chat.bank.n * 120)}` : '';
  $('#timer').textContent = `⏱ ${clock(now / 1000)}${budget}${q}${chat.running ? ' · paused while Claude writes' : ''}`;
  $('#timer').classList.toggle('over', !!budget && now / 1000 > chat.bank.n * 120);
}, 1000);

// ---------- Boot ----------
// Starts after every script (bank.js, learn.js, …) has run: they define functions the home screen uses.
window.addEventListener('DOMContentLoaded', async function init() {
  settings = await ipc.getSettings();
  if (settings.hasKey) loadModels(true); // fill display names in the background
  updateBadge();
  show('home');
});
