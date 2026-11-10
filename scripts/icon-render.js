// Renders an SVG to PNGs (via an in-page canvas) and packs a multi-size ICO.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const [svgPath, outDir] = process.argv.slice(-2);
app.whenReady().then(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    await img.decode();
    return ${JSON.stringify(sizes)}.map((s) => {
      const c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png');
    });
  })()`);
  const pngs = urls.map((u) => Buffer.from(u.split(',')[1], 'base64'));
  const by = Object.fromEntries(sizes.map((s, i) => [s, pngs[i]]));
  fs.writeFileSync(path.join(outDir, 'icon.png'), by[1024]);
  fs.writeFileSync(path.join(outDir, 'icon-256.png'), by[256]); // copy to src/assets/icon.png
  const ico = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(ico.length, 4);
  let offset = 6 + 16 * ico.length;
  const dir = ico.map((s) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(by[s].length, 8); e.writeUInt32LE(offset, 12);
    offset += by[s].length;
    return e;
  });
  fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, ...dir, ...ico.map((s) => by[s])]));
  console.log('ok', ico.map((s) => by[s].length).join(','));
  app.quit();
});
