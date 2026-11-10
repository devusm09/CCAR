/* Claude Cert Coach — offline question bank.
 * Generation: the app plans one "slot" per question (task statement, difficulty, answer letter)
 * and main.js sends them as a Message Batches API job. Practice: questions are picked locally
 * (unseen first, then missed, at the learner's adaptive difficulty) with no API calls.
 * Loaded after app.js and uses its globals. */
'use strict';

const bank = { items: [], jobs: [] };
const LETTERS = ['A', 'B', 'C', 'D'];
const DOMAIN_FULL = {
  1: 'Agentic Architecture & Orchestration',
  2: 'Tool Design & MCP Integration',
  3: 'Claude Code Configuration & Workflows',
  4: 'Prompt Engineering & Structured Output',
  5: 'Context Management & Reliability',
};
// Difficulty mix per adaptive level (matches LEVELS in app.js).
const LEVEL_MIX = {
  1: { 'Exam-level': 1 },
  2: { 'Exam-level': 0.6, Expert: 0.4 },
  3: { 'Exam-level': 0.2, Expert: 0.6, Diabolical: 0.2 },
  4: { Expert: 0.6, Diabolical: 0.4 },
  5: { Diabolical: 1 },
};
const BALANCED_MIX = { 'Exam-level': 0.4, Expert: 0.4, Diabolical: 0.2 };
const MOCK_MIX = { 'Exam-level': 0.75, Expert: 0.25 };

// ---------- Bank state ----------
async function refreshBank() {
  try {
    const r = await ipc.listBank();
    bank.items = r.bank;
    bank.jobs = r.jobs;
  } catch {
    return;
  }
  // Default to the bank once it has questions, unless the user chose a source themselves.
  if (!sourceTouched || !hasLive()) pick('source', bank.items.length || !hasLive() ? 'bank' : 'live');
  renderBankCard();
  renderPlan();
  if (bank.jobs.some((j) => j.status === 'in_progress')) pollBankNow();
}

async function pollBankNow() {
  try {
    const r = await ipc.pollBank();
    bank.jobs = r.jobs;
    if (r.added) {
      bank.items = (await ipc.listBank()).bank;
      toast(`✓ ${r.added} new question${r.added > 1 ? 's' : ''} added to your bank`);
    }
    renderBankCard();
    renderPlan();
  } catch {
    // Offline or no key: try again on the next tick.
  }
}
setInterval(() => bank.jobs.some((j) => j.status === 'in_progress') && pollBankNow(), 60_000);

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 6000);
}

// Per-bank-question history from the question log: times seen, correct, last result.
function bankStats() {
  const m = {};
  for (const q of qCache) {
    if (!q.bankId || (q.status !== 'answered' && q.status !== 'skipped')) continue;
    const s = (m[q.bankId] = m[q.bankId] || { seen: 0, correct: 0, lastCorrect: false });
    s.seen++;
    if (q.isCorrect) s.correct++;
    s.lastCorrect = !!q.isCorrect;
  }
  return m;
}

// ---------- Spaced repetition ----------
// A missed bank question comes back 1, 3 and 7 days later; three correct reviews in a row retire it.
// A correct answer before the due day doesn't advance it, so same-day retries can't skip the spacing.
// Everything is derived from the question log, so Reset history resets it too.
const SRS_DAYS = [1, 3, 7];
const DAY = 864e5;
const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
function srsState() {
  const recs = qCache
    .filter((q) => q.bankId && q.answeredAt && (q.status === 'answered' || q.status === 'skipped'))
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const by = {};
  for (const q of recs) {
    const t = Date.parse(q.answeredAt);
    const s = (by[q.bankId] = by[q.bankId] || { active: false, step: 0, due: 0 });
    if (!q.isCorrect) Object.assign(s, { active: true, step: 0, due: dayStart(t) + SRS_DAYS[0] * DAY });
    else if (s.active && t >= s.due) {
      s.step++;
      if (s.step >= SRS_DAYS.length) s.active = false;
      else s.due = dayStart(t) + SRS_DAYS[s.step] * DAY;
    }
  }
  return Object.fromEntries(Object.entries(by).filter(([, s]) => s.active));
}
function srsSummary() {
  const st = srsState();
  const tomorrow = dayStart(Date.now()) + DAY;
  const known = new Set(bank.items.map((it) => it.id));
  const due = bank.items.filter((it) => st[it.id] && st[it.id].due < tomorrow);
  const later = Object.entries(st).filter(([id, s]) => known.has(id) && s.due >= tomorrow);
  const next = later.length ? Math.min(...later.map(([, s]) => s.due)) : 0;
  return { due, later: later.length, next };
}
function renderSrsBanner() {
  const { due, later, next } = srsSummary();
  const el = $('#srsBanner');
  el.hidden = !due.length && !later;
  if (el.hidden) return;
  $('#srsTitle').textContent = due.length ? `${due.length} question${due.length > 1 ? 's' : ''} due for review today` : 'No reviews due today';
  const when = next ? new Date(next).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  $('#srsSub').textContent = due.length
    ? `Spaced repetition: questions you missed come back after 1, 3 and 7 days until you get them right three times.${later ? ` ${later} more scheduled.` : ''}`
    : `${later} question${later > 1 ? 's' : ''} scheduled · next review ${when}.`;
  $('#srsStart').hidden = !due.length;
}
$('#srsStart').addEventListener('click', () => {
  const { due } = srsSummary();
  if (!due.length) return;
  startBankSession({ length: String(due.length), focus: 'review', items: due, level: 'adaptive', title: 'Spaced review' });
});

