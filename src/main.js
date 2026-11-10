// Claude Cert Coach — Electron main process.
// Holds the API key, talks to the Claude API, and stores settings/history locally.
// The renderer never sees the API key; it only calls the IPC handlers below.

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const PROMPT_FILES = {
  practice: 'cca-f-practice-agent-prompt.md',
  fit: 'cert-fit-evaluator-prompt.md',
};

// ---------- Local storage (userData folder) ----------
const dataPath = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataPath(name), JSON.stringify(value, null, 2), 'utf8');
}

// Settings: { apiKeyEnc, apiKeyPlain?, model, thinking, maxTokens }
function loadSettings() {
  return readJson('settings.json', {});
}

function getApiKey() {
  const s = loadSettings();
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
    } catch {
      return null;
    }
  }
  return s.apiKeyPlain || null;
}

function saveSettings(patch) {
  const s = loadSettings();
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    const key = patch.apiKey.trim();
    if (safeStorage.isEncryptionAvailable()) {
      s.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
      delete s.apiKeyPlain;
    } else {
      // Fallback for systems without an OS keychain.
      s.apiKeyPlain = key;
      delete s.apiKeyEnc;
    }
  }
  for (const k of ['model', 'thinking', 'maxTokens', 'priceIn', 'priceOut', 'theme']) {
    if (patch[k] !== undefined) s[k] = patch[k];
  }
  writeJson('settings.json', s);
  if (patch.theme) applyTheme(patch.theme);
  return publicSettings();
}

// $ per million tokens: [pattern, input, output, cache read]. Most specific first.
// Editable in Settings — check your Console for current prices.
const PRICE_TABLE = [
  [/fable|mythos/i, 10, 50, 0.25],
  [/opus-5-5/i, 4, 20, 0.2],
  [/opus/i, 5, 25, 0.5],
  [/sonnet-5/i, 2, 10, 0.2],
  [/sonnet/i, 3, 15, 0.3],
  [/haiku-5-5/i, 0.1, 0.5, 0.01],
  [/haiku/i, 1, 5, 0.1],
];
function priceRow(model) {
  return PRICE_TABLE.find(([re]) => re.test(model || '')) || [null, 3, 15, 0.3];
}
function defaultPrices(model) {
  const [, priceIn, priceOut] = priceRow(model);
  return { priceIn, priceOut };
}
// Cache reads as a fraction of the input price (5% on Opus 5.5, 10% on most others).
const cacheReadRatio = (model) => {
  const [, i, , r] = priceRow(model);
  return r / i;
};

function publicSettings() {
  const s = loadSettings();
  const key = getApiKey();
  const d = defaultPrices(s.model || '');
  return {
    hasKey: !!key,
    keyHint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : '',
    model: s.model || '',
    thinking: s.thinking || 'default',
    theme: s.theme || 'light',
    maxTokens: s.maxTokens || 16000,
    priceIn: s.priceIn ?? d.priceIn,
    priceOut: s.priceOut ?? d.priceOut,
  };
}

// Cache writes (5-minute TTL) cost 1.25x input; cache reads cost the model's cache-read rate.
// Cache writes are 1.25x input for the 5-minute TTL and 2x for the 1-hour TTL.
function cacheWriteSplit(u) {
  const total = u.cache_creation_input_tokens || 0;
  const oneHour = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  return { oneHour, fiveMin: Math.max(0, total - oneHour), weighted: 2 * oneHour + 1.25 * Math.max(0, total - oneHour) };
}
function costOf(u, s) {
  if (!u) return 0;
  const inTok =
    (u.input_tokens || 0) + cacheWriteSplit(u).weighted + cacheReadRatio(s.model) * (u.cache_read_input_tokens || 0);
  return (inTok * s.priceIn + (u.output_tokens || 0) * s.priceOut) / 1e6;
}

function client(apiKeyOverride) {
  const apiKey = apiKeyOverride || getApiKey();
  if (!apiKey) throw new Error('No API key saved. Open Settings and add your key.');
  return new Anthropic({ apiKey });
}

