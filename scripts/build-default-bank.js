// Builds data/default-bank.json (the built-in bank shipped with the app) from a bank file:
// by default this computer's generated bank, or any export passed as an argument.
//   node scripts/build-default-bank.js [path/to/export.json]
const fs = require('fs');
const os = require('os');
const path = require('path');

const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
const source = process.argv[2] || path.join(appData, 'Claude Cert Coach', 'question-bank.json');
const target = path.join(__dirname, '..', 'data', 'default-bank.json');

const read = (f) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(raw) ? raw : raw.questions || [];
};
const LETTERS = ['A', 'B', 'C', 'D'];
const valid = (q) =>
  q && q.id && /^[1-5]\.[0-9]$/.test(q.task_statement) && ['Exam-level', 'Expert', 'Diabolical'].includes(q.difficulty) &&
  ['single', 'select_two'].includes(q.format) && String(q.question || '').trim() && LETTERS.every((l) => String((q.options || {})[l] || '').trim()) &&
  Array.isArray(q.correct) && q.correct.length === (q.format === 'select_two' ? 2 : 1) && String(q.why || '').trim();

const existing = fs.existsSync(target) ? read(target) : [];
const incoming = read(source);
const seen = new Set();
const out = [];
let dropped = 0;
for (const q of [...existing, ...incoming]) {
  const key = String(q.question || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!valid(q) || seen.has(q.id) || seen.has(key)) {
    dropped++;
    continue;
  }
  seen.add(q.id);
  seen.add(key);
  const { builtIn, batchId, ...clean } = q;
  out.push(clean);
}
out.sort((a, b) => a.task_statement.localeCompare(b.task_statement, undefined, { numeric: true }));
fs.writeFileSync(target, JSON.stringify({ format: 'claude-cert-coach-bank', version: 1, exportedAt: new Date().toISOString(), count: out.length, questions: out }, null, 2) + '\n');

const tally = (f) => out.reduce((m, q) => ((m[f(q)] = (m[f(q)] || 0) + 1), m), {});
console.log(`default bank: ${out.length} questions (${existing.length} already built in, ${incoming.length} read from ${source}, ${dropped} duplicates/invalid skipped)`);
console.log('by domain', JSON.stringify(tally((q) => 'D' + q.task_statement[0])), '| difficulty', JSON.stringify(tally((q) => q.difficulty)));
console.log('answer letters', JSON.stringify(tally((q) => q.correct.join('+'))), '| task statements covered', new Set(out.map((q) => q.task_statement)).size, 'of 30');