function bankPool(focus, domain, scenario) {
  if (focus === 'review') return srsSummary().due;
  if (focus === 'missed') {
    const stats = bankStats();
    return bank.items.filter((it) => stats[it.id] && !stats[it.id].lastCorrect);
  }
  if (focus === 'domain') return bank.items.filter((it) => it.task_statement[0] === String(domain));
  if (focus === 'scenario') return bank.items.filter((it) => it.scenario === scenario);
  if (focus === 'weak') return bank.items.filter((it) => weakTasks.includes(it.task_statement));
  return bank.items;
}

// Shown after the plan summary on the Train tab.
function bankAvailability() {
  const pool = bankPool(plan.length === 'mock' || plan.length === 'exam' ? 'all' : plan.focus, $('#domainSel').value, $('#scenarioSel').value);
  const stats = bankStats();
  const unseen = pool.filter((it) => !stats[it.id]).length;
  if (!bank.items.length) return ' · your bank is empty';
  if (plan.focus === 'missed' && plan.length !== 'mock') return pool.length ? ` · ${pool.length} to retry` : ' · nothing to retry yet';
  if (!pool.length) return ' · no bank questions for this focus yet';
  return ` · ${pool.length} in bank (${unseen} unseen)`;
}

function renderBankCard() {
  const stats = bankStats();
  const n = bank.items.length;
  const unseen = bank.items.filter((it) => !stats[it.id]).length;
  const missed = bank.items.filter((it) => stats[it.id] && !stats[it.id].lastCorrect).length;
  const builtIn = bank.items.filter((it) => it.builtIn).length;
  const mine = n - builtIn;
  const byDomain = [1, 2, 3, 4, 5].map((d) => `D${d} ${bank.items.filter((it) => it.task_statement[0] === String(d)).length}`).join(' · ');
  $('#bankStatus').innerHTML = n
    ? `<div class="bank-nums"><b>${n}</b> question${n === 1 ? '' : 's'} · <b>${unseen}</b> unseen · <b>${missed}</b> to retry</div><div class="muted">${builtIn ? `${builtIn} built-in${mine ? ` + ${mine} generated` : ''} · ` : ''}${byDomain}</div>`
    : '<div class="muted">Empty. Generate a collection once, then practise instantly and offline at no API cost.</div>';
  $('#sourceBankText').textContent = n ? `${unseen} unseen · instant, no API cost` : 'Empty: import or generate questions';
  $('#sourceLiveText').textContent = hasLive() ? 'Fresh questions, uses the API' : 'Needs an API key (Settings)';
  $('#missedText').textContent = missed ? `${missed} question${missed === 1 ? '' : 's'} you got wrong` : 'Nothing to retry yet';
  $('#focusMissed').disabled = !missed;
  if (!missed && plan.focus === 'missed') pick('focus', 'all');
  renderSrsBanner();
  $('#bankDelete').hidden = !mine;
  $('#bankExport').hidden = !n;
  $('#genBox').hidden = !hasLive();
  $('#genLocked').hidden = hasLive();
  if (n < 20 && hasLive()) $('#genBox').open = true; // small bank: keep the generator in view

  $('#bankJobs').innerHTML = bank.jobs
    .filter((j) => j.status === 'in_progress' || (j.endedAt && Date.now() - Date.parse(j.endedAt) < 6 * 3600e3))
    .slice(-3)
    .reverse()
    .map((j) => {
      const c = j.counts || {};
      const finished = (c.succeeded || 0) + (c.errored || 0) + (c.canceled || 0) + (c.expired || 0);
      const pct = j.count ? Math.round((100 * finished) / j.count) : 0;
      const when = new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (j.status === 'in_progress') {
        return `<div class="job"><div class="row between"><span>⏳ ${esc(j.label)}</span>${
          j.canceling ? '<span class="muted small">canceling…</span>' : `<button class="ghost small-btn" data-cancel="${esc(j.id)}">Cancel</button>`
        }</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="muted tiny">Submitted ${when} · ${finished}/${j.count} done · checked every minute${j.error ? ` · ${esc(j.error)}` : ''}</div></div>`;
      }
      return `<div class="job done">✓ ${esc(j.label)}: ${j.imported} added${j.failed ? `, ${j.failed} failed` : ''}${j.canceled ? `, ${j.canceled} canceled` : ''} · ≈ ${money(j.cost)}</div>`;
    })
    .join('');
  renderGenEstimate();
}