// ---------- Tools exposed to the model ----------
// ask_user_input_v0 is the button tool both prompts already rely on.
// save_session_result lets the app keep a score history.
const TOOLS = [
  {
    name: 'ask_user_input_v0',
    eager_input_streaming: true, // stream `message` as it is written, so the question appears live
    description:
      'Show the user a message plus clickable buttons, and wait for their choice. Use for answer selection (A/B/C/D), "What next?" menus, and profile questions. Put everything the user should read this turn in `message`; the app displays it verbatim above the buttons. The turn ends after this call; the tool result contains the user\'s selection(s) or any text they typed instead.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'Markdown shown to the user above the buttons, exactly as written: the full question (header block, stem, options A–D in full), feedback, explanations, summaries, tables — everything the protocol says to write this turn. Leave empty only when there is genuinely nothing to say.',
        },
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Prompt shown above the buttons.' },
              type: {
                type: 'string',
                enum: ['single_select', 'multi_select'],
                description: 'single_select = pick one; multi_select = pick several (e.g. Select TWO).',
              },
              options: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
            required: ['question', 'type', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'log_question',
    description:
      'Silently log the question you are presenting so the app can score answers and avoid repeating questions in future sessions. Call once per question, in the same response as the question and its answer buttons. The user never sees this.',
    input_schema: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'Question number in this session.' },
        task_statement: { type: 'string', description: 'e.g. "1.4". For a fit evaluation: "<exam code> <domain>".' },
        domain: { type: 'string', description: 'e.g. "D1 Agentic Architecture & Orchestration".' },
        scenario: { type: 'string' },
        difficulty: { type: 'string', enum: ['Exam-level', 'Expert', 'Diabolical'] },
        format: { type: 'string', enum: ['single', 'select_two'] },
        concept: {
          type: 'string',
          description: 'One line: the principle tested and the concepts in tension, plus the key scenario detail. Must not reveal the answer letter.',
        },
        correct: { type: 'array', items: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, minItems: 1, maxItems: 2 },
        why: {
          type: 'string',
          description:
            'Shown to the user only after they answer: 1–2 short sentences on the principle that makes the correct answer right and the flaw in the most tempting distractor. Plain text, no letter-by-letter breakdown.',
        },
      },
      required: ['task_statement', 'concept', 'correct', 'why'],
    },
  },
  {
    name: 'save_session_result',
    description:
      'Save the final result of a completed quiz, mock exam, or fit evaluation to the user\'s local history. Call exactly once, in the same turn as the end-of-quiz summary or the fit recommendation. Never call mid-quiz.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['quiz', 'mock_exam', 'fit_evaluation'] },
        title: { type: 'string', description: 'Short label, e.g. "Quiz — 10 Qs, default mix" or "Fit: CCA-F vs CCD-F".' },
        correct: { type: 'integer' },
        answered: { type: 'integer' },
        skipped: { type: 'integer' },
        by_domain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string', description: 'e.g. "D1 Agentic Architecture" or "CCA-F D3"' },
              correct: { type: 'integer' },
              asked: { type: 'integer' },
            },
            required: ['domain', 'correct', 'asked'],
          },
        },
        missed_task_statements: { type: 'array', items: { type: 'string' } },
        focus_next: { type: 'string' },
        recommendation: { type: 'string', description: 'Fit evaluations only: the recommended credential and one-line reason.' },
      },
      required: ['kind', 'title', 'correct', 'answered', 'by_domain'],
    },
  },
];

