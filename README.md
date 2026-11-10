# Claude Cert Coach

Desktop app (Electron) for two modes built from your prompts:

- **CCA-F Training** (the **Train** tab): build a session in three steps: **type** (Quick drill 5 / Quiz 10 / Mock exam 20), **what to train** (all domains, one domain, one scenario, or your weak areas) and **difficulty** (Mixed, Exam-level, Expert, Diabolical). Then press **Start training**. The page also shows your headline stats and readiness per domain; clicking a domain preselects it. **More options** has the official-guide attachment, a printable static list and a free-text request.
- **Certification Fit Evaluator**: attach two or more exam guides (PDF/MD/TXT) and get a digest, a diagnostic test and a recommendation.

Answers use clickable buttons (the prompts' `ask_user_input_v0` tool). Finished quizzes and evaluations are saved to **Progress** with per-domain scores.

## Run it

Requires Node.js 18+.

```bash
npm install
npm start
```

The app opens straight to the **Train** tab and works **fully offline, with no API key**: practise from the built-in question bank (quick drills, quizzes, mock exams, domain, scenario, weak-area and review-mistakes focus), with scoring, explanations, readiness and Progress.

An API key is optional. Add one under **Settings** only for the live features: fresh questions from Claude, generating new bank questions with the Batch API, *Ask Claude about this*, and the certification fit evaluator.
1. Paste your Anthropic API key.
2. Click **Load models**.
3. Pick a model and click **Save**. Opus is selected by default.

Until then the top bar shows **Offline mode**, and the live features explain that they need a key.

**Appearance.** The app follows the Microsoft Teams (Fluent 2) look: a left app rail with icons, neutral grey chrome, Teams purple accents and white (light) or charcoal (dark) surfaces. Light is the default; switch to Dark or *Match Windows / macOS* under **Settings → Appearance**. The change applies immediately and needs no API key.

## Build an installer

```bash
npm run dist:win    # Windows .exe installer -> dist/
npm run dist:mac    # macOS .dmg (run on a Mac)
```

## App icon

The icon source is `build/icon.svg`. To change it, edit `scripts/icon-svg.js` and regenerate:

```bash
node scripts/icon-svg.js build/icon.svg
npx electron scripts/icon-render.js "$PWD/build/icon.svg" "$PWD/build"
```

This writes `build/icon.png` (1024 px) and `build/icon.ico` (16–256 px), which electron-builder uses for the installers. Copy `build/icon.svg` to `src/assets/icon.svg` (top bar) and save a 256 px PNG as `src/assets/icon.png` (window icon). Run the command from a normal terminal: in VS Code's terminal, clear `ELECTRON_RUN_AS_NODE` first.

## Model choice

| Model  | Use for |
|--------|---------|
| Opus   | Recommended. It follows the long exam rule set most reliably and writes the hardest fair distractors. |
| Sonnet | Faster and cheaper. Good for daily drills. |
| Haiku  | Not recommended for question generation. |

You can change the model anytime in **Settings**. Under **Advanced**, Settings has a **Quality vs. cost** option (the API's effort setting): Medium is the default, High gives slightly better questions for more output tokens, Low is cheapest. Thinking itself always stays adaptive, because Opus 5.5 and Sonnet 5.5 don't allow it to be switched off.

## Cost and randomization

- **Prompt caching.** The system prompt, attached guides and the conversation so far are cached. On each new call, earlier turns are billed at the cache-read rate (5% of the input price on Opus 5.5, 10% on most other models). The cache lasts 5 minutes between calls.
- **Attachments cost the most.** A PDF guide is sent with every request, and each page counts as both text and an image. When you attach a file, the app shows its token count and cost. The CCA-F outline is already built into the prompt, so practice sessions rarely need the guide.
- **One API call per question in live practice.** After you answer, the app shows right/wrong, the key and Claude's *why*, then its own *Next question / Explain in depth* buttons. Your answer and your choice go to Claude together in one request, instead of spending a separate request only to show those buttons.
- **1-hour cache for the fixed prompt.** The system prompt (about 12K tokens with the tool definitions) and any attached guide are cached for 1 hour instead of 5 minutes, so pausing to read an explanation doesn't force the whole prompt to be re-written to cache. 1-hour cache writes cost 2x input (5-minute writes 1.25x); the cost estimate prices both correctly.
- **Cost estimate.** The chat header shows the estimated $ for the current session, and each Progress entry shows what that session cost. Prices are set in Settings and prefilled per model (for example Opus 5.5: $4 / $20 per million tokens). Check your Anthropic Console for current rates.
- **Randomized sessions.** Every session gets its own random plan:
  - answer positions (balanced across A–D, never 3 in a row)
  - scenario order (and the 4 mock-exam scenarios)
  - the order task statements are picked within each domain
  - a variety seed, so questions differ from session to session

## Exam simulation

**Train → Session type → Exam simulation** runs a full offline exam like the real one: **60 questions in 120 minutes** from **4 random scenarios**, in the official domain split (16 / 11 / 12 / 12 / 9). Questions show only their scenario, as on the exam (no difficulty or task labels).

- Move freely between questions, change answers until you submit, and **flag** questions for review. A numbered question map shows answered, flagged and current questions. Keyboard: <kbd>A</kbd>–<kbd>D</kbd>, <kbd>F</kbd> flag, <kbd>←</kbd> <kbd>→</kbd> move.
- **Review & submit** lists every question with your answer, highlights unanswered ones (they count as wrong) and jumps to the first flagged or unanswered question.
- The clock keeps running if you leave or close the app; a banner on the Train tab resumes the exam, and it submits automatically at 0:00.
- Results: percent per domain, time used, links to the lessons for every missed task statement, and a full expandable review. All 60 answers count towards readiness, levels, weak areas and spaced repetition. No scaled score is invented: the real exam reports 100–1,000 with a pass mark of 720.
- If the 4 drawn scenarios can't fill a domain's share, questions are borrowed from other scenarios and the results say how many.

## Spaced repetition

Every bank question you miss comes back **1, 3 and 7 days later** until you answer it correctly at three reviews in a row. Answering it correctly before it is due doesn't count, so same-day retries can't skip the spacing. The Train tab shows **"N questions due for review today → Review now"** and how many more are scheduled. The schedule is derived from your question log, so *Reset history* resets it.

## Insights and the bank browser

- **Progress → Insights:** current and best practice streak, days practised and minutes in the last 2 weeks, a chart of questions and accuracy per day, practice minutes per day, and a **heatmap of the 30 task statements** (accuracy on your last 30 answers each). Click a cell to open its lesson.
- **Bank (left rail):** search all bank questions (text, options, scenario, concept) and filter by domain, difficulty and your last result (unseen, missed, correct, due for review). Open a question to preview it with the answer hidden; **Reveal answer** shows the key, the why and the full explanation. Practise one question, or up to 20 from the current filter.

## Learn tab

A curriculum of **30 lessons**, one per CCA-F task statement, written for this app from the official exam outline (the same outline the prompts use), plus a **quick reference** (one decision rule per task statement) and a searchable **glossary** of 60 terms. It works offline.

- **Pattern:** work through a lesson → practise its questions → review mistakes → mock exam. The overview shows a progress ring, a *Continue* button that returns you to the exact step you left, and colour-coded domain cards with lessons read and quiz average.
- **Each lesson is 5 guided steps** (tabs with Back/Next; your step is remembered per lesson):
  1. **📖 Learn:** *In plain words* with an everyday analogy, a **diagram** (flow, hub or comparison), a *Deep dive* where each section opens with a one-line takeaway, *Myth vs fact* cards, and an *In the real world* story from an exam scenario. Where current models or tools differ from the exam outline, an *In current models and tools* note says so.
  2. **💻 Example:** annotated worked example; switch code between **Python, C# and TypeScript** (remembered).
  3. **🧪 Playground: scenario lab.** 3 exam-style scenarios per lesson (90 in all), each set in one of the 6 official exam scenarios: context, an exam-style question and 4 options with one best answer. Lock in your answer, watch a mock run of what your choice does, see the best answer and why, read the exam takeaway, then run any other option to compare. First-try results show as ✓/✗ on each scenario tab. A white card in both themes; nothing is sent to the API.
  4. **📝 Revise:** decision rule, key points, common traps, exam tip and *Quick recall* cards.
  5. **🎯 Quiz:** 4 exam-style questions, one at a time, with instant feedback. 3/4 or better marks the lesson read; the score shows in the sidebar. Then practise the bank questions for that task statement.
- Opening a lesson from a wrong answer jumps straight to **Revise** with the trap you picked highlighted.
- **📅 Exam date and daily plan:** set your exam date on the curriculum overview to get a countdown and today's tasks: your 2 weakest or unstudied lessons, a scenario lab, a rule drill, and a full mock exam every 5 days (every other day in the final week). On exam day the plan is just the cheat sheet and a short warm-up.
- **⚡ Rule drill:** 5-minute flashcard rounds built from all 120 lesson traps. Each card shows a tempting wrong answer; you recall the rule that beats it, flip (Space) and grade yourself (1 missed / 2 got it). Spaced repetition (Leitner boxes: 0, 1, 3, 7, 14 days) brings missed cards back sooner; new cards come from your weakest lessons first.
- **🖨️ Cheat sheet:** *Print cheat sheet* on the Quick reference page prints one page with all 30 decision rules plus the top traps from your weakest lessons.
- **Practise this task statement** starts an offline session with every bank question for it (7 each) and marks the lesson read. After any bank session, the result card links each missed task statement back to its lesson (📖).
- The sidebar shows read ticks and your recent accuracy per task statement. Read state is stored on this computer.
- Content lives in `data/learn.json` (lessons, glossary) and `data/study/d1–d5.json` (study material and playgrounds, merged by lesson id) and ships with the installer. Run `node scripts/check-study.js` after editing study files.
- **Community mock questions:** 360 extra offline questions from the MIT-licensed [claude-architect-exam-guide](https://github.com/utkarsh1agarwal/claude-architect-exam-guide) mock exams are part of the built-in bank (`data/community-bank.json`). They are used by practice sessions and mock exams like any other bank question. Exams 1–3 are tagged Exam-level, the hard-mode exams 4–6 Expert. The task statement is inferred from keywords, and options were reordered because the source key puts most answers on B. Each explanation credits its source. Rebuild with `node scripts/import-community-bank.js <cloned repo>`.

## Offline question bank

Practise instantly with no API cost from a bank of pre-generated questions, and use the API only to grow the bank.

- **Generate a collection** in the *Question bank* panel on the Train tab: choose how many (10–100), a focus (all domains by exam weight, one domain, your weak areas, or one scenario) and a difficulty mix. The app plans one slot per question (task statement, difficulty, correct letter, balanced across A–D, about one in six harder items as Select TWO) and sends them as a **Message Batches API** job: 50% cheaper, results usually within an hour (24 hours at most). Each result is a structured JSON question (stem, options A–D, answer key, a short *why*, an in-depth explanation and the concept tested), validated and saved to `question-bank.json`. The app checks running batches every minute while it's open and imports them automatically.
- **Practise offline:** set the session builder's source to **⚡ Question bank** (always the default without an API key). Questions appear instantly. The picker serves unseen questions first, then ones you missed, then ones you mastered, at your adaptive level's difficulty mix and the exam's domain weights. Scoring, the green/red reveal, explanations, readiness, levels, weak areas, timers and Progress all work as in live sessions.
- **Question cards:** each question shows its scenario, domain, task statement and difficulty, with the four options as full-text buttons. Keyboard: <kbd>A</kbd>–<kbd>D</kbd> (or <kbd>1</kbd>–<kbd>4</kbd>) to answer, <kbd>S</kbd> to skip, <kbd>Enter</kbd> to submit a Select-TWO or go to the next question, <kbd>E</kbd> to open the in-depth explanation. A progress bar and running score sit under the session header.
- **End of session:** a score card with per-domain results and missed task statements, then an expandable review of every question (your pick, the key, the explanation). From there: **Keep going**, **Retry the ones I missed**, a new session, or back to Train.
- **Review mistakes:** a focus in the session builder that serves every bank question you last answered wrong.
- **Mock exams** draw 20 questions (mostly Exam-level, as on the real exam), hold feedback until the end, and show a 40-minute time budget (2 minutes per question), like the real exam's pace.
- **💬 Ask Claude about this** hands any bank question, with your answer, to a live session for follow-up or to dispute the key (needs an API key).
- **✨ Live with Claude** is still available for fresh questions generated on the spot.

**Built-in bank (shared with your team).** `data/default-bank.json` ships inside the app with 210 questions (7 for each of the 30 task statements, answer letters balanced across A–D), so every install, including installers built with `npm run dist:win`, starts with those questions, read-only and marked *built-in*. To refresh it after generating more questions, run `node scripts/build-default-bank.js`. It merges this computer's generated questions into the file, drops duplicates and invalid entries, and prints the coverage. Then rebuild or share the repo. To share without rebuilding, use **Export** in the Question bank panel and have teammates **Import** the file.

**Delete generated questions** removes only the questions generated or imported on this computer. Built-in questions, scores and history are kept, and *Reset history* keeps the bank.

## Adaptive training and exam readiness

- **Right or wrong, instantly.** After each practice answer, the app shows **✓ Correct** or **✗ Incorrect** with the correct letter and the time you took. It reads this straight from the answer key, then Claude writes the explanation. If Claude replies without an explanation, the app asks for it once. Mock exams and the fit diagnostic keep feedback until the end.
- **Adaptive level (1–5).** You start at Level 1 (real exam difficulty). The app checks your last 8 answers: 6 or more correct moves you up a level, 3 or fewer moves you down. The levels are Foundation (Exam-level only), Developing (mostly Exam-level, some Expert), Proficient (the standard mix), Advanced (Expert and Diabolical) and Master (Diabolical only). **Adaptive** is the default difficulty in the session builder. If your level changes mid-session, the app tells you, and in adaptive sessions it tells Claude to adjust the remaining questions.
- **Exam readiness bar (0–100%).** For each domain it combines accuracy on your last 30 questions with coverage, meaning how many questions you have answered against a target of about 40 in exam proportions. Missing an Expert or Diabolical question still earns a little credit. Domains are weighted like the exam, and the bar is marked at 80% (the exam-ready zone). It is a practice estimate, not a predicted exam score.
- **Recommended next session.** One click trains whatever is holding your readiness back: a domain with too few questions, your weak task statements, the lowest-scoring domain, or a mock exam once you are in the exam-ready zone.
- **Time.** The chat header shows a session timer and a timer for the current question. Your average time per question and total time trained appear on Train and Progress.

## Question log, progress and resume

- **Question log.** Claude silently calls a `log_question` tool with each question. The entry holds the task statement, scenario, a one-line concept summary and the correct letter(s). The app pairs it with your answer, whether clicked or typed ("b", "A and C", "skip"), and scores you itself.
- **No repeats across sessions.** Each new session tells Claude which concepts it already asked you (the last 80 for that mode) and to take a different angle.
- **Weak areas.** The "Weak areas" focus (or **Train my weak areas**) targets your lowest-accuracy task statements: below 70%, up to 5 of them.
- **CCA-F progress.** The Progress tab shows the total number of questions answered, accuracy per domain and your weakest task statements. Skips count as wrong.
- **Resume.** The in-progress session is saved after every turn. If you close the app, a banner on the Train tab lets you resume or discard it. While a session is running, a **Current session** tab appears in the top bar so you can move between screens and come back.

**Reset history** (on the Progress tab, and under Settings) deletes the session results and the question log. Readiness, level, weak areas, time stats and repeat-avoidance all start over.

## Where data lives

The API key, settings, history (`history.json`), question log (`questions.json`) and any unfinished session (`session.json`) are stored in the app's user-data folder on your computer:

- Windows: `%APPDATA%\Claude Cert Coach`
- macOS: `~/Library/Application Support/Claude Cert Coach`

The key is encrypted with the OS keychain when one is available. The key is sent only to `api.anthropic.com`, and API calls are made from the main process, so the UI never sees the key.

## Editing the prompts

The system prompts are in `prompts/`. Edit them and restart the app. The app appends a short "App integration" section to each prompt (see `src/main.js`). That section tells the model to use the button tool and to call `save_session_result` at the end.

**Keep user-facing text in `ask_user_input_v0.message`.** On Claude Opus 5.5 and Sonnet 5.5, text the model writes between tool calls comes back as hidden thinking blocks, not visible text. That is why questions and feedback used to go missing. The App integration section therefore tells the model to put every question, explanation and summary in the button tool's `message` field, which the app displays word for word (and streams live). If you edit the prompts, don't reintroduce "write the question as text before the tool call".

## Structure

```
src/main.js            Electron main: settings, key storage, model list, streaming API calls, history
src/preload.js         Safe IPC bridge
src/renderer/          UI: index.html, styles.css, app.js (core + live chat), bank.js (offline bank, spaced repetition),
                       learn.js (Learn tab), exam.js (exam simulation), insights.js (Progress charts), browse.js (bank browser)
prompts/               The two system prompts
build/                 App icon (SVG, PNG, ICO) for the installers
src/assets/            Window and top-bar icon
scripts/               Icon generator
```
## Referance

```
https://github.com/utkarsh1agarwal/claude-architect-exam-guide

```