$('#bankJobs').addEventListener('click', async (e) => {
  const id = e.target.dataset.cancel;
  if (!id || !confirm('Cancel this batch? Questions that already finished are still imported.')) return;
  try {
    bank.jobs = await ipc.cancelBank(id);
    renderBankCard();
  } catch (err) {
    alert(cleanErr(err));
  }
});

$('#bankDelete').addEventListener('click', async () => {
  if (!confirm('Delete the questions you generated on this computer? The built-in questions, your scores and your history are kept.')) return;
  await ipc.clearBank();
  refreshBank();
});

$('#bankExport').addEventListener('click', async () => {
  try {
    const r = await ipc.exportBank();
    if (r) toast(`✓ Exported ${r.count} questions. Share the file; teammates use Import.`);
  } catch (err) {
    alert(cleanErr(err));
  }
});

$('#bankImport').addEventListener('click', async () => {
  try {
    const r = await ipc.importBank();
    if (!r) return;
    toast(`✓ Imported ${r.added} new question${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already in your bank or invalid)` : ''}`);
    refreshBank();
  } catch (err) {
    alert(cleanErr(err));
  }
});

// ---------- Generation ----------
function fillGenFocus() {
  const opts = [
    ['all', 'All domains (exam weights)'],
    ...[1, 2, 3, 4, 5].map((d) => [`d${d}`, `Domain ${d}: ${DOMAIN_FULL[d]}`]),
    ['weak', 'My weak areas'],
    ...SCENARIOS.map((s) => [`s:${s}`, `Scenario: ${s}`]),
  ];
  $('#genFocus').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
}
fillGenFocus();

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = Math.random() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[entries.length - 1][0];
}

// Splits n into whole counts per key, proportional to weights (largest remainder).
function apportion(n, weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const raw = Object.entries(weights).map(([k, w]) => [k, (n * w) / total]);
  const out = Object.fromEntries(raw.map(([k, v]) => [k, Math.floor(v)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b[1] % 1) - (a[1] % 1)).forEach(([k]) => left-- > 0 && out[k]++);
  return out;
}

// One slot per question: which task statement, difficulty, format and answer letter(s).
function buildSpecs(count, focusValue, levelValue) {
  const allTasks = Object.entries(TASKS).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => `${d}.${i + 1}`));
  const used = {}; // how many questions each task statement already has (bank + this batch)
  for (const it of bank.items) used[it.task_statement] = (used[it.task_statement] || 0) + 1;
  const leastUsed = (tasks) => {
    const t = shuffle(tasks).sort((a, b) => (used[a] || 0) - (used[b] || 0))[0];
    used[t] = (used[t] || 0) + 1;
    return t;
  };

  let taskFor;
  let scenario = null;
  if (focusValue.startsWith('d')) {
    const tasks = allTasks.filter((t) => t[0] === focusValue[1]);
    taskFor = () => leastUsed(tasks);
  } else if (focusValue === 'weak') {
    const tasks = weakTasks.length ? weakTasks.slice() : allTasks;
    taskFor = () => leastUsed(tasks);
  } else if (focusValue.startsWith('s:')) {
    scenario = focusValue.slice(2);
    taskFor = () => null; // Claude picks a task statement the scenario pairing allows
  } else {
    const perDomain = apportion(count, DOMAIN_WEIGHT);
    const queue = shuffle(Object.entries(perDomain).flatMap(([d, k]) => Array(k).fill(d)));
    taskFor = (i) => leastUsed(allTasks.filter((t) => t[0] === queue[i]));
  }

  const mix =
    levelValue === 'balanced' ? BALANCED_MIX : levelValue === 'adaptive' ? LEVEL_MIX[training.level] : { [levelValue]: 1 };
  const diffs = shuffle(Object.entries(apportion(count, mix)).flatMap(([d, k]) => Array(k).fill(d)));
  const letters = answerSequence(count * 2);
  const hints = shuffle(SCENARIOS);
  let li = 0;

  return diffs.map((difficulty, i) => {
    const task = taskFor(i);
    // About one in six Expert/Diabolical items is Select TWO, like the real exam's share.
    const format = difficulty !== 'Exam-level' && Math.random() < 0.17 ? 'select_two' : 'single';
    const first = letters[li++];
    let ans = [first];
    if (format === 'select_two') {
      let second = letters[li++];
      if (second === first) second = LETTERS.find((l) => l !== first && !ans.includes(l));
      ans = [first, second].sort();
    }
    const avoid = bank.items
      .filter((it) => (task ? it.task_statement === task : it.scenario === scenario))
      .slice(-15)
      .map((it) => it.concept)
      .filter(Boolean);
    return {
      task,
      scenario,
      scenarioHint: scenario ? null : hints[i % hints.length],
      difficulty,
      format,
      letters: ans,
      avoid,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
    };
  });
}

function renderGenEstimate() {
  const n = Number($('#genCount').value);
  // Measured: ~2K output per question (incl. thinking + explanation) plus the ~15K-token prompt,
  // partly served from cache across the batch; the Batch API halves everything.
  const per = ((2000 * settings.priceOut + 15000 * settings.priceIn * 0.4) / 1e6) * 0.5;
  $('#genEstimate').textContent = `Estimated cost ≈ ${money(per * n)} for ${n} questions (≈ ${money(per)} each with the Batch API's 50% discount).`;
}
$('#genCount').addEventListener('change', renderGenEstimate);

$('#genStart').addEventListener('click', async () => {
  if (needLive('Generating questions')) return;
  const count = Number($('#genCount').value);
  const focus = $('#genFocus').value;
  const level = $('#genLevel').value;
  if (focus === 'weak' && !weakTasks.length && !confirm('You have no weak areas yet, so this will cover all task statements. Continue?')) return;
  const label = `${count} questions · ${$('#genFocus').selectedOptions[0].textContent} · ${$('#genLevel').selectedOptions[0].textContent.replace(' (recommended)', '')}`;
  const btn = $('#genStart');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    bank.jobs = await ipc.generateBank({ specs: buildSpecs(count, focus, level), label });
    toast('Batch submitted. The questions will appear in your bank when it finishes.');
    $('#genBox').open = false;
    renderBankCard();
  } catch (err) {
    alert(cleanErr(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate with Batch API';
  }
});

// ---------- Offline practice ----------
const TASK_NAMES = {
  '1.1': 'Agentic loops',
  '1.2': 'Coordinator–subagent orchestration',
  '1.3': 'Subagent invocation and context passing',
  '1.4': 'Multi-step workflows and handoff',
  '1.5': 'Agent SDK hooks',
  '1.6': 'Task decomposition',
  '1.7': 'Session state, resume and fork',
  '2.1': 'Tool interfaces and descriptions',
  '2.2': 'Structured MCP error responses',
  '2.3': 'Tool distribution and tool_choice',
  '2.4': 'MCP servers',
  '2.5': 'Built-in tools',
  '3.1': 'CLAUDE.md hierarchy',
  '3.2': 'Slash commands and skills',
  '3.3': 'Path-specific rules',
  '3.4': 'Plan mode vs direct execution',
  '3.5': 'Iterative refinement',
  '3.6': 'Claude Code in CI/CD',
  '4.1': 'Explicit criteria',
  '4.2': 'Few-shot prompting',
  '4.3': 'Structured output and schemas',
  '4.4': 'Validation and retry loops',
  '4.5': 'Batch processing',
  '4.6': 'Multi-instance and multi-pass review',
  '5.1': 'Preserving critical information',
  '5.2': 'Escalation and ambiguity',
  '5.3': 'Error propagation across agents',
  '5.4': 'Context in large codebases',
  '5.5': 'Human review and confidence',
  '5.6': 'Provenance in multi-source synthesis',
};

// Plain-text version, used when a bank question is handed to a live Claude session.
function bankQuestionMarkdown(item, num, total) {
  const d = item.task_statement[0];
  const head = [
    '---',
    `SCENARIO: ${item.scenario}`,
    `DOMAIN: ${d} — ${DOMAIN_FULL[d]}`,
    `TASK: ${item.task_statement}`,
    `FORMAT: ${item.format === 'select_two' ? 'Select TWO' : 'Single answer'}`,
    `DIFFICULTY: ${item.difficulty}`,
    '---',
  ].join('\n');
  const label = num ? `**Question ${num} of ${total}**` : '**Question**';
  return `${head}\n\n${label}\n${item.question}\n\n${LETTERS.map((l) => `${l}) ${item.options[l]}`).join('\n\n')}`;
}

const diffClass = (d) => `diff-${String(d).toLowerCase().replace(/[^a-z]/g, '')}`;

// The question header: number, difficulty and format chips, then scenario · domain · task.
function questionHead(item, label) {
  const d = item.task_statement[0];
  return `<div class="q-top"><span class="q-num">${label}</span>
      <span class="chip ${diffClass(item.difficulty)}">${esc(item.difficulty)}</span>${item.format === 'select_two' ? '<span class="chip two">Select TWO</span>' : ''}</div>
    <div class="q-meta"><span>${esc(item.scenario || 'General')}</span><span>D${d} ${esc(DOMAIN_FULL[d])}</span><span>${esc(item.task_statement)} ${esc(TASK_NAMES[item.task_statement] || '')}</span></div>
    <div class="q-stem">${inline(item.question)}</div>`;
}

const optionsHTML = (item) =>
  `<div class="q-opts">${LETTERS.map(
    (l) => `<button type="button" class="q-opt" data-letter="${l}"><span class="q-letter">${l}</span><span class="q-text">${inline(item.options[l])}</span></button>`
  ).join('')}</div>`;

// Green for the key, red for a wrong pick; `picked` keeps the user's own choice visible.
function revealOptions(root, item, selected) {
  root.querySelectorAll('.q-opt').forEach((b) => {
    const l = b.dataset.letter;
    const picked = !!selected && selected.includes(l);
    b.classList.toggle('picked', picked);
    if (item.correct.includes(l)) b.classList.add('right');
    else if (picked) b.classList.add('wrong');
  });
}

// One interactive question card. onAnswer(letters, card) — letters is null for a skip.
function renderQuestionCard(item, num, total, onAnswer) {
  const two = item.format === 'select_two';
  const el = document.createElement('div');
  el.className = 'qcard';
  el.innerHTML = `${questionHead(item, `Question ${num} of ${total}`)}${optionsHTML(item)}
    <div class="q-actions">
      <span class="muted tiny">${two ? 'Choose two options, then Submit' : 'Click an option'} · keys <kbd>A</kbd>–<kbd>D</kbd>${two ? ' · <kbd>Enter</kbd> submits' : ''} · <kbd>S</kbd> skips</span>
      <span class="row"><button type="button" class="ghost small-btn" data-act="skip">Skip</button>${two ? '<button type="button" class="primary" data-act="submit" disabled>Submit</button>' : ''}</span>
    </div>`;
  const picked = [];
  const finish = (letters) => {
    if (el.classList.contains('done')) return;
    el.classList.add('done');
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    onAnswer(letters, el);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || el.classList.contains('done')) return;
    if (b.dataset.act === 'skip') return finish(null);
    if (b.dataset.act === 'submit') return picked.length === 2 && finish(picked.slice());
    const l = b.dataset.letter;
    if (!l) return;
    if (!two) return finish([l]);
    const i = picked.indexOf(l);
    if (i >= 0) picked.splice(i, 1);
    else {
      picked.push(l);
      if (picked.length > 2) picked.shift(); // a third click swaps out the oldest pick
    }
    el.querySelectorAll('.q-opt').forEach((x) => x.classList.toggle('sel', picked.includes(x.dataset.letter)));
    el.querySelector('[data-act="submit"]').disabled = picked.length !== 2;
  });
  $('#log').appendChild(el);
  scrollDown();
  return el;
}

// A row of action buttons after an answer or at the end; actions = [[key, label, primary?], ...].
function actionRow(actions, onPick) {
  const row = document.createElement('div');
  row.className = 'q-next';
  row.innerHTML = actions.map(([k, label, primary]) => `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="${k}">${esc(label)}</button>`).join('');
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || row.classList.contains('done')) return;
    onPick(b.dataset.act, b, row);
  });
  $('#log').appendChild(row);
  scrollDown();
  return row;
}
const closeRow = (row) => {
  row.classList.add('done');
  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
};

