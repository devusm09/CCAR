// Validates data/study/*.json against data/learn.json: every lesson has exactly one study entry
// with the required fields: 3 scenario labs (4 options, one best answer), a diagram, a 4-question
// quiz, misconceptions and a scenario story.
// Run: node scripts/check-study.js            (all files)
//      node scripts/check-study.js d1.json    (one file only)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'data');
const ids = JSON.parse(fs.readFileSync(path.join(root, 'learn.json'), 'utf8')).lessons.map((l) => l.id);
const SCENARIOS = ['Customer Support Resolution Agent', 'Code Generation with Claude Code', 'Multi-Agent Research System', 'Developer Productivity with Claude', 'Claude Code for Continuous Integration', 'Structured Data Extraction'];
const seen = {};
const errors = [];
const err = (id, m) => errors.push(`${id}: ${m}`);

const only = process.argv[2];
for (const f of fs.readdirSync(path.join(root, 'study')).filter((f) => f.endsWith('.json') && (!only || f === only))) {
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(path.join(root, 'study', f), 'utf8'));
  } catch (e) {
    errors.push(`${f}: invalid JSON (${e.message})`);
    continue;
  }
  for (const s of arr) {
    const id = s.id || `${f}?`;
    seen[id] = (seen[id] || 0) + 1;
    if (!ids.includes(id)) err(id, 'not a lesson id');
    for (const k of ['plain', 'analogy']) if (typeof s[k] !== 'string' || !s[k].trim()) err(id, `missing ${k}`);
    const sec = s.sections || [];
    if (sec.length < 3 || sec.some((x) => !x.h || !x.body)) err(id, 'needs 3+ sections with h and body');
    if (!s.example || !s.example.code) err(id, 'missing example.code');
    // Scenario lab: 3 exam-style scenarios, each with 4 options and exactly one best answer.
    const labs = s.labs || [];
    if (labs.length !== 3) err(id, 'needs exactly 3 labs');
    labs.forEach((lab, li) => {
      const at = `lab ${li + 1}`;
      if (!SCENARIOS.includes(lab.scenario)) err(id, `${at}: scenario "${lab.scenario}" is not one of the 6 official scenarios`);
      for (const k of ['title', 'context', 'question', 'takeaway']) if (!lab[k]) err(id, `${at}: missing ${k}`);
      const opts = lab.options || [];
      if (opts.length !== 4) err(id, `${at}: needs 4 options`);
      const good = opts.map((o, i) => (o.result === 'good' ? i : -1)).filter((i) => i >= 0);
      if (good.length !== 1 || good[0] !== lab.answer) err(id, `${at}: needs exactly one good option, at index "answer"`);
      for (const o of opts) {
        if (!['good', 'bad'].includes(o.result)) err(id, `${at}: bad result "${o.result}"`);
        if (!o.text || !(o.trace || []).length || !o.verdict || !o.why) err(id, `${at}: option "${(o.text || '').slice(0, 30)}" incomplete`);
        if (o.code && o.lang === 'python' && !(o.variants && o.variants.csharp && o.variants.typescript)) err(id, `${at}: python code needs csharp + typescript variants`);
        for (const t of o.trace || []) if (!t.who || !t.text) err(id, `${at}: empty trace step`);
      }
    });
    if (!(s.checks || []).length) err(id, 'missing checks');
    const d = s.diagram;
    if (!d) err(id, 'missing diagram');
    else if (d.type === 'flow') {
      if (!(d.steps || []).length || d.steps.some((x) => !x.label)) err(id, 'flow diagram needs labelled steps');
      if (d.loop && !(d.steps[d.loop.from] && d.steps[d.loop.to])) err(id, 'flow loop points outside steps');
    } else if (d.type === 'hub') {
      if (!d.center || !d.center.label || !(d.spokes || []).length) err(id, 'hub diagram needs center and spokes');
    } else if (d.type === 'compare') {
      if (!d.left || !d.right || !(d.left.items || []).length || !(d.right.items || []).length) err(id, 'compare diagram needs left and right items');
    } else err(id, `unknown diagram type "${d.type}"`);
    const qz = s.quiz || [];
    if (qz.length !== 4) err(id, 'quiz needs 4 questions');
    for (const q of qz) {
      if (!q.q || !q.why || (q.options || []).length !== 4 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(id, `quiz question incomplete: "${(q.q || '').slice(0, 40)}"`);
    }
    if ((s.misconceptions || []).length < 2 || s.misconceptions.some((m) => !m.myth || !m.fact)) err(id, 'needs 2+ misconceptions with myth and fact');
    if (!s.scenario || !s.scenario.title || !s.scenario.story) err(id, 'missing scenario title/story');
  }
}
if (!only) for (const id of ids) if (seen[id] !== 1) err(id, seen[id] ? `appears ${seen[id]} times` : 'missing');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${ids.length} lessons have study material.`);
