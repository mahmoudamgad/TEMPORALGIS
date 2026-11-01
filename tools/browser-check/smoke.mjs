// Run against: npx ng serve --port 4217
import { open, sleep } from './harness.mjs';
const page = await open('http://localhost:4217/');
const report = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
const scales = `({left: Math.round(app.panes.left.view.scale), right: Math.round(app.panes.right.view.scale)})`;
try {
  report('images 2d idle ms', await page.idle());
  await page.shot('smoke-images-2d.png');

  // Wheel zoom over the RIGHT map must also move the left one.
  const box = await page.evaluate(`(() => { const r = app.rightCanvas.nativeElement.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.evaluate(`document.scrollingElement.scrollTop = 0; 1`);
  report('before wheel', await page.evaluate(scales));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(200);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -400 });
  await sleep(1500);
  report('after wheel on right', await page.evaluate(scales));
  report('activeSide', await page.evaluate(`app.activeSide`));
  await page.evaluate(`app.resetView()`);

  // The Added filter must also filter polygons on the map.
  report('overlay all', await page.evaluate(`app.panes.left.overlay.graphics.length`));
  await page.evaluate(`app.setFilter('added'); 1`);
  report('overlay added only', await page.evaluate(`({ count: app.panes.left.overlay.graphics.length, expected: app.count().added })`));
  await page.evaluate(`app.setFilter('all'); 1`);

  // Epoch change: backdrop and building filter.
  await page.evaluate(`app.setEpoch('left', 201603); 1`);
  await page.idle();
  report('left visible backdrop', await page.evaluate(`[...app.panes.left.backdrops].filter(([, l]) => l.visible).map(([e]) => e)`));
  report('left expr', await page.evaluate(`app.panes.left.buildings.definitionExpression`));
  // Month and year pickers: a year without the current month falls back to its nearest month.
  await page.evaluate(`app.setYear('left', 2022); 1`);
  report('left after setYear 2022', await page.evaluate(`app.leftEpoch()`));
  await page.evaluate(`app.setEpoch('left', 201911); 1`);

  await page.evaluate(`app.setMode('3d'); 1`);
  report('images 3d idle ms', await page.idle());
  await page.shot('smoke-images-3d.png');
  await page.evaluate(`app.setMode('2d'); 1`);
  await page.idle();

  await page.evaluate(`app.setScene('satellite')`);
  report('satellite 2d idle ms', await page.idle());
  await page.shot('smoke-satellite-2d.png');

  const t0 = Date.now();
  await page.evaluate(`app.setScene('loadtest')`);
  report('loadtest fetch+create ms', Date.now() - t0);
  report('loadtest 2d idle ms', await page.idle());
  report('loadtest overlay', await page.evaluate(`app.panes.left.overlay.graphics.length`));
  report('loadtest list rows', await page.evaluate(`({ listed: app.listedChanges().length, total: app.filteredChanges().length })`));
  await page.shot('smoke-loadtest-2d.png');
  const t1 = Date.now();
  await page.evaluate(`app.setEpoch('right', 202409); 1`);
  report('loadtest epoch switch call ms', Date.now() - t1);
  report('loadtest epoch settle ms', await page.idle());

  await page.evaluate(`app.setMode('3d'); 1`);
  report('loadtest 3d idle ms', await page.idle());
  await page.shot('smoke-loadtest-3d.png');
} catch (err) {
  console.log('FAILED:', err.message);
}
console.log('--- console errors/warnings', page.logs.length);
for (const line of [...new Set(page.logs)].slice(0, 25)) console.log(line.slice(0, 300));
console.log('--- failed requests', page.failed.length);
for (const line of [...new Set(page.failed)].slice(0, 15)) console.log(line.slice(0, 200));
await page.close();
process.exit(0);
