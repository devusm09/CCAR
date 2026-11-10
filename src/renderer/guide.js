/* Claude Cert Coach — study guidance from mistakes. After a wrong answer it points at the lesson for that
 * task statement, its decision rule and the trap the chosen option most resembles; on a results screen it
 * ranks the lessons to study by how many questions were missed. Offline; uses globals from app.js,
 * bank.js and learn.js. Loaded after learn.js. */
'use strict';

const STOP = new Set(
  'that this with from into than then them they their there these those what when which while where would could should about after before because every only also more most some such each other over under just still even very will have been being does done using used uses make makes made into your rather instead without within'.split(' ')
);
const words = (s) =>
  new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[`*_"'()[\],.:;!?]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map(stem)
  );
// Light stemming so "explain", "explains" and "explaining" count as the same word.
function stem(w) {
  return w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w;
}

// Which of the lesson's common traps the chosen (wrong) option most resembles, or -1.
function matchTrap(lesson, chosenText) {
  if (!lesson || !chosenText) return -1;
  const a = words(chosenText);
  let best = -1;
  let bestScore = 0;
  (lesson.traps || []).forEach((t, i) => {
    const b = words(t.wrong);
    if (!b.size) return;
    let hit = 0;
    for (const w of b) if (a.has(w)) hit++;
    // Needs several shared content words and most of the trap's wording, so a loose overlap never counts.
    const score = hit >= 3 ? hit / Math.min(a.size || 1, b.size) : 0;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return bestScore >= 0.5 ? best : -1;
}

const chosenText = (item, rec) => (item && rec && rec.selected ? rec.selected.map((l) => item.options[l]).filter(Boolean).join(' ') : '');
const itemFor = (rec) => (rec && rec.bankId ? bank.items.find((it) => it.id === rec.bankId) : null);

function lessonStatus(id) {
  const s = taskStats()[id];
  const read = readLessons().has(id);
  return [s ? `you're at ${s.pct}% on ${id}` : '', read ? 'lesson read' : 'lesson not read yet'].filter(Boolean).join(' · ');
}

// The box under a wrong answer: which lesson, which rule, which trap.
function studyGuideHTML(task, item, rec) {
  const l = lessonById(task);
  const title = l ? l.title : TASK_NAMES[task] || '';
  const trap = l ? matchTrap(l, chosenText(item, rec)) : -1;
  const t = trap >= 0 ? l.traps[trap] : null;
  return `<div class="guide">
    <div class="g-head"><span class="g-ico">📖</span><div><div class="eyebrow">Study this</div><b>Lesson ${esc(task)} · ${esc(title)}</b><div class="tiny muted">${esc(lessonStatus(task))}</div></div></div>
    ${t ? `<div class="g-trap"><span class="g-lbl">Your answer looks like this common trap</span>${inline(t.wrong)}<div class="g-why">${inline(t.why)}</div></div>` : ''}
    ${l && l.rule ? `<div class="g-rule"><span class="g-lbl">Remember</span>${inline(l.rule)}</div>` : ''}
    <div class="row wrap"><button class="secondary small-btn" data-guide="lesson" data-task="${esc(task)}" data-trap="${trap}" title="Your session stays open: come back with Session in the left rail">Open lesson ${esc(task)} →</button></div>
  </div>`;
}

function addStudyGuide(rec) {
  if (!rec || rec.isCorrect || !rec.task_statement || !learn.lessons.length) return;
  const el = document.createElement('div');
  el.innerHTML = studyGuideHTML(rec.task_statement, itemFor(rec), rec);
  $('#log').appendChild(el.firstElementChild);
}

// Results: the lessons to study, most-missed first (ties go to the heavier exam domain).
function studyPlanHTML(results) {
  const per = {};
  for (const { rec, item } of results) {
    const t = (item && item.task_statement) || rec.task_statement;
    const p = (per[t] = per[t] || { t, asked: 0, missed: 0, traps: new Set() });
    p.asked++;
    if (!rec.isCorrect) {
      p.missed++;
      const tr = matchTrap(lessonById(t), chosenText(item, rec));
      if (tr >= 0) p.traps.add(tr);
    }
  }
  const rows = Object.values(per)
    .filter((p) => p.missed)
    .sort((a, b) => b.missed - a.missed || DOMAIN_WEIGHT[b.t[0]] - DOMAIN_WEIGHT[a.t[0]] || a.t.localeCompare(b.t, undefined, { numeric: true }));
  if (!rows.length) return '<div class="plan-ok">✓ Nothing missed: no lessons to revisit from this set.</div>';
  const row = (p, i) => {
    const l = lessonById(p.t);
    const n = bankFor(p.t).length;
    const firstTrap = p.traps.size ? [...p.traps][0] : -1;
    return `<div class="plan-row${i === 0 ? ' top' : ''}">
      <span class="plan-rank">${i + 1}</span>
      <div class="plan-txt">
        <b>${esc(p.t)} · ${esc(l ? l.title : TASK_NAMES[p.t] || '')}</b>
        <div class="small"><span class="plan-miss">missed ${p.missed} of ${p.asked}</span>${p.traps.size ? ` · fell for ${p.traps.size} common trap${p.traps.size > 1 ? 's' : ''}` : ''} <span class="muted">· ${esc(lessonStatus(p.t))}</span></div>
        ${l && l.rule ? `<div class="small muted plan-rule">${inline(l.rule)}</div>` : ''}
      </div>
      <div class="plan-act">
        <button class="${i === 0 ? 'primary' : 'secondary'} small-btn" data-guide="lesson" data-task="${esc(p.t)}" data-trap="${firstTrap}">📖 Study</button>
        <button class="ghost small-btn" data-guide="practise" data-task="${esc(p.t)}" ${n ? '' : 'disabled'}>Practise ${n}</button>
      </div>
    </div>`;
  };
  const head = rows.slice(0, 5).map(row).join('');
  const rest = rows.slice(5);
  return `<div class="study-plan">
    <div class="plan-h"><b>Your study plan</b><span class="small muted">Most-missed lessons first. Read the lesson, then practise it.</span></div>
    ${head}
    ${rest.length ? `<details class="plan-more"><summary>${rest.length} more lesson${rest.length > 1 ? 's' : ''} to revisit</summary>${rest.map((p, i) => row(p, i + 5)).join('')}</details>` : ''}
  </div>`;
}

// Opens a lesson focused on the mistake: banner, highlighted trap, scroll to it.
function openLessonFor(task, trap) {
  learn.focus = { task, trap: Number(trap), from: chat.bank && !chat.bank.finished ? 'session' : '' };
  openLesson(task);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-guide]');
  if (!b || b.disabled) return;
  if (b.dataset.guide === 'lesson') return openLessonFor(b.dataset.task, b.dataset.trap);
  if (b.dataset.guide === 'practise') return practiseTask(b.dataset.task);
  if (b.dataset.guide === 'back') return show('chat');
});

// Lessons are needed for rules and traps as soon as the first answer comes in.
loadLearn();