function updateSessionBar() {
  const b = chat.bank;
  $('#sessionBar').hidden = !b;
  if (!b) return;
  $('#sessionBar').firstElementChild.style.width = `${b.n ? (100 * b.done) / b.n : 0}%`;
  const right = b.results.filter((r) => r.rec.isCorrect).length;
  $('#usage').textContent = b.mock ? `${b.done}/${b.n} answered` : `${b.done}/${b.n} answered · ${right} correct`;
}

async function startBankSession(opts) {
  if (!bank.items.length) await refreshBank(); // clicked before the bank finished loading
  const mock = opts.length === 'mock';
  const focus = mock ? 'all' : opts.focus;
  const pool = opts.items || bankPool(focus, opts.domain, opts.scenario);
  const wanted = mock ? 20 : opts.length === 'all' ? pool.length : Number(opts.length) || pool.length;
  if (!pool.length) {
    if (focus === 'missed') return toast('Nothing to retry: you have no missed questions right now.');
    if (!hasLive()) return toast('No bank questions match this focus yet. Pick another domain or scenario.');
    if (confirm('Your question bank has no questions for this yet.\n\nOK: open the generator to create some (they arrive within about an hour).\nCancel: stay here.')) {
      openGenerator(focus, opts);
    }
    return;
  }
  if (chat.mode && !chat.offline && !confirm(`End the current session (“${chat.title}”) and start a new one?`)) return;
  if (chat.running) await ipc.abort(chat.requestId);
  qCache = await ipc.listQuestions();
  const n = Math.min(wanted, pool.length);
  const title = `Bank · ${opts.title}`;
  Object.assign(chat, {
    sessionId: `b${Date.now()}`,
    mode: 'practice',
    offline: true,
    title,
    plan: '',
    messages: [],
    pending: null,
    openQ: null,
    running: false,
    requestId: null,
    usage: freshUsage(),
    adaptive: !mock && opts.level === 'adaptive',
    level: trainingLevel(doneQs(qCache)).level,
    levelNote: '',
    awaitingFeedback: false,
    noFeedback: mock,
    activeMs: 0,
    activeSince: Date.now(),
    bank: { opts, n, done: 0, pool, used: new Set(), focus, level: mock ? 'mock' : opts.level, mock, results: [] },
  });
  $('#chatTitle').textContent = title;
  $('#log').innerHTML = '';
  $('#composer').hidden = true; // offline: answers come from the cards
  updateUsage();
  $('#costChip').textContent = 'offline · $0';
  updateSessionBar();
  show('chat');
  const kind = { 5: 'Quick drill', 10: 'Quiz', mock: 'Mock exam', all: 'Practice all' }[opts.length] || 'Session';
  const more = pool.length > n ? ` · ${pool.length - n} more available afterwards` : '';
  addNotice(`⚡ ${kind}: ${n} question${n > 1 ? 's' : ''}${n < wanted ? ` (only ${n} available for this focus)` : ''}${more} · offline, no API cost`);
  if (mock) addNotice(`Mock exam: no feedback until the end, like the real exam. Time budget ${clock(n * 120)} (2 minutes per question).`);
  nextBankQuestion();
}