const APP_ADDENDUM = `

## App integration (added by the desktop app)
- You are running inside a desktop app. \`ask_user_input_v0\` is available: always use it where the protocol says to. The app renders the buttons and returns the user's choice as the tool result. If the user types free text instead of clicking, the tool result says so — treat it as the protocol describes (a typed letter is an answer; "skip", "explain", disputes etc. are requests).
- IMPORTANT — where your words go: in this app, plain text you write next to tool calls is NOT shown to the user. Whenever the protocol says to write something (a question with its header block, stem and all options A–D in full; feedback; an in-depth explanation; a score summary or table; "Recorded (N/total)."), put it in the \`message\` field of that response's \`ask_user_input_v0\` call. The app renders \`message\` verbatim as markdown above the buttons. Never rely on plain text for anything the user must read.
- For each question: call \`log_question\` and then \`ask_user_input_v0\` (with the full question in \`message\`) in that same response. This applies to practice, mock exam, and the fit diagnostic, including the first question right after the profile answers. Never mention the log to the user.
- CCA-F practice (not mock exams, not the fit diagnostic): the app performs Step 4 and the Step 4 "What next?" menu itself. The moment the user answers, it shows right/wrong, the correct letter(s) in green, your \`why\` from \`log_question\` and the score, then shows its own "Next question / Explain in depth" buttons. You then receive the answer and the user's choice together in ONE tool result, for example "Select your answer: B" followed by "What next? ➡️ Next question". Never send the "What next?" buttons yourself and never repeat the right/wrong feedback. Act on the choice in this same response:
  - "➡️ Next question": present the next question now (\`log_question\` + \`ask_user_input_v0\` with the full question in \`message\`).
  - "🔍 Explain in depth": put the explain-in-depth breakdown in \`message\` of an \`ask_user_input_v0\` call whose only option is "➡️ Next question".
  - If the question just answered was the last one of the set: give the end-of-quiz summary (Section 7) and call \`save_session_result\` in this response, instead of a next question. If they chose "Explain in depth", put the breakdown first in the same \`message\`, then the summary.
  - "Then the user typed: …": respond to what they typed.
  - If the tool result contains only the answer (no "What next?" line), reply with the "What next?" \`ask_user_input_v0\` call and 1–2 sentences on why the correct answer is right in \`message\`.
- The end-of-quiz summary (or the Phase 5 recommendation for a fit evaluation) also goes in \`message\` of the final \`ask_user_input_v0\` call; call \`save_session_result\` once in that same response.
- Write in plain markdown. Tables are fine where the protocol asks for them.`;

function systemPrompt(mode) {
  const file = PROMPT_FILES[mode];
  if (!file) throw new Error(`Unknown mode: ${mode}`);
  return fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8') + APP_ADDENDUM;
}

// The "thinking" setting is a quality/cost dial: on = high effort, off = low effort, default = the model's own.
// Thinking stays adaptive: Opus 5.5, Sonnet 5.5 and Fable reject {type: 'disabled'}, so effort is the control.
const supportsEffort = (model) => !/claude-3|haiku-4|sonnet-4-5|opus-4-[01](?![0-9])/i.test(model);
// Thinking stays hidden ('omitted'): a visible summary could reveal the answer before the question.
function thinkingParam(setting) {
  if (setting === 'on') return { type: 'adaptive', display: 'omitted' }; // older Opus runs without thinking unless asked
  return undefined;
}
function effortParam(setting, model) {
  if (!supportsEffort(model)) return undefined;
  if (setting === 'on') return 'high';
  if (setting === 'off') return 'low';
  // Sent explicitly: the API default differs by model (medium on Opus 5.5, high on Sonnet 5.5),
  // and the Settings label promises Medium.
  return 'medium';
}

// ---------- Window ----------
let win;
const TITLEBAR_HEIGHT = 48; // matches .topbar in styles.css
// The app's top bar doubles as the title bar; on Windows/Linux the OS draws
// minimize / maximize / close over its right edge in the top bar's colours.
const titleBarOverlay = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#141414', symbolColor: '#ffffff', height: TITLEBAR_HEIGHT }
    : { color: '#ebebeb', symbolColor: '#242424', height: TITLEBAR_HEIGHT };

// Appearance: light (default), dark or system. themeSource also sets prefers-color-scheme in the page.
function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
}
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    title: 'Claude Cert Coach',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ebebeb',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: titleBarOverlay() }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  const onTheme = () => process.platform !== 'darwin' && !win.isDestroyed() && win.setTitleBarOverlay(titleBarOverlay());
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.removeListener('updated', onTheme));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  applyTheme(loadSettings().theme);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC ----------
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:save', (_e, patch) => saveSettings(patch || {}));
ipcMain.handle('settings:clearKey', () => {
  const s = loadSettings();
  delete s.apiKeyEnc;
  delete s.apiKeyPlain;
  writeJson('settings.json', s);
  return publicSettings();
});

