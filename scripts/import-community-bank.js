// Imports the 360 mock-exam questions from the MIT-licensed community repo
// github.com/utkarsh1agarwal/claude-architect-exam-guide into data/community-bank.json (bank format).
//   git clone --depth 1 https://github.com/utkarsh1agarwal/claude-architect-exam-guide <dir>
//   node scripts/import-community-bank.js <dir>
// - scenario comes from the "## Scenario N: Name" heading, domain from the answer key's (Dn) tag;
//   the task statement is inferred from keywords within that domain.
// - Exams 1-3 are tagged Exam-level, the "hard mode" exams 4-6 Expert.
// - The source key puts most answers on B, so options are reordered to spread the correct letter
//   evenly; letter references in the rationale such as "(D)" are re-lettered to match.
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/import-community-bank.js <path to cloned repo>');
const dir = path.join(src, 'mock-exam');
const L = ['A', 'B', 'C', 'D'];
const SCENARIOS = ['Customer Support Resolution Agent', 'Code Generation with Claude Code', 'Multi-Agent Research System', 'Developer Productivity with Claude', 'Claude Code for Continuous Integration', 'Structured Data Extraction'];

// Keywords per task statement (lower case, matched as substrings of stem + options + rationale).
const KEYS = {
  '1.1': ['stop_reason', 'end_turn', 'agentic loop', 'iteration', 'loop terminat', 'loop exit', 'tool_use"'],
  '1.2': ['coordinator', 'hub-and-spoke', 'hub and spoke', 'synthesis subagent', 'coverage', 'route through', 'aggregat'],
  '1.3': ['task tool', 'spawn', 'allowedtools', 'allowed_tools', 'context passing', 'pass the', 'in parallel', 'subagent prompt', 'agentdefinition'],
  '1.4': ['prerequisite', 'programmatic', 'enforce', 'gate', 'handoff', 'hand off', 'before process_refund', 'ordering', 'structured handoff'],
  '1.5': ['hook', 'pretooluse', 'posttooluse', 'intercept', 'normaliz'],
  '1.6': ['decompos', 'prompt chain', 'fixed sequence', 'pipeline of', 'dynamic', 'per-file', 'subtask', 'adaptive'],
  '1.7': ['session', 'resume', 'fork', 'stale', '--continue'],
  '2.1': ['description', 'tool selection', 'confus', 'misrout', 'wrong tool', 'rename', 'split the tool', 'overlapping'],
  '2.2': ['iserror', 'errorcategory', 'isretryable', 'error response', 'empty result', 'timeout', 'transient', 'business rule', 'validation error'],
  '2.3': ['tool_choice', 'too many tools', 'tools available', 'scoped', 'restrict', 'tool distribution', '"any"', 'forced'],
  '2.4': ['mcp server', '.mcp.json', 'mcpservers', 'community server', 'mcp resource', 'environment variable', '${', 'user scope', 'project scope'],
  '2.5': ['grep', 'glob', 'built-in tool', 'edit tool', 'read tool', 'bash tool', 'write tool'],
  '3.1': ['claude.md', '@import', 'user-level', 'project-level', '/memory', 'directory-level', 'claude.local.md'],
  '3.2': ['slash command', 'skill', 'skill.md', '.claude/commands', 'context: fork', 'allowed-tools', 'argument-hint'],
  '3.3': ['.claude/rules', 'paths:', 'glob pattern', 'path-specific', 'file pattern', '**/*'],
  '3.4': ['plan mode', 'direct execution', 'explore subagent', 'architectural', 'multi-file change'],
  '3.5': ['iterat', 'test-driven', 'interview', 'input/output example', 'refine', 'tests first', 'concrete example'],
  '3.6': [' -p', '--output-format', 'github action', 'ci ', 'ci/cd', 'pipeline', 'headless', 'pull request', 'pr '],
  '4.1': ['explicit criteria', 'false positive', 'precision', 'severity', 'vague', 'be conservative', 'categor'],
  '4.2': ['few-shot', 'few shot', 'examples', 'example'],
  '4.3': ['json schema', 'schema', 'tool_use', 'structured output', 'nullable', 'enum', 'required field'],
  '4.4': ['validation', 'retry', 'feedback', 'detected_pattern', 'self-correct', 'semantic error', 'resubmit'],
  '4.5': ['batch', 'custom_id', '24 hour', '24-hour', 'overnight', '50%', 'latency'],
  '4.6': ['independent', 'multi-pass', 'second instance', 'self-review', 'reviewer', 'cross-file', 'same session'],
  '5.1': ['summar', 'lost in the middle', 'case facts', 'long conversation', 'trim', 'context window', 'verbose', 'token'],
  '5.2': ['escalat', 'ambiguous', 'human', 'multiple match', 'policy', 'frustrat', 'manager'],
  '5.3': ['propagat', 'partial result', 'coverage gap', 'subagent fail', 'silently', 'suppress', 'access failure'],
  '5.4': ['codebase', 'scratchpad', '/compact', 'degrad', 'large repo', 'exploration', 'context fill'],
  '5.5': ['human review', 'confidence', 'calibrat', 'sampl', 'accuracy', 'stratif', 'per-field'],
  '5.6': ['provenance', 'citation', 'source', 'conflicting', 'publication date', 'attribution', 'claim'],
};