// Takes the user to the generator, preset to the focus they were trying to practise.
function openGenerator(focus, opts = {}) {
  if (needLive('Generating questions')) return;
  if (chat.mode && chat.offline) endChat();
  show('home');
  const value = focus === 'domain' ? `d${opts.domain}` : focus === 'scenario' ? `s:${opts.scenario}` : focus === 'weak' ? 'weak' : 'all';
  if ([...$('#genFocus').options].some((o) => o.value === value)) $('#genFocus').value = value;
  $('#genBox').open = true;
  const card = $('#bankCard');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

// Picks the next question: unseen first, then previously missed, at the wanted difficulty.
// Retry sessions skip both preferences: every question in the pool is wanted.
function pickNext(b) {
  const stats = bankStats();
  const pool = b.pool.filter((it) => !b.used.has(it.id));
  if (!pool.length) return null;
  const mix = b.mock ? MOCK_MIX : b.level === 'adaptive' ? LEVEL_MIX[chat.level || training.level] : { [b.level]: 1 };
  const wantDiff = weightedPick(mix);
  const wantDomain = b.focus === 'all' ? weightedPick(DOMAIN_WEIGHT) : null;
  const retry = b.focus === 'missed' || b.focus === 'retry' || b.focus === 'review';
  let best = null;
  let bestScore = Infinity;
  for (const it of pool) {
    const s = stats[it.id];
    const seen = retry || !s ? 0 : !s.lastCorrect ? 10 : 20 + s.correct; // unseen < missed < mastered
    const score = seen + (retry || it.difficulty === wantDiff ? 0 : 15) + (wantDomain && it.task_statement[0] !== wantDomain ? 4 : 0) + Math.random();
    if (score < bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return best;
}

function nextBankQuestion() {
  const b = chat.bank;
  if (!b) return;
  if (b.done >= b.n) return finishBankSession();
  const item = pickNext(b);
  if (!item) return finishBankSession();
  b.used.add(item.id);
  const num = b.done + 1;
  const rec = logQuestion({
    id: `${item.id}~${chat.sessionId}`,
    input: {
      number: num,
      task_statement: item.task_statement,
      domain: `D${item.task_statement[0]} ${DOMAIN_FULL[item.task_statement[0]]}`,
      scenario: item.scenario,
      difficulty: item.difficulty,
      format: item.format,
      concept: item.concept,
      why: item.why,
      correct: item.correct,
    },
  });
  rec.bankId = item.id;
  chat.openQ = rec;
  renderQuestionCard(item, num, b.n, (letters, card) => onBankAnswer(item, letters, card));
}

function onBankAnswer(item, letters, card) {
  const b = chat.bank;
  if (!b) return;
  const rec = chat.openQ;
  chat.pending = null;
  answerQuestion(letters); // scores it, shows the verdict (unless mock) and checks the level
  chat.awaitingFeedback = false;
  chat.levelNote = '';
  if (b.mock) card.querySelectorAll('.q-opt').forEach((x) => x.classList.toggle('picked', !!letters && letters.includes(x.dataset.letter)));
  else revealOptions(card, item, letters);
  b.done++;
  b.results.push({ rec, item });
  updateSessionBar();
  if (b.mock) {
    addNotice(`Recorded (${b.done}/${b.n}).`);
    return nextBankQuestion();
  }
  showNextActions(item, rec);
}

function showNextActions(item, rec) {
  const b = chat.bank;
  const last = b.done >= b.n;
  const actions = [['next', last ? '🏁 See results' : 'Next question →', true]];
  if (item.explanation) actions.push(['explain', '🔍 Explain in depth']);
  actions.push(['ask', hasLive() ? '💬 Ask Claude about this' : '💬 Ask Claude (needs API key)']);
  let explainEl = null;
  actionRow(actions, (act, btn, row) => {
    if (act === 'explain') {
      if (explainEl) {
        explainEl.remove();
        explainEl = null;
        btn.textContent = '🔍 Explain in depth';
        return;
      }
      explainEl = document.createElement('div');
      explainEl.className = 'q-explain md';
      explainEl.innerHTML = md(item.explanation);
      row.before(explainEl);
      btn.textContent = 'Hide explanation';
      return;
    }
    if (act === 'ask') return askClaudeAbout(item, rec);
    closeRow(row);
    nextBankQuestion();
  });
}

// Hands one question to a live Claude session for discussion or a dispute.
function askClaudeAbout(item, rec) {
  const answered = rec.selected ? rec.selected.join(' and ') : 'nothing (skipped)';
  const text =
    `I'm practising from my offline question bank and want to discuss one question. Don't start a quiz or write new questions unless I ask.\n\n` +
    `${bankQuestionMarkdown(item)}\n\nThe answer key says ${item.correct.join(' and ')}. I answered ${answered}.\n\n` +
    `Explain why the key is right and where my reasoning may have gone wrong. If you think the key is wrong, say so and explain why.`;
  startChat('practice', `Discuss · Task ${item.task_statement}`, [{ type: 'text', text }], text);
}

// Expandable per-question review: the full question, your pick, the key and the explanation.
function renderReview(segment, from, container = $('#log')) {
  const box = document.createElement('div');
  box.className = 'review';
  const wrong = segment.filter(({ rec }) => !rec.isCorrect).length;
  box.innerHTML = `<div class="review-head"><b>Review</b><span class="muted small">${wrong ? `${wrong} to study` : 'All correct'} · click a question to expand it</span></div>`;
  segment.forEach(({ rec, item }, i) => {
    const ok = rec.isCorrect;
    const d = document.createElement('details');
    d.className = `review-item ${ok ? 'ok' : 'bad'}`;
    if (!ok && wrong <= 3) d.open = true;
    const stem = item.question.length > 110 ? `${item.question.slice(0, 107)}…` : item.question;
    d.innerHTML = `<summary><span class="mark">${ok ? '✓' : rec.status === 'skipped' ? '–' : '✗'}</span><span class="r-num">${from + i + 1}</span><span class="r-stem">${inline(stem)}</span><span class="chip ${diffClass(item.difficulty)}">${esc(item.task_statement)}</span></summary>
      <div class="r-body">${questionHead(item, `Question ${from + i + 1}`)}${optionsHTML(item)}
        <div class="small">You chose <b>${rec.selected ? esc(rec.selected.join(' + ')) : 'nothing (skipped)'}</b> · correct <b>${esc(item.correct.join(' + '))}</b></div>
        ${item.why ? `<div class="v-why">${inline(item.why)}</div>` : ''}
        ${ok ? '' : studyGuideHTML(item.task_statement, item, rec)}
        ${item.explanation ? `<div class="q-explain md">${md(item.explanation)}</div>` : ''}</div>`;
    const body = d.querySelector('.r-body');
    body.querySelectorAll('.q-opt').forEach((b) => (b.disabled = true));
    revealOptions(body, item, rec.selected);
    box.appendChild(d);
  });
  container.appendChild(box);
}

function finishBankSession() {
  const b = chat.bank;
  if (!b || b.finished) return;
  b.finished = true;
  chat.openQ = null;
  // A session can be extended with "Keep going"; each part gets its own summary and Progress entry.
  const from = b.savedFrom || 0;
  const part = b.part || 1;
  const segment = b.results.slice(from);
  const res = segment.map((r) => r.rec);
  const answered = res.length;
  const correct = res.filter((r) => r.isCorrect).length;
  const pct = answered ? Math.round((100 * correct) / answered) : 0;
  const byDomain = [1, 2, 3, 4, 5]
    .map((d) => {
      const rs = res.filter((r) => r.task_statement[0] === String(d));
      return { domain: `D${d} ${DOMAIN_NAMES[d]}`, asked: rs.length, correct: rs.filter((r) => r.isCorrect).length };
    })
    .filter((x) => x.asked);
  const missed = [...new Set(res.filter((r) => !r.isCorrect).map((r) => r.task_statement))];
  const secs = Math.round(activeNow() / 1000);
  const all = b.results.map((r) => r.rec);
  const allCorrect = all.filter((r) => r.isCorrect).length;

  const card = document.createElement('div');
  card.className = 'result-card';
  const tone = pct >= 80 ? 'ok' : pct >= 60 ? 'mid' : 'bad';
  card.innerHTML = `<div class="rc-score ${tone}"><b>${pct}%</b><span>${correct}/${answered} correct</span></div>
    <div class="rc-body">
      <div class="eyebrow">${part > 1 ? `Part ${part} complete` : b.mock ? 'Mock exam complete' : 'Session complete'}</div>
      <div class="small muted">⏱ ${clock(secs)} total · ${all.length ? clock(secs / all.length) : '0:00'} per question${b.mock ? ` · budget ${clock(b.n * 120)}` : ''}${
        part > 1 ? ` · whole session ${allCorrect}/${all.length} (${Math.round((100 * allCorrect) / all.length)}%)` : ''
      }</div>
      <div class="doms">${byDomain
        .map((x) => `<div class="dom">${esc(x.domain)} · ${x.correct}/${x.asked}<div class="bar"><i style="width:${Math.round((100 * x.correct) / x.asked)}%"></i></div></div>`)
        .join('')}</div>
      ${studyPlanHTML(segment)}
      <div class="muted tiny">Practice questions are deliberately harder than the real exam.</div>
    </div>`;
  $('#log').appendChild(card);
  if (answered) renderReview(segment, from);

  if (answered) {
    ipc.addHistory({
      kind: 'practice',
      title: part > 1 ? `${chat.title} (part ${part})` : chat.title,
      correct,
      answered,
      skipped: res.filter((r) => r.status === 'skipped').length,
      by_domain: byDomain,
      missed_task_statements: missed,
      focus_next: missed.length ? `Retry ${missed.join(', ')}` : '',
      model: 'Offline bank',
      cost: 0,
      date: new Date().toISOString(),
    });
    addNotice('✓ Result saved to Progress');
  }
  // Keep going in the same session while the bank still has unused questions for this focus.
  const remaining = b.pool.filter((it) => !b.used.has(it.id)).length;
  const step = Math.min(remaining, b.mock ? 20 : Number(b.opts.length) || 10);
  const missedItems = segment.filter(({ rec }) => !rec.isCorrect).map(({ item }) => item);
  const actions = [];
  if (step) actions.push(['more', `➕ Keep going (${step} more)`, true]);
  if (missedItems.length) actions.push(['retry', `🔁 Retry the ${missedItems.length} I missed`, !step]);
  if (!step && hasLive()) actions.push(['gen', '＋ Generate more questions']);
  actions.push(['new', 'New session'], ['home', '🏠 Back to Train', !step && !missedItems.length]);
  if (!step) addNotice('You have used every question for this focus.');
  actionRow(actions, (act, _btn, row) => {
    closeRow(row);
    if (act === 'more') {
      b.savedFrom = b.results.length;
      b.part = part + 1;
      b.n += step;
      b.finished = false;
      updateSessionBar();
      addNotice(`Continuing: ${step} more question${step > 1 ? 's' : ''} (${remaining} unused left for this focus)`);
      nextBankQuestion();
    } else if (act === 'retry') {
      startBankSession({ ...b.opts, length: String(missedItems.length), focus: 'retry', items: missedItems, title: 'Retry missed' });
    } else if (act === 'gen') {
      openGenerator(b.focus, b.opts);
    } else if (act === 'new') {
      startBankSession(b.opts);
    } else {
      endChat();
    }
  });
}

// Keyboard: A–D or 1–4 pick, Enter submits or goes next, S skips, E explains. Offline sessions only.
document.addEventListener('keydown', (e) => {
  if (!chat.offline || !chat.bank || !$('#screen-chat').classList.contains('active')) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const card = $('#log .qcard:not(.done)');
  if (card) {
    const l = LETTERS.includes(k) ? k : LETTERS['1234'.indexOf(k)];
    const target = l ? card.querySelector(`[data-letter="${l}"]`) : k === 'Enter' ? card.querySelector('[data-act="submit"]') : k === 'S' ? card.querySelector('[data-act="skip"]') : null;
    if (target) {
      e.preventDefault();
      if (!target.disabled) target.click();
    }
    return;
  }
  const rows = $$('#log .q-next:not(.done)');
  const row = rows[rows.length - 1];
  if (!row) return;
  const act = k === 'Enter' || k === 'N' || k === 'ArrowRight' ? row.querySelector('[data-act="next"], [data-act="more"]') : k === 'E' ? row.querySelector('[data-act="explain"]') : null;
  if (act) {
    e.preventDefault();
    act.click();
  }
});