// List models the key can use (newest first, as returned by the API).
ipcMain.handle('models:list', async (_e, apiKeyOverride) => {
  const c = client(apiKeyOverride);
  const out = [];
  for await (const m of c.models.list({ limit: 100 })) {
    out.push({ id: m.id, name: m.display_name || m.id, created: m.created_at });
  }
  return out;
});

// Attach exam guides (PDF / text / markdown) as content blocks.
ipcMain.handle('files:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Attach exam guide(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Exam guides', extensions: ['pdf', 'md', 'txt'] }],
  });
  if (res.canceled) return [];
  const files = res.filePaths.map((p) => {
    const name = path.basename(p);
    const ext = path.extname(p).toLowerCase();
    const size = fs.statSync(p).size;
    if (size > 30 * 1024 * 1024) throw new Error(`${name} is larger than 30 MB.`);
    if (ext === '.pdf') {
      return {
        name,
        block: {
          type: 'document',
          title: name,
          source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(p).toString('base64') },
        },
      };
    }
    return {
      name,
      block: { type: 'document', title: name, source: { type: 'text', media_type: 'text/plain', data: fs.readFileSync(p, 'utf8') } },
    };
  });
  // Token count per file (free endpoint), so the UI can show what each attachment adds to every request.
  const s = publicSettings();
  await Promise.all(
    files.map(async (f) => {
      try {
        const r = await client().messages.countTokens({
          model: s.model,
          messages: [{ role: 'user', content: [f.block, { type: 'text', text: '.' }] }],
        });
        f.tokens = r.input_tokens;
        f.costFirst = (1.25 * r.input_tokens * s.priceIn) / 1e6;
        f.costTurn = (cacheReadRatio(s.model) * r.input_tokens * s.priceIn) / 1e6;
      } catch {
        // Counting is best-effort; the attachment still works without it.
      }
    })
  );
  return files;
});

// History
ipcMain.handle('history:list', () => readJson('history.json', []));
ipcMain.handle('history:clear', () => {
  writeJson('history.json', []);
  return [];
});
// Question log: one record per question asked, upserted by id (the tool_use id).
ipcMain.handle('questions:list', () => readJson('questions.json', []));
ipcMain.handle('questions:upsert', (_e, rec) => {
  const qs = readJson('questions.json', []);
  const i = qs.findIndex((q) => q.id === rec.id);
  if (i >= 0) qs[i] = { ...qs[i], ...rec };
  else qs.push(rec);
  writeJson('questions.json', qs.slice(-3000));
  return true;
});
ipcMain.handle('questions:clear', () => {
  writeJson('questions.json', []);
  return true;
});

// Unfinished session, saved after every turn so it can be resumed after a restart.
ipcMain.handle('session:load', () => readJson('session.json', null));
ipcMain.handle('session:save', (_e, state) => {
  writeJson('session.json', state);
  return true;
});
ipcMain.handle('session:clear', () => {
  try {
    fs.unlinkSync(dataPath('session.json'));
  } catch {}
  return true;
});

// Per-request usage log, so the app can show exactly where the money goes.
function addUsage(rec) {
  const log = readJson('usage.json', []);
  log.push(rec);
  writeJson('usage.json', log.slice(-3000));
}
// Logs one response's usage with a cost split; factor 0.5 for Batch API results. Returns the cost.
function logUsage(usage, s, mode, factor = 1) {
  const u = usage || {};
  const per = (n, mult) => (((n || 0) * mult) / 1e6) * factor;
  const rec = {
    date: new Date().toISOString(),
    mode,
    model: s.model,
    effort: s.thinking,
    input: u.input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    output: u.output_tokens || 0,
    costInput: per(u.input_tokens, s.priceIn),
    costWrite: per(cacheWriteSplit(u).weighted, s.priceIn),
    costRead: per(u.cache_read_input_tokens, cacheReadRatio(s.model) * s.priceIn),
    costOutput: per(u.output_tokens, s.priceOut),
  };
  rec.cost = rec.costInput + rec.costWrite + rec.costRead + rec.costOutput;
  addUsage(rec);
  return rec.cost;
}
ipcMain.handle('usage:list', () => readJson('usage.json', []));
ipcMain.handle('history:add', (_e, entry) => {
  addHistory(entry);
  return true;
});