// Hand-checked task statements for questions the keywords place badly (reviewed 2026-10-26).
const OVERRIDES = {
  'community-e1-q15': '3.5', 'community-e1-q16': '3.5', 'community-e2-q44': '3.5', 'community-e3-q1': '3.5', 'community-e6-q16': '3.5',
  'community-e2-q28': '5.4', 'community-e5-q28': '5.4', 'community-e5-q13': '5.4',
  'community-e2-q33': '2.5',
  'community-e4-q9': '5.2',
  'community-e4-q13': '1.5', 'community-e5-q15': '1.5', 'community-e6-q11': '1.5', 'community-e6-q18': '1.5',
  'community-e5-q18': '1.7',
  'community-e5-q44': '3.3',
  'community-e5-q46': '3.6',
  'community-e6-q5': '4.3',
  'community-e6-q52': '4.4',
  'community-e6-q53': '5.1',
};

function classify(domains, text) {
  const t = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [task, words] of Object.entries(KEYS)) {
    if (!domains.includes(task[0])) continue;
    const score = words.reduce((n, w) => n + (t.includes(w) ? (w.length > 6 ? 2 : 1) : 0), 0);
    if (score > bestScore) (best = task), (bestScore = score);
  }
  return best;
}

// Questions: "## Scenario N: Name" headings, then "**Q1.**" or "**1.**" stems followed by "- A) ..." options.
function parseQuestions(md) {
  const out = {};
  let scenario = '';
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+Scenario\s+\d+:\s*(.+?)\s*(\(.*\))?\s*$/);
    if (h) {
      scenario = SCENARIOS.find((s) => h[1].startsWith(s)) || h[1].trim();
      cur = null;
      continue;
    }
    if (/^##\s/.test(line)) {
      cur = null;
      continue;
    }
    const q = line.match(/^\*\*Q?(\d+)\.\s*(\(Select TWO\))?\*\*\s*(.*)$/i);
    if (q) {
      cur = out[q[1]] = { n: Number(q[1]), scenario, stem: q[3] + (q[2] ? ' (Select TWO.)' : ''), options: {} };
      continue;
    }
    if (!cur) continue;
    const o = line.match(/^\s*[-*]\s*([A-D])[).]\s*(.*)$/);
    if (o) cur.options[o[1]] = o[2].trim();
    else if (line.trim() && !Object.keys(cur.options).length) cur.stem += '\n' + line.trim();
  }
  return out;
}

// Answers: "**Q1. Answer: B** *(D1)* — rationale" or "**1. Answer: A, C** *(D2, D5)* — rationale" (the first domain
// is the fallback; the task statement may come from any tagged domain).
function parseAnswers(md) {
  const out = {};
  for (const line of md.split(/\r?\n/)) {
    const a = line.match(/^\*\*Q?(\d+)\.\s*Answer:\s*([A-D](?:\s*(?:,|and)\s*[A-D])*)\*\*\s*\*\(D([1-5])((?:\s*[,/]\s*D[1-5])*)\)\*\s*[—–-]\s*(.*)$/);
    if (a) out[a[1]] = { correct: a[2].match(/[A-D]/g), domain: a[3], domains: [a[3], ...(a[4].match(/[1-5]/g) || [])], why: a[5].trim() };
  }
  return out;
}

