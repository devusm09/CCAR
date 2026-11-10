/* Claude Cert Coach — Progress insights: practice streak, daily accuracy and volume, time per day,
 * and a heatmap of the 30 task statements. Built as inline SVG/HTML from the question log (no API,
 * no chart library). Days are grouped in local time. Loaded after app.js and uses its globals. */
'use strict';

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lastDays = (n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });

function streaks(days) {
  // days: Set of practised day keys. Current streak counts back from today (or yesterday if not yet today).
  let cur = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) {
    cur++;
    d.setDate(d.getDate() - 1);
  }
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of sorted) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { cur, best };
}

// A bar chart: one bar per day (height = value), optional line overlay (0–100 %).
function barChart(days, values, { line, unit, color, lineColor }) {
  const W = 560;
  const H = 150;
  const pad = { l: 30, r: line ? 36 : 10, t: 12, b: 24 };
  const max = Math.max(4, ...values); // at least 0–4 so axis labels never repeat
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const yl = (p) => pad.t + (H - pad.t - pad.b) * (1 - p / 100);
  const bars = values
    .map((v, i) => {
      const x = pad.l + i * bw + bw * 0.18;
      const h = H - pad.b - y(v);
      return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(v ? 2 : 0, h).toFixed(1)}" rx="3" fill="${color}"><title>${days[i].toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${v} ${unit}</title></rect>`;
    })
    .join('');
  const labels = days
    .map((d, i) => (i % 2 === days.length % 2 ? '' : `<text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.getDate()}</text>`))
    .join('');
  let lineSvg = '';
  if (line) {
    const pts = line.map((p, i) => (p == null ? null : [pad.l + i * bw + bw / 2, yl(p)])).filter(Boolean);
    if (pts.length) {
      lineSvg = `<polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" />
        ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${lineColor}" />`).join('')}`;
    }
  }
  const grid = [0, 0.5, 1]
    .map((f) => {
      const yy = pad.t + (H - pad.t - pad.b) * (1 - f);
      // Left axis: bar values. Right axis (with a line): accuracy %.
      return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" class="grid" /><text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${Math.round(f * max)}</text>${
        line ? `<text x="${W - pad.r + 6}" y="${yy + 4}" text-anchor="start">${Math.round(f * 100)}%</text>` : ''
      }`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${grid}${bars}${lineSvg}${labels}</svg>`;
}

function renderInsights(qs) {
  const box = $('#insights');
  const done = doneQs(qs).filter((q) => q.answeredAt || q.date);
  if (!done.length) {
    box.innerHTML = '';
    return;
  }
  const when = (q) => Date.parse(q.answeredAt || q.date);
  const days = lastDays(14);
  const byDay = {};
  for (const q of done) {
    const k = dayKey(when(q));
    const s = (byDay[k] = byDay[k] || { n: 0, ok: 0, secs: 0 });
    s.n++;
    if (q.isCorrect) s.ok++;
    s.secs += Math.min(q.seconds || 0, MAX_Q_SECONDS);
  }
  const practised = new Set(Object.keys(byDay));
  const st = streaks(practised);
  const counts = days.map((d) => (byDay[dayKey(d)] || {}).n || 0);
  const acc = days.map((d) => {
    const s = byDay[dayKey(d)];
    return s && s.n ? Math.round((100 * s.ok) / s.n) : null;
  });
  const mins = days.map((d) => Math.round(((byDay[dayKey(d)] || {}).secs || 0) / 60));
  const active14 = counts.filter(Boolean).length;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#5b5fc7';
  const ok = css.getPropertyValue('--t-green').trim() || '#107c10';
  const teal = css.getPropertyValue('--t-teal').trim() || '#038387';

  // Heatmap: accuracy on the last 30 answers per task statement.
  const per = {};
  for (const q of done) (per[q.task_statement] = per[q.task_statement] || []).push(q.isCorrect ? 1 : 0);
  const heat = [1, 2, 3, 4, 5]
    .map((d) => {
      const cells = Array.from({ length: TASKS[d] }, (_, i) => {
        const t = `${d}.${i + 1}`;
        const a = (per[t] || []).slice(-30);
        const p = a.length ? Math.round((100 * a.reduce((x, y) => x + y, 0)) / a.length) : null;
        const cls = p == null ? 'none' : p >= 80 ? 'h4' : p >= 65 ? 'h3' : p >= 50 ? 'h2' : 'h1';
        return `<button class="heat ${cls}" data-study="${t}" title="${t} ${esc(TASK_NAMES[t] || '')}: ${p == null ? 'not practised' : `${p}% of ${a.length}`}"><b>${t}</b><span>${p == null ? '—' : p + '%'}</span></button>`;
      }).join('');
      return `<div class="heat-row"><span class="heat-dom">D${d}</span><div class="heat-cells">${cells}</div></div>`;
    })
    .join('');

  box.innerHTML = `<div class="overview insights">
    <h2 class="card-h"><span class="h-ico t-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="m5 15 4-5 4 3 6-7"/></svg></span>Insights</h2>
    <div class="ins-stats">
      <div class="stat"><span class="stat-ico t-berry">🔥</span><div class="stat-txt"><b>${st.cur} day${st.cur === 1 ? '' : 's'}</b><span class="muted small">current streak (best ${st.best})</span></div></div>
      <div class="stat"><span class="stat-ico t-teal">📅</span><div class="stat-txt"><b>${active14}/14</b><span class="muted small">days practised, last 2 weeks</span></div></div>
      <div class="stat"><span class="stat-ico t-gold">⏱</span><div class="stat-txt"><b>${mins.reduce((a, b) => a + b, 0)} min</b><span class="muted small">practice time, last 2 weeks</span></div></div>
    </div>
    <div class="ins-grid">
      <div class="ins-chart"><div class="ins-h"><b>Questions and accuracy per day</b><span class="legend small muted"><span><i class="sw" style="background:${accent}"></i>questions</span><span><i class="sw" style="background:${ok}"></i>accuracy</span></span></div>
        ${barChart(days, counts, { unit: 'questions', color: color_mix(accent), line: acc, lineColor: ok })}
      </div>
      <div class="ins-chart"><div class="ins-h"><b>Practice minutes per day</b></div>${barChart(days, mins, { unit: 'minutes', color: teal })}</div>
    </div>
    <div class="ins-h"><b>Task statement heatmap</b><span class="legend small muted"><span><i class="sw h1"></i>&lt;50%</span><span><i class="sw h2"></i>50–64%</span><span><i class="sw h3"></i>65–79%</span><span><i class="sw h4"></i>80%+</span><span><i class="sw none"></i>not practised</span></span></div>
    <div class="heatmap">${heat}</div>
    <p class="muted tiny">Accuracy on your last 30 answers per task statement. Click a cell to open its lesson.</p>
  </div>`;
}
// Soft version of a colour for bars under the accuracy line.
const color_mix = (c) => `color-mix(in srgb, ${c} 45%, transparent)`;

$('#insights').addEventListener('click', (e) => {
  const b = e.target.closest('[data-study]');
  if (b) openLesson(b.dataset.study);
});
