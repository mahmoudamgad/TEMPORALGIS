// Captures the right map of the Satellite scene at several epochs, with a pixel grid, and records the view extent.
// Usage: node capture.mjs <config.json>
// config: { url, center: [lon, lat], zoom, epochs: [YYYYMM...], prefix, size, grid, changes }
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep, OUT } from '../browser-check/harness.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const size = config.size ?? 900;
const page = await open(config.url ?? 'http://localhost:4200/', { width: size * 2 + 120, height: size + 700 });
try {
  await page.idle();
  await page.evaluate(`app.setScene('satellite')`);
  await page.idle();
  await page.evaluate(`(() => {
    const s = document.createElement('style');
    s.textContent = '.app-shell{max-width:none!important;padding:0 10px!important}.workspace{grid-template-columns:minmax(0,1fr)!important}.inspector,.intro,.topbar{display:none!important}.map-viewport{height:${size}px!important;min-height:${size}px!important;flex:none!important}.map-card{width:${size}px}.two-maps{grid-template-columns:${size}px ${size}px!important}.view-badge{display:none}';
    document.head.appendChild(s);
    return 1; })()`);
  await sleep(1500);
  await page.evaluate(`app.showChanges() !== ${config.changes !== false} && app.toggleChanges(), 1`);
  await page.evaluate(`app.setEpoch('left', ${config.epochs[0]}); 1`);
  await page.evaluate(`app.panes.right.view.goTo({ center: ${JSON.stringify(config.center)}, zoom: ${config.zoom} }, { animate: false }).then(() => 1)`);
  // Pixel grid over the right map: a line every `grid` px, labelled every two lines.
  const grid = config.grid ?? 50;
  await page.evaluate(`(() => {
    const host = app.rightCanvas.nativeElement.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" style="position:absolute;inset:0;pointer-events:none;z-index:5">';
    for (let x = 0; x <= w; x += ${grid}) svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + h + '" stroke="rgba(255,255,0,' + (x % ${grid * 2} ? 0.25 : 0.5) + ')" stroke-width="1"/>' + (x % ${grid * 2} ? '' : '<text x="' + (x + 2) + '" y="12" fill="yellow" font-size="11" font-family="monospace">' + x + '</text>');
    for (let y = 0; y <= h; y += ${grid}) svg += '<line x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '" stroke="rgba(255,255,0,' + (y % ${grid * 2} ? 0.25 : 0.5) + ')" stroke-width="1"/>' + (y % ${grid * 2} ? '' : '<text x="2" y="' + (y - 2) + '" fill="yellow" font-size="11" font-family="monospace">' + y + '</text>');
    svg += '</svg>';
    const div = document.createElement('div'); div.id = 'trace-grid'; div.innerHTML = svg; host.appendChild(div);
    return 1; })()`);
  const results = [];
  for (const epoch of config.epochs) {
    await page.evaluate(`app.setEpoch('right', ${epoch}); 1`);
    await page.idle();
    await sleep(2500);
    const box = await page.evaluate(`(() => { const r = app.rightCanvas.nativeElement.getBoundingClientRect(); window.scrollTo(0, 0); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
    const file = await page.shot(`${config.prefix}-${epoch}.png`, box);
    results.push({ epoch, file });
  }
  const view = await page.evaluate(`(() => { const v = app.panes.right.view; const e = v.extent; return { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax, wkid: e.spatialReference.wkid, width: v.width, height: v.height, zoom: v.zoom }; })()`);
  writeFileSync(join(OUT, `${config.prefix}-view.json`), JSON.stringify({ ...view, center: config.center, captures: results }, null, 1));
  console.log(JSON.stringify({ view, results }, null, 1));
} catch (err) {
  console.log('FAILED:', err.message);
}
console.log('logs', page.logs.slice(0, 10));
await page.close();
process.exit(0);
