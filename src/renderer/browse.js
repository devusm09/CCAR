/* Claude Cert Coach — question bank browser: search and filter every bank question, preview it with
 * the answer hidden until revealed, and practise any filtered set. Offline; uses bank.js globals. */
'use strict';

const browse = { q: '', domain: '', diff: '', status: '', open: null, revealed: new Set(), limit: 40 };

function browseStatus(it, stats, due) {
  const s = stats[it.id];
  if (due.has(it.id)) return 'due';
  if (!s) return 'unseen';
  return s.lastCorrect ? 'correct' : 'missed';
}
const STATUS_LABEL = { unseen: 'Unseen', missed: 'Missed last time', correct: 'Correct last time', due: 'Due for review' };

function browseFiltered() {
  const stats = bankStats();
  const due = new Set(srsSummary().due.map((it) => it.id));
  const q = browse.q.trim().toLowerCase();
  return bank.items
    .map((it) => ({ it, status: browseStatus(it, stats, due) }))
    .filter(({ it, status }) => {
      if (browse.domain && it.task_statement[0] !== browse.domain) return false;
      if (browse.diff && it.difficulty !== browse.diff) return false;
      if (browse.status && status !== browse.status) return false;
      if (!q) return true;
      return `${it.task_statement} ${it.scenario} ${it.question} ${Object.values(it.options).join(' ')} ${it.concept}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.it.task_statement.localeCompare(b.it.task_statement, undefined, { numeric: true }));
}

async function renderBrowse() {
  if (!bank.items.length) await refreshBank();
  qCache = await ipc.listQuestions();
  const sel = (id, opts, val) =>
    `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  $('#browseHead').innerHTML = `<div class="crumbs">Question bank</div>
    <h1>Browse the question bank</h1>
    <div class="browse-filters">
      <input id="bSearch" placeholder="Search questions, options, scenarios or concepts…" value="${esc(browse.q)}" autocomplete="off" />
      ${sel('bDomain', [['', 'All domains'], ...[1, 2, 3, 4, 5].map((d) => [String(d), `D${d} ${DOMAIN_NAMES[d]}`])], browse.domain)}
      ${sel('bDiff', [['', 'Any difficulty'], ['Exam-level', 'Exam-level'], ['Expert', 'Expert'], ['Diabolical', 'Diabolical']], browse.diff)}
      ${sel('bStatus', [['', 'Any result'], ['unseen', 'Unseen'], ['missed', 'Missed last time'], ['correct', 'Correct last time'], ['due', 'Due for review']], browse.status)}
    </div>`;
  renderBrowseList();
}

function renderBrowseList() {
  const rows = browseFiltered();
  const shown = rows.slice(0, browse.limit);
  const list = shown
    .map(({ it, status }) => {
      const open = browse.open === it.id;
      const revealed = browse.revealed.has(it.id);
      const stem = it.question; // closed rows are cut to one line by CSS, so wide windows show more
      return `<div class="b-item${open ? ' open' : ''}" data-id="${esc(it.id)}">
        <button class="b-row" data-toggle="${esc(it.id)}">
          <span class="chip">${esc(it.task_statement)}</span>
          <span class="b-stem">${inline(stem)}</span>
          <span class="chip ${diffClass(it.difficulty)}">${esc(it.difficulty)}</span>
          <span class="b-status s-${status}">${STATUS_LABEL[status]}</span>
        </button>
        ${
          open
            ? `<div class="b-body">
            <div class="q-meta"><span>${esc(it.scenario)}</span><span>D${it.task_statement[0]} ${esc(DOMAIN_FULL[it.task_statement[0]])}</span><span>${esc(it.task_statement)} ${esc(TASK_NAMES[it.task_statement] || '')}</span>${it.format === 'select_two' ? '<span>Select TWO</span>' : ''}</div>
            ${optionsHTML(it)}
            ${revealed ? `${it.why ? `<div class="v-why">${inline(it.why)}</div>` : ''}${it.explanation ? `<div class="q-explain md">${md(it.explanation)}</div>` : ''}` : ''}
            <div class="row wrap">
              <button class="secondary" data-reveal="${esc(it.id)}">${revealed ? 'Hide answer' : 'Reveal answer'}</button>
              <button class="ghost" data-practise-one="${esc(it.id)}">Practise this question</button>
              <button class="ghost" data-study="${esc(it.task_statement)}">📖 Lesson ${esc(it.task_statement)}</button>
            </div>
          </div>`
            : ''
        }
      </div>`;
    })
    .join('');
  $('#browseList').innerHTML = `<div class="b-bar"><span class="muted">${rows.length} question${rows.length === 1 ? '' : 's'}${rows.length > shown.length ? ` · showing ${shown.length}` : ''}</span>
      <button class="primary" data-practise-all ${rows.length ? '' : 'disabled'}>Practise ${Math.min(rows.length, 20)} of these →</button></div>
    ${list || '<div class="empty">No questions match these filters.</div>'}
    ${rows.length > shown.length ? '<button class="secondary b-more" data-more>Show more</button>' : ''}`;
  // Answer stays hidden until revealed; disabled options can't be "answered" here.
  $$('#browseList .b-body').forEach((body) => {
    const id = body.closest('.b-item').dataset.id;
    const it = bank.items.find((x) => x.id === id);
    body.querySelectorAll('.q-opt').forEach((b) => (b.disabled = true));
    if (browse.revealed.has(id)) revealOptions(body, it, null);
  });
}

$('#screen-browse').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.toggle) {
    browse.open = browse.open === b.dataset.toggle ? null : b.dataset.toggle;
    return renderBrowseList();
  }
  if (b.dataset.reveal) {
    const id = b.dataset.reveal;
    browse.revealed.has(id) ? browse.revealed.delete(id) : browse.revealed.add(id);
    return renderBrowseList();
  }
  if (b.dataset.study) return openLesson(b.dataset.study);
  if (b.dataset.more !== undefined) {
    browse.limit += 40;
    return renderBrowseList();
  }
  if (b.dataset.practiseOne) {
    const it = bank.items.find((x) => x.id === b.dataset.practiseOne);
    return startBankSession({ length: '1', focus: 'retry', items: [it], level: 'adaptive', title: `Question ${it.task_statement}` });
  }
  if (b.dataset.practiseAll !== undefined) {
    const items = browseFiltered().map((r) => r.it);
    if (!items.length) return;
    return startBankSession({ length: String(Math.min(20, items.length)), focus: 'browse', items, level: 'adaptive', title: 'From the bank browser' });
  }
});
$('#screen-browse').addEventListener('input', (e) => {
  const map = { bSearch: 'q', bDomain: 'domain', bDiff: 'diff', bStatus: 'status' };
  if (!map[e.target.id]) return;
  browse[map[e.target.id]] = e.target.value;
  browse.limit = 40;
  renderBrowseList();
});
