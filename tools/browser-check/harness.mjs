// Minimal CDP driver for the app, no dependencies. Uses a throwaway Chrome profile.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const OUT = join(tmpdir(), 'temporal-gis-browser-check');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open(url, { width = 1700, height = 1200 } = {}) {
  const profile = join(OUT, 'chrome-profile');
  mkdirSync(profile, { recursive: true });
  console.log('Screenshots go to', OUT);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('no chrome target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  const failed = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type.toUpperCase() + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failed.push(m.params.response.status + ' ' + m.params.response.url);
    } else if (m.method === 'Network.loadingFailed' && !m.params.canceled) {
      failed.push('FAILED ' + m.params.errorText + ' ' + m.params.requestId);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Page.navigate', { url });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const path = join(OUT, name);
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  };
  const waitFor = async (expression, timeout = 120000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await evaluate(expression)) return Date.now() - start; await sleep(250); }
    throw new Error('timeout waiting for: ' + expression);
  };
  const close = async () => { try { await send('Browser.close'); } catch {} proc.kill(); };
  // Component access works because the dev build exposes the `ng` global.
  await waitFor(`!!(window.ng && document.querySelector('app-root') && ng.getComponent(document.querySelector('app-root')))`);
  await evaluate(`window.app = ng.getComponent(document.querySelector('app-root')); 1`);
  const idle = () => waitFor(`!app.busy() && !!app.panes.left && !!app.panes.right && !app.panes.left.view.updating && !app.panes.right.view.updating`);
  return { send, evaluate, shot, waitFor, idle, close, logs, failed };
}