// ---------- Question bank ----------
// Questions are generated in bulk with the Message Batches API (50% cheaper, asynchronous),
// stored in question-bank.json, and practised offline with no API calls.
const LETTER = { type: 'string', enum: ['A', 'B', 'C', 'D'] };
const BANK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenario', 'task_statement', 'difficulty', 'format', 'question', 'options', 'correct', 'why', 'explanation', 'concept'],
  properties: {
    scenario: { type: 'string' },
    task_statement: { type: 'string', description: 'e.g. "2.3"' },
    difficulty: { type: 'string', enum: ['Exam-level', 'Expert', 'Diabolical'] },
    format: { type: 'string', enum: ['single', 'select_two'] },
    question: { type: 'string', description: 'The stem only, as markdown. No header block, no options.' },
    options: {
      type: 'object',
      additionalProperties: false,
      required: ['A', 'B', 'C', 'D'],
      properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
    },
    correct: { type: 'array', items: LETTER },
    why: { type: 'string' },
    explanation: { type: 'string' },
    concept: { type: 'string' },
  },
};

const BANK_ADDENDUM = `

## Question-bank mode (added by the desktop app)
You are filling an offline question bank, not running an interactive session. Ignore the session protocol, buttons, scoring, tools and summaries. Write exactly ONE question that follows every question-writing rule above (difficulty definitions, distractor rules, answer-key rules, scenario pairing), and return it as JSON matching the response schema:
- \`question\`: the stem only, in markdown. No header block, no "Question N", no options.
- \`options\`: the full text of A–D, without the letter prefix.
- \`correct\`: the correct letter (two letters for Select TWO), exactly as the request specifies.
- \`why\`: 1–2 short sentences shown right after the user answers: the principle behind the key and the flaw in the most tempting distractor.
- \`explanation\`: the in-depth breakdown in markdown: the principle, why the key is right, and why each other option fails (a short paragraph or bullet each).
- \`concept\`: one line naming the principle and the concepts in tension, without the answer letter.`;

const bankSystemPrompt = () => fs.readFileSync(path.join(PROMPTS_DIR, PROMPT_FILES.practice), 'utf8') + BANK_ADDENDUM;

function bankRequestText(spec) {
  const lines = ['Write one question-bank entry.'];
  if (spec.task) lines.push(`- Task statement: ${spec.task} (Domain ${spec.task[0]}).`);
  else lines.push('- Task statement: choose one that the scenario pairing rules allow for the scenario below.');
  if (spec.scenario) lines.push(`- Scenario: ${spec.scenario}.`);
  else if (spec.scenarioHint) lines.push(`- Scenario: one the pairing rules allow for this domain; prefer "${spec.scenarioHint}" if it is allowed.`);
  lines.push(`- Difficulty: ${spec.difficulty}.`);
  lines.push(
    spec.format === 'select_two'
      ? `- Format: Select TWO. The correct answers are ${spec.letters.join(' and ')}.`
      : `- Format: single answer. The correct answer is ${spec.letters[0]}.`
  );
  if (spec.avoid && spec.avoid.length) {
    lines.push('- Already in the bank for this area. Use a different concept, angle and scenario details:', ...spec.avoid.map((c) => `  - ${c}`));
  }
  lines.push(`- Variety seed ${spec.seed}: invent fresh company names, numbers and failure symptoms.`);
  return lines.join('\n');
}

// Validates one structured-output result; returns a clean bank item or null.
function parseBankItem(msg) {
  if (msg.stop_reason !== 'end_turn') return null;
  const text = (msg.content.find((b) => b.type === 'text') || {}).text;
  try {
    return normalizeBankQuestion(JSON.parse(text));
  } catch {
    return null;
  }
}

