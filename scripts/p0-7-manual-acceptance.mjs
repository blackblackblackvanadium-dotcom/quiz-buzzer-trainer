import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const distDir = resolve(process.argv[2] ?? 'dist');
const outDir = resolve(process.argv[3] ?? 'p0-7-evidence');
await mkdir(outDir, { recursive: true });

let swVariant = false;
const originalSw = await readFile(join(distDir, 'sw.js'), 'utf8');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (pathname === '/__acceptance__/sw-variant-on') {
      swVariant = true;
      response.writeHead(204).end();
      return;
    }
    if (pathname === '/sw.js') {
      const body = swVariant ? `${originalSw}\n// p0-7-acceptance-update-variant\n` : originalSw;
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(body);
      return;
    }
    const relative = normalize(pathname).replace(/^[/\\]+/u, '');
    const filePath = resolve(distDir, relative);
    if ((!filePath.startsWith(`${distDir}/`) && filePath !== join(distDir, 'index.html')) || !existsSync(filePath)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise);
  server.listen(0, '127.0.0.1', resolvePromise);
});
const address = server.address();
assert(address && typeof address === 'object', 'Acceptance server did not start');
const origin = `http://127.0.0.1:${address.port}`;

function findChrome() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('Chrome/Chromium is required for P0 #7 manual acceptance');
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // retry
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolvePromise, rejectPromise) => {
        this.socket.addEventListener('open', resolvePromise, { once: true });
        this.socket.addEventListener('error', rejectPromise, { once: true });
      });
    }
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, awaitPromise = false) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    return result.result?.value;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
      try {
        lastValue = await this.evaluate(expression, expression.includes('.then('));
        if (lastValue) return lastValue;
      } catch (error) {
        lastValue = String(error);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for condition: ${expression}; last=${String(lastValue)}`);
  }
  async screenshot(name) {
    const result = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(outDir, name), Buffer.from(result.data, 'base64'));
  }
  close() {
    this.socket.close();
  }
}

const debugPort = 9333;
const profile = join(tmpdir(), `qbt-p0-7-${process.pid}`);
await rm(profile, { recursive: true, force: true });
const chrome = spawn(findChrome(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-proxy-server',
  '--proxy-bypass-list=*',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  '--window-size=320,640',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk.toString(); });

const evidence = {
  targetHead: '2feafdcef98c7879de4cf4834e10dc7ef084fb1e',
  baselineRun: 60,
  baselineArtifactId: 10325633644,
  viewport: { width: 320, height: 640 },
  safeAreaInsets: { top: 24, left: 12, right: 12, bottom: 34 },
  checks: {},
  pass: false,
};
let cdp;
try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((entry) => entry.type === 'page') ?? targets[0];
  assert(target?.webSocketDebuggerUrl, 'Chrome DevTools page target is unavailable');
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  await cdp.call('Network.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, left: 12, right: 12, bottom: 34 } });

  await cdp.call('Page.navigate', { url: `${origin}/` });
  await cdp.waitFor("document.readyState === 'complete'");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Normalを開始'))", 20000);

  evidence.checks.home320SafeArea = await cdp.evaluate(`(() => {
    const shell = getComputedStyle(document.querySelector('.app-shell'));
    const nav = getComputedStyle(document.querySelector('.bottom-nav'));
    const header = document.querySelector('.app-header').getBoundingClientRect();
    const start = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Normalを開始')).getBoundingClientRect();
    return {
      innerWidth,
      innerHeight,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      shell: { top: parseFloat(shell.paddingTop), left: parseFloat(shell.paddingLeft), right: parseFloat(shell.paddingRight), bottom: parseFloat(shell.paddingBottom) },
      nav: { left: parseFloat(nav.paddingLeft), right: parseFloat(nav.paddingRight), bottom: parseFloat(nav.paddingBottom) },
      header: { x: header.x, y: header.y, width: header.width, height: header.height },
      start: { x: start.x, y: start.y, width: start.width, height: start.height },
    };
  })()`);
  const home = evidence.checks.home320SafeArea;
  assert(home.innerWidth === 320, `Expected 320px viewport, got ${home.innerWidth}`);
  assert(home.htmlScrollWidth <= 320 && home.bodyScrollWidth <= 320, 'Home has horizontal overflow at 320px');
  assert(home.viewportMeta?.includes('viewport-fit=cover'), 'viewport-fit=cover is missing');
  assert(home.shell.top >= 24 && home.shell.left >= 12 && home.shell.right >= 12, 'Main content does not respect top/side Safe Area');
  assert(home.nav.bottom >= 34 && home.nav.left >= 12 && home.nav.right >= 12, 'Bottom navigation does not respect Safe Area');
  assert(home.header.y >= 24 && home.start.x >= 12 && home.start.x + home.start.width <= 308, 'Major home controls are clipped by Safe Area');
  await cdp.screenshot('01-home-320-safe-area.png');

  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Normalを開始')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '開始')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '開始').click()");
  await cdp.waitFor("!!document.querySelector('.buzz-button')");
  await cdp.waitFor("document.querySelector('.question-text')?.textContent.length > 0");

  evidence.checks.reading320SafeArea = await cdp.evaluate(`(() => {
    const header = document.querySelector('.play-header').getBoundingClientRect();
    const question = document.querySelector('.question-text').getBoundingClientRect();
    const buzz = document.querySelector('.buzz-button').getBoundingClientRect();
    const dock = getComputedStyle(document.querySelector('.buzz-dock'));
    return {
      htmlScrollWidth: document.documentElement.scrollWidth,
      header: { x: header.x, y: header.y, width: header.width, height: header.height },
      question: { x: question.x, y: question.y, width: question.width, height: question.height },
      buzz: { x: buzz.x, y: buzz.y, width: buzz.width, height: buzz.height, bottom: buzz.bottom },
      dockBottom: parseFloat(dock.bottom),
    };
  })()`);
  const reading = evidence.checks.reading320SafeArea;
  assert(reading.htmlScrollWidth <= 320, 'Reading has horizontal overflow at 320px');
  assert(reading.header.y >= 24 && reading.header.x >= 12 && reading.header.x + reading.header.width <= 308, 'Play header is clipped by Safe Area');
  assert(reading.buzz.x >= 12 && reading.buzz.x + reading.buzz.width <= 308 && reading.buzz.bottom <= 606, 'BUZZ control is clipped by Safe Area');
  assert(reading.dockBottom >= 34, 'BUZZ dock does not respect bottom Safe Area');
  await cdp.screenshot('02-reading-buzz-320-safe-area.png');

  await cdp.evaluate("document.querySelector('.buzz-button').focus()");
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.waitFor("!!document.querySelector('#answer-input')");
  evidence.checks.buzzToAnswer = await cdp.evaluate("({ answering: !!document.querySelector('#answer-input'), buzzGone: !document.querySelector('.buzz-button'), result: !!document.querySelector('.result-card'), activeId: document.activeElement?.id, htmlScrollWidth: document.documentElement.scrollWidth })");
  assert(evidence.checks.buzzToAnswer.answering && evidence.checks.buzzToAnswer.buzzGone && !evidence.checks.buzzToAnswer.result, 'BUZZ→Answer transition failed or Enter carried through immediately');
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat: true });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  evidence.checks.enterCarryThroughHeld = await cdp.evaluate("({ answering: !!document.querySelector('#answer-input'), result: !!document.querySelector('.result-card') })");
  assert(evidence.checks.enterCarryThroughHeld.answering && !evidence.checks.enterCarryThroughHeld.result, 'Held BUZZ Enter carried through into Answer submit');
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.evaluate("document.querySelector('#answer-input').value = '不正解'; document.querySelector('#answer-input').dispatchEvent(new Event('input', { bubbles: true }));");
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.waitFor("!!document.querySelector('.result-card')");
  evidence.checks.result320 = await cdp.evaluate(`(() => {
    const card = document.querySelector('.result-card').getBoundingClientRect();
    const next = document.querySelector('.result-card .primary-button').getBoundingClientRect();
    return { htmlScrollWidth: document.documentElement.scrollWidth, card: { x: card.x, y: card.y, width: card.width, height: card.height }, next: { x: next.x, y: next.y, width: next.width, height: next.height } };
  })()`);
  assert(evidence.checks.result320.htmlScrollWidth <= 320 && evidence.checks.result320.next.width > 0, 'Result action is not usable at 320px');
  await cdp.screenshot('03-result-320.png');

  await cdp.evaluate("document.querySelector('.result-card .primary-button').click()");
  await cdp.waitFor("document.body.innerText.includes('Session complete')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('メニューへ戻る')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Normalを開始'))");
  evidence.checks.serviceWorkerBeforeOffline = await cdp.evaluate("navigator.serviceWorker.ready.then((registration) => ({ scope: registration.scope, controller: !!navigator.serviceWorker.controller, active: registration.active?.state, waiting: !!registration.waiting }))", true);
  if (!evidence.checks.serviceWorkerBeforeOffline.controller) {
    await cdp.call('Page.reload', { ignoreCache: false });
    await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Normalを開始'))", 20000);
  }
  evidence.checks.serviceWorkerControlled = await cdp.evaluate("({ controller: !!navigator.serviceWorker.controller })");
  assert(evidence.checks.serviceWorkerControlled.controller, 'Installed PWA is not Service Worker controlled');

  await cdp.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.call('Page.navigate', { url: 'about:blank' });
  await cdp.waitFor("location.href === 'about:blank'");
  await cdp.call('Page.navigate', { url: `${origin}/` });
  await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Normalを開始'))", 20000);
  evidence.checks.offlineColdStart = await cdp.evaluate("({ navigatorOnline: navigator.onLine, indicator: document.body.innerText.includes('オフライン — ローカルデータで利用中'), normalStart: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Normalを開始')), controller: !!navigator.serviceWorker.controller, htmlScrollWidth: document.documentElement.scrollWidth })");
  const offline = evidence.checks.offlineColdStart;
  assert(offline.navigatorOnline === false && offline.indicator && offline.normalStart && offline.controller, 'Offline cold-start shell failed');
  assert(offline.htmlScrollWidth <= 320, 'Offline cold-start has horizontal overflow');
  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Normalを開始')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '開始')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '開始').click()");
  await cdp.waitFor("!!document.querySelector('.buzz-button')", 15000);
  evidence.checks.offlineCoreQuiz = await cdp.evaluate("({ buzz: !!document.querySelector('.buzz-button'), question: !!document.querySelector('.question-text'), indicator: document.body.innerText.includes('オフライン — ローカルデータで利用中') })");
  assert(evidence.checks.offlineCoreQuiz.buzz && evidence.checks.offlineCoreQuiz.question && evidence.checks.offlineCoreQuiz.indicator, 'Core quiz cannot start from offline cold-start');
  await cdp.screenshot('04-offline-core-quiz.png');

  await cdp.call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.evaluate("window.__acceptanceSentinel = 'active-session-preserved'");
  await fetch(`${origin}/__acceptance__/sw-variant-on`, { method: 'POST' });
  await cdp.evaluate("navigator.serviceWorker.getRegistration().then((registration) => registration.update())", true);
  await cdp.waitFor("navigator.serviceWorker.getRegistration().then((registration) => !!registration?.waiting)", 20000);
  await cdp.waitFor("document.body.innerText.includes('セッション終了後に更新')", 20000);
  evidence.checks.waitingServiceWorker = await cdp.evaluate(`navigator.serviceWorker.getRegistration().then((registration) => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('セッション終了後に更新'));
    return { waiting: !!registration.waiting, banner: !!button, updateDisabled: !!button?.disabled, sentinel: window.__acceptanceSentinel, reading: !!document.querySelector('.buzz-button'), controller: !!navigator.serviceWorker.controller };
  })`, true);
  const waiting = evidence.checks.waitingServiceWorker;
  assert(waiting.waiting && waiting.banner && waiting.updateDisabled, 'Waiting Service Worker is not deferred during active Session');
  assert(waiting.sentinel === 'active-session-preserved' && waiting.reading, 'Waiting Service Worker force-reloaded or disrupted the active Session');
  await cdp.screenshot('05-waiting-sw-active-session.png');

  evidence.pass = true;
  await writeFile(join(outDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.pass = false;
  evidence.error = String(error);
  evidence.chromeStderr = chromeStderr.slice(-5000);
  try {
    evidence.failurePage = await cdp?.evaluate("({ url: location.href, title: document.title, body: document.body?.innerText?.slice(0, 1200) })");
    await cdp?.screenshot('FAIL.png');
  } catch {
    // best effort evidence
  }
  await writeFile(join(outDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  cdp?.close();
  chrome.kill('SIGTERM');
  server.close();
  await rm(profile, { recursive: true, force: true });
}