const questions = [];
const report = { parsed: 0, skipped: [], fallback: 0, notShuffled: 0 };
let slot = 0;
for (let e = 1; e <= 6; e++) {
  const qs = parseQuestions(fs.readFileSync(path.join(dir, `exam-${e}-questions.md`), 'utf8'));
  const as = parseAnswers(fs.readFileSync(path.join(dir, `exam-${e}-answers.md`), 'utf8'));
  for (const [n, q] of Object.entries(qs)) {
    const a = as[n];
    const id = `community-e${e}-q${n}`;
    if (!a || !L.every((l) => q.options[l]) || !SCENARIOS.includes(q.scenario)) {
      report.skipped.push(`${id}: ${!a ? 'no answer' : !SCENARIOS.includes(q.scenario) ? `scenario "${q.scenario}"` : 'missing option'}`);
      continue;
    }
    const two = a.correct.length === 2;
    const text = `${q.stem} ${Object.values(q.options).join(' ')} ${a.why}`;
    let task = OVERRIDES[id] || classify(a.domains, text);
    if (!task) (task = Object.keys(KEYS).find((t) => t[0] === a.domain)), report.fallback++, (report.fallbackIds = report.fallbackIds || []).push(id);

    // Reorder options so the correct letter cycles A, B, C, D (Select-TWO: the pair cycles too).
    // Skip when an option refers to other options by letter, which a reorder would break.
    let order = L.slice(); // order[newIndex] = old letter
    const crossRef = Object.values(q.options).some((o) => /\b(?:[A-D] and [A-D]|options? [A-D])\b/.test(o));
    if (!crossRef) {
      const wrong = L.filter((l) => !a.correct.includes(l));
      const targets = two ? [[0, 2], [1, 3], [0, 3], [1, 2]][slot % 4] : [slot % 4];
      slot++;
      order = new Array(4);
      a.correct.forEach((l, i) => (order[targets[i]] = l));
      for (let i = 0, w = 0; i < 4; i++) if (!order[i]) order[i] = wrong[w++];
    } else report.notShuffled++;
    const map = Object.fromEntries(order.map((old, i) => [old, L[i]])); // old letter -> new letter
    const relabel = (s) => s.replace(/\(([A-D])\)/g, (m, x) => `(${map[x]})`).replace(/\b([Oo]ption) ([A-D])\b/g, (m, w, x) => `${w} ${map[x]}`);
    const stem = q.stem.replace(/\s+/g, ' ').trim();
    questions.push({
      id,
      model: 'community',
      createdAt: '2026-10-26T00:00:00.000Z',
      scenario: q.scenario,
      task_statement: task,
      difficulty: e <= 3 ? 'Exam-level' : 'Expert',
      format: two ? 'select_two' : 'single',
      question: two && !/select two/i.test(stem) ? `${stem} (Select TWO.)` : stem,
      options: Object.fromEntries(order.map((old, i) => [L[i], q.options[old]])),
      correct: a.correct.map((l) => map[l]).sort(),
      why: relabel(a.why),
      explanation: `${relabel(a.why)}\n\nSource: community mock exam ${e}, question ${n}, from github.com/utkarsh1agarwal/claude-architect-exam-guide (MIT licence). Option order changed.`,
      concept: '',
    });
    report.parsed++;
  }
}

const target = path.join(__dirname, '..', 'data', 'community-bank.json');
fs.writeFileSync(target, JSON.stringify({ format: 'claude-cert-coach-bank', version: 1, source: 'https://github.com/utkarsh1agarwal/claude-architect-exam-guide (MIT)', count: questions.length, questions }, null, 1) + '\n');
const dist = { A: 0, B: 0, C: 0, D: 0 };
for (const q of questions) for (const c of q.correct) dist[c]++;
const perTask = {};
for (const q of questions) perTask[q.task_statement] = (perTask[q.task_statement] || 0) + 1;
console.log(`Imported ${report.parsed} questions to data/community-bank.json`);
console.log('Correct letters:', dist, '| not reordered:', report.notShuffled, '| task by domain fallback:', report.fallback);
console.log('Per task statement:', perTask);
if (report.skipped.length) console.log('Skipped:', report.skipped);