// Shared by generation and import: checks a question object and returns a clean copy or null.
function normalizeBankQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const letters = ['A', 'B', 'C', 'D'];
  const correct = [...new Set((q.correct || []).map((l) => String(l).toUpperCase()))].filter((l) => letters.includes(l)).sort();
  const ok =
    /^[1-5]\.\d$/.test(String(q.task_statement || '').trim()) &&
    ['Exam-level', 'Expert', 'Diabolical'].includes(q.difficulty) &&
    ['single', 'select_two'].includes(q.format) &&
    String(q.question || '').trim() &&
    letters.every((l) => String((q.options || {})[l] || '').trim()) &&
    correct.length === (q.format === 'select_two' ? 2 : 1);
  if (!ok) return null;
  return {
    scenario: String(q.scenario || '').trim(),
    task_statement: q.task_statement.trim(),
    difficulty: q.difficulty,
    format: q.format,
    question: q.question.trim(),
    options: Object.fromEntries(letters.map((l) => [l, q.options[l].trim()])),
    correct,
    why: String(q.why || '').trim(),
    explanation: String(q.explanation || '').trim(),
    concept: String(q.concept || '').trim(),
  };
}

// Built-in bank shipped with the app (data/default-bank.json): shared by everyone who installs it.
const DEFAULT_BANK_FILE = path.join(__dirname, '..', 'data', 'default-bank.json');
// 360 mock-exam questions from the MIT-licensed community guide (scripts/import-community-bank.js).
const COMMUNITY_BANK_FILE = path.join(__dirname, '..', 'data', 'community-bank.json');
const BANK_FORMAT = 'claude-cert-coach-bank';
function readBankFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.questions) ? raw.questions : [];
  return list
    .map((q) => {
      const clean = normalizeBankQuestion(q);
      return clean && { id: String(q.id || ''), model: q.model, createdAt: q.createdAt, ...clean };
    })
    .filter((q) => q && q.id);
}
let builtInCache = null;
function builtInBank() {
  if (!builtInCache) {
    try {
      builtInCache = readBankFile(DEFAULT_BANK_FILE).map((q) => ({ ...q, builtIn: true }));
    } catch {
      builtInCache = [];
    }
  }
  return builtInCache;
}

// Learn tab content shipped with the app: lessons per task statement and a glossary.
// data/study/*.json adds the in-depth study material (deep dive, example, playground) per lesson id.
ipcMain.handle('learn:get', () => {
  let learn;
  try {
    learn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'learn.json'), 'utf8'));
  } catch {
    return { lessons: [], glossary: [] };
  }
  const dir = path.join(__dirname, '..', 'data', 'study');
  const study = {};
  try {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        for (const s of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) if (s && s.id) study[s.id] = s;
      } catch {}
    }
  } catch {}
  for (const l of learn.lessons || []) if (study[l.id]) l.study = study[l.id];
  return learn;
});

ipcMain.handle('bank:list', () => {
  const mine = readJson('question-bank.json', []);
  const ids = new Set(mine.map((q) => q.id));
  return { bank: [...builtInBank().filter((q) => !ids.has(q.id)), ...mine], jobs: readJson('bank-jobs.json', []) };
});

