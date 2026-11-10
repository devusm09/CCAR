// Generates the app icon SVG: terracotta tile, cream starburst, graduation cap.
const fs = require('fs');
const out = process.argv[2];
const cx = 512, cy = 668;
const lens = [178, 150, 172, 146, 182, 154, 176, 148, 180, 152, 170, 146];
const rays = lens.map((len, i) => {
  const a = (i * 30 - 90) * Math.PI / 180;
  const x1 = cx + Math.cos(a) * 50, y1 = cy + Math.sin(a) * 50;
  const x2 = cx + Math.cos(a) * len, y2 = cy + Math.sin(a) * len;
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E5906D"/>
      <stop offset="1" stop-color="#B9532F"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#bg)"/>
  <g stroke="#FBF3E8" stroke-width="56" stroke-linecap="round">${rays}</g>
  <circle cx="${cx}" cy="${cy}" r="74" fill="#FBF3E8"/>
  <!-- graduation cap -->
  <path d="M352 372 L352 468 Q512 548 672 468 L672 372 Z" fill="#2A211C"/>
  <path d="M512 176 L838 312 L512 448 L186 312 Z" fill="#2A211C" stroke="#2A211C" stroke-width="20" stroke-linejoin="round"/>
  <path d="M512 312 L770 360 L770 508" fill="none" stroke="#F4BE4F" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="512" cy="312" r="24" fill="#F4BE4F"/>
  <path d="M746 500 L794 500 L806 580 L734 580 Z" fill="#F4BE4F" stroke="#F4BE4F" stroke-width="10" stroke-linejoin="round"/>
</svg>
`;
fs.writeFileSync(out, svg);