// Export every question (built-in + generated) as one shareable file.
ipcMain.handle('bank:export', async () => {
  const mine = readJson('question-bank.json', []);
  const ids = new Set(mine.map((q) => q.id));
  const questions = [...builtInBank().filter((q) => !ids.has(q.id)), ...mine].map(({ builtIn, batchId, ...q }) => q);
  const res = await dialog.showSaveDialog(win, {
    title: 'Export question bank',
    defaultPath: `cca-f-question-bank-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Question bank', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, JSON.stringify({ format: BANK_FORMAT, version: 1, exportedAt: new Date().toISOString(), count: questions.length, questions }, null, 2));
  return { count: questions.length, file: res.filePath };
});

// Import a shared bank file into this computer's bank (skips duplicates and invalid entries).
ipcMain.handle('bank:import', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Import question bank', properties: ['openFile'], filters: [{ name: 'Question bank', extensions: ['json'] }] });
  if (res.canceled || !res.filePaths.length) return null;
  let incoming;
  try {
    incoming = readBankFile(res.filePaths[0]);
  } catch {
    throw new Error('That file is not a question bank export.');
  }
  const mine = readJson('question-bank.json', []);
  const seen = new Set([...mine, ...builtInBank()].flatMap((q) => [q.id, q.question]));
  const fresh = incoming.filter((q) => !seen.has(q.id) && !seen.has(q.question));
  writeJson('question-bank.json', [...mine, ...fresh]);
  return { added: fresh.length, skipped: incoming.length - fresh.length };
});

ipcMain.handle('bank:generate', async (_e, { specs, label }) => {
  const s = publicSettings();
  if (!s.model) throw new Error('No model selected. Open Settings and pick a model.');
  if (!Array.isArray(specs) || !specs.length) throw new Error('Nothing to generate.');
  // One request per question; the shared system prompt is cached across the batch.
  const system = [{ type: 'text', text: bankSystemPrompt(), cache_control: { type: 'ephemeral' } }];
  const thinking = thinkingParam(s.thinking);
  const effort = effortParam(s.thinking, s.model);
  const stamp = Date.now().toString(36);
  const requests = specs.map((spec, i) => ({
    custom_id: `q${stamp}-${i}`,
    params: {
      model: s.model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: bankRequestText(spec) }],
      output_config: { format: { type: 'json_schema', schema: BANK_SCHEMA }, ...(effort ? { effort } : {}) },
      ...(thinking ? { thinking } : {}),
    },
  }));
  const batch = await client().messages.batches.create({ requests });
  const jobs = readJson('bank-jobs.json', []);
  jobs.push({ id: batch.id, label, count: specs.length, model: s.model, status: 'in_progress', createdAt: new Date().toISOString(), imported: 0, failed: 0, cost: 0 });
  writeJson('bank-jobs.json', jobs);
  return jobs;
});

// Checks running batches; imports finished ones into the bank.
let polling = null;
ipcMain.handle('bank:poll', () => (polling = polling || pollBank().finally(() => (polling = null))));
async function pollBank() {
  const jobs = readJson('bank-jobs.json', []);
  const pending = jobs.filter((j) => j.status === 'in_progress');
  let added = 0;
  if (!pending.length) return { jobs, added };
  const c = client();
  const s = publicSettings();
  for (const job of pending) {
    let b;
    try {
      b = await c.messages.batches.retrieve(job.id);
    } catch (err) {
      job.error = err.message;
      continue;
    }
    job.counts = b.request_counts;
    if (b.processing_status !== 'ended') continue;
    const bank = readJson('question-bank.json', []);
    for await (const r of await c.messages.batches.results(job.id)) {
      if (r.result.type !== 'succeeded') {
        if (r.result.type === 'canceled') job.canceled = (job.canceled || 0) + 1;
        else job.failed++;
        continue;
      }
      const m = r.result.message;
      job.cost += logUsage(m.usage, { ...s, model: m.model || job.model }, 'bank', 0.5);
      const item = parseBankItem(m);
      if (!item) {
        job.failed++;
        continue;
      }
      bank.push({ id: r.custom_id, batchId: job.id, model: m.model, createdAt: new Date().toISOString(), ...item });
      job.imported++;
      added++;
    }
    writeJson('question-bank.json', bank);
    job.status = 'ended';
    job.endedAt = new Date().toISOString();
  }
  // Merge by id with a fresh read, so jobs added while we were polling aren't lost.
  const updated = Object.fromEntries(pending.map((j) => [j.id, j]));
  const merged = readJson('bank-jobs.json', []).map((j) => updated[j.id] || j);
  writeJson('bank-jobs.json', merged);
  return { jobs: merged, added };
}

ipcMain.handle('bank:cancel', async (_e, id) => {
  await client().messages.batches.cancel(id);
  const jobs = readJson('bank-jobs.json', []);
  const job = jobs.find((j) => j.id === id);
  if (job) job.canceling = true; // stays in_progress so the next poll imports what finished
  writeJson('bank-jobs.json', jobs);
  return jobs;
});

ipcMain.handle('bank:clear', () => {
  writeJson('question-bank.json', []);
  writeJson('bank-jobs.json', readJson('bank-jobs.json', []).filter((j) => j.status === 'in_progress'));
  return true;
});
ipcMain.handle('usage:clear', () => {
  writeJson('usage.json', []);
  return [];
});

function addHistory(entry) {
  const h = readJson('history.json', []);
  h.unshift(entry);
  writeJson('history.json', h.slice(0, 500));
}

// Chat turn. The renderer owns the conversation (messages array) and sends it in full.
// We stream text deltas back, then return the final assistant message.
const active = new Map(); // requestId -> stream
ipcMain.handle('chat:send', async (e, { requestId, mode, messages, plan, costSoFar }) => {
  const s = publicSettings();
  if (!s.model) throw new Error('No model selected. Open Settings and pick a model.');
  const c = client();

  // Prompt caching (max 4 breakpoints; we use up to 3):
  //  1. the long system prompt — shared across all sessions
  //  2. attached documents in the first user message
  //  3. the last message — so the whole conversation so far is read from cache on the next call
  const msgs = structuredClone(messages);
  const first = msgs[0];
  if (first && Array.isArray(first.content)) {
    const docIdx = first.content.map((b) => b.type).lastIndexOf('document');
    if (docIdx >= 0) first.content[docIdx].cache_control = { type: 'ephemeral', ttl: '1h' };
  }
  const last = msgs[msgs.length - 1];
  if (last && msgs.length > 1) {
    if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
    const blk = last.content[last.content.length - 1];
    if (blk && !blk.cache_control) blk.cache_control = { type: 'ephemeral' };
  }

  // The per-session randomization plan sits after the cached system prompt, so the big
  // prompt stays cached across sessions while the plan stays constant within one session.
  // The system prompt (~12K tokens with the tools) is cached for 1 hour: learners often pause 5–60 minutes
  // between answers, and a 5-minute entry would be rewritten after every such pause. The conversation
  // tail keeps the cheaper 5-minute TTL (1-hour entries must come before 5-minute ones).
  const system = [{ type: 'text', text: systemPrompt(mode), cache_control: { type: 'ephemeral', ttl: '1h' } }];
  if (plan) system.push({ type: 'text', text: plan });

  const params = {
    model: s.model,
    max_tokens: s.maxTokens,
    system,
    tools: TOOLS,
    messages: msgs,
  };
  const thinking = thinkingParam(s.thinking);
  if (thinking) params.thinking = thinking;
  const effort = effortParam(s.thinking, s.model);
  if (effort) params.output_config = { effort };

  const stream = c.messages.stream(params);
  active.set(requestId, stream);
  // The button tool's `message` (the question, feedback, summaries) streams as partial JSON.
  stream.on('inputJson', (_partial, snapshot) => {
    const text = snapshot && typeof snapshot.message === 'string' ? snapshot.message : '';
    if (text && !e.sender.isDestroyed()) e.sender.send('chat:message', { requestId, text });
  });
  stream.on('text', (delta) => {
    if (!e.sender.isDestroyed()) e.sender.send('chat:delta', { requestId, delta });
  });
  try {
    const final = await stream.finalMessage();
    const cost = logUsage(final.usage, s, mode);
    // Persist any save_session_result calls here so history survives even if the UI is closed.
    for (const b of final.content) {
      if (b.type === 'tool_use' && b.name === 'save_session_result') {
        addHistory({ ...b.input, mode, model: s.model, cost: (costSoFar || 0) + cost, date: new Date().toISOString() });
      }
    }
    return { content: final.content, stop_reason: final.stop_reason, usage: final.usage, cost };
  } finally {
    active.delete(requestId);
  }
});

ipcMain.handle('chat:abort', (_e, requestId) => {
  const st = active.get(requestId);
  if (st) st.abort();
  return true;
});
