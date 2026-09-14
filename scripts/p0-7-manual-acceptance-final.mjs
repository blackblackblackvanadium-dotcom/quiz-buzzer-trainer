import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const distDir = resolve(process.argv[2] ?? 'dist');
const outDir = resolve(process.argv[3] ?? 'p0-7-evidence');
await mkdir(outDir, { recursive: true });

const originalSw = await readFile(join(distDir, 'sw.js'), 'utf8');
let swVariant = false;
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
    if (url.pathname === '/__acceptance__/sw-variant-on') {
      swVariant = true;
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === '/sw.js') {
      const body = swVariant ? `${originalSw}\n// p0-7-waiting-worker-variant\n` : originalSw;
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(body);
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
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

async function listen(port = 0) {
  await new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => rejectPromise(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolvePromise();
    });
  });
}

async function closeServer() {
  if (!server.listening) return;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
}

await listen();
const address = server.address();
assert(address && typeof address === 'object', 'Acceptance server did not start');
const port = address.port;
const origin = `http://127.0.0.1:${port}`;

function findChrome() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('Chrome/Chromium is required');
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Retry until DevTools endpoint is ready.
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

  async waitFor(expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression, expression.includes('.then('));
        if (last) return last;
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for condition: ${expression}; last=${String(last)}`);
  }

  async screenshot(name) {
    const shot = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(outDir, name), Buffer.from(shot.data, 'base64'));
  }

  close() {
    this.socket.close();
  }
}

const debugPort = 9333;
const profile = join(tmpdir(), `qbt-p0-7-final-${process.pid}`);
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
  targetBaselineRun: 60,
  targetBaselineRunId: 34784140753,
  targetArtifactId: 10325633644,
  viewport: { width: 320, height: 640 },
  safeAreaInsets: { top: 24, left: 12, right: 12, bottom: 34 },
  checks: {},
  pass: false,
};

let cdp;
try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((entry) => entry.type === 'page') ?? targets[0];
  assert(target?.webSocketDebuggerUrl, 'No Chrome page target');
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  await cdp.call('Network.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, left: 12, right: 12, bottom: 34 } });

  // Home: 320px portrait + Safe Area.
  await cdp.call('Page.navigate', { url: `${origin}/` });
  await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  evidence.checks.home = await cdp.evaluate(`(() => {
    const shell = getComputedStyle(document.querySelector('.app-shell'));
    const nav = getComputedStyle(document.querySelector('.bottom-nav'));
    const header = document.querySelector('.app-header').getBoundingClientRect();
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Normalを開始')).getBoundingClientRect();
    return {
      innerWidth, innerHeight,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      shellPadding: { top: parseFloat(shell.paddingTop), left: parseFloat(shell.paddingLeft), right: parseFloat(shell.paddingRight), bottom: parseFloat(shell.paddingBottom) },
      navPadding: { left: parseFloat(nav.paddingLeft), right: parseFloat(nav.paddingRight), bottom: parseFloat(nav.paddingBottom) },
      header: { x: header.x, y: header.y, width: header.width, height: header.height },
      start: { x: start.x, y: start.y, width: start.width, height: start.height },
    };
  })()`);
  const home = evidence.checks.home;
  assert(home.innerWidth === 320 && home.htmlScrollWidth <= 320 && home.bodyScrollWidth <= 320, '320px Home has horizontal overflow');
  assert(home.viewportMeta?.includes('viewport-fit=cover'), 'viewport-fit=cover missing');
  assert(home.shellPadding.top >= 24 && home.shellPadding.left >= 12 && home.shellPadding.right >= 12, 'Home content misses Safe Area');
  assert(home.navPadding.left >= 12 && home.navPadding.right >= 12 && home.navPadding.bottom >= 34, 'Bottom nav misses Safe Area');
  assert(home.header.y >= 24 && home.start.x >= 12 && home.start.x + home.start.width <= 308, 'Home controls are clipped');
  await cdp.screenshot('01-home.png');

  // Reading + BUZZ safe-area geometry.
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Normalを開始')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '開始')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '開始').click()");
  await cdp.waitFor("!!document.querySelector('.buzz-button')");
  await cdp.waitFor("document.querySelector('.question-text')?.textContent.length > 0");
  evidence.checks.reading = await cdp.evaluate(`(() => {
    const header = document.querySelector('.play-header').getBoundingClientRect();
    const buzz = document.querySelector('.buzz-button').getBoundingClientRect();
    const dock = getComputedStyle(document.querySelector('.buzz-dock'));
    return {
      htmlScrollWidth: document.documentElement.scrollWidth,
      header: { x: header.x, y: header.y, width: header.width, height: header.height },
      buzz: { x: buzz.x, y: buzz.y, width: buzz.width, height: buzz.height, bottom: buzz.bottom },
      dockBottom: parseFloat(dock.bottom),
    };
  })()`);
  const reading = evidence.checks.reading;
  assert(reading.htmlScrollWidth <= 320, 'Reading has horizontal overflow');
  assert(reading.header.x >= 12 && reading.header.y >= 24 && reading.header.x + reading.header.width <= 308, 'Play header clipped by Safe Area');
  assert(reading.buzz.x >= 12 && reading.buzz.x + reading.buzz.width <= 308 && reading.buzz.bottom <= 606 && reading.dockBottom >= 34, 'BUZZ dock clipped by Safe Area');
  await cdp.screenshot('02-reading.png');

  // BUZZ Enter -> Answer, then held/repeat Enter must not carry through.
  await cdp.evaluate("document.querySelector('.buzz-button').focus()");
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.waitFor("!!document.querySelector('#answer-input')");
  evidence.checks.buzzToAnswer = await cdp.evaluate("({ answering: !!document.querySelector('#answer-input'), buzzGone: !document.querySelector('.buzz-button'), result: !!document.querySelector('.result-card'), activeId: document.activeElement?.id, htmlScrollWidth: document.documentElement.scrollWidth })");
  assert(evidence.checks.buzzToAnswer.answering && evidence.checks.buzzToAnswer.buzzGone && !evidence.checks.buzzToAnswer.result, 'BUZZ->Answer transition or carry-through failed');
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat: true });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  evidence.checks.heldEnter = await cdp.evaluate("({ answering: !!document.querySelector('#answer-input'), result: !!document.querySelector('.result-card') })");
  assert(evidence.checks.heldEnter.answering && !evidence.checks.heldEnter.result, 'Held BUZZ Enter carried into submit');
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

  // Continue deterministically to verify Result usability at 320px.
  await cdp.evaluate("document.querySelector('.answer-panel').requestSubmit()");
  await cdp.waitFor("!!document.querySelector('.result-card')");
  evidence.checks.result = await cdp.evaluate(`(() => {
    const card = document.querySelector('.result-card').getBoundingClientRect();
    const next = document.querySelector('.result-card .primary-button').getBoundingClientRect();
    return { htmlScrollWidth: document.documentElement.scrollWidth, card: { x: card.x, y: card.y, width: card.width, height: card.height }, next: { x: next.x, y: next.y, width: next.width, height: next.height } };
  })()`);
  assert(evidence.checks.result.htmlScrollWidth <= 320 && evidence.checks.result.next.width > 0, 'Result action not usable at 320px');
  await cdp.screenshot('03-result.png');

  // End multi-question session manually, then ensure SW controller exists.
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '終了').click()");
  await cdp.waitFor("document.body.innerText.includes('Session ended')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('メニューへ戻る')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  evidence.checks.swReadyBeforeReload = await cdp.evaluate("navigator.serviceWorker.ready.then((r) => ({ active: r.active?.state, controller: !!navigator.serviceWorker.controller }))", true);
  if (!evidence.checks.swReadyBeforeReload.controller) {
    await cdp.call('Page.reload', { ignoreCache: false });
    await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  }
  evidence.checks.swControlled = await cdp.evaluate("({ controller: !!navigator.serviceWorker.controller })");
  assert(evidence.checks.swControlled.controller, 'PWA not controlled by Service Worker');

  // True origin-unavailable cold start: stop HTTP origin, navigate away, then back through SW cache.
  await closeServer();
  evidence.checks.offlineTransport = { originServerClosed: true };
  await cdp.call('Page.navigate', { url: 'about:blank' });
  await cdp.waitFor("location.href === 'about:blank'");
  await cdp.call('Page.navigate', { url: `${origin}/` });
  await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))", 20000);
  evidence.checks.offlineColdStart = await cdp.evaluate("({ normalStart: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始')), controller: !!navigator.serviceWorker.controller, htmlScrollWidth: document.documentElement.scrollWidth })");
  assert(evidence.checks.offlineColdStart.normalStart && evidence.checks.offlineColdStart.controller && evidence.checks.offlineColdStart.htmlScrollWidth <= 320, 'Origin-down offline cold start failed');

  // Browser offline signal drives the UI indicator. GH-hosted headless Chrome remains NIC-online even when origin is unavailable, so dispatch the browser offline event explicitly.
  await cdp.evaluate("window.dispatchEvent(new Event('offline'))");
  await cdp.waitFor("document.body.innerText.includes('オフライン — ローカルデータで利用中')");
  evidence.checks.offlineIndicator = await cdp.evaluate("({ visible: document.body.innerText.includes('オフライン — ローカルデータで利用中') })");
  assert(evidence.checks.offlineIndicator.visible, 'Offline indicator did not appear');

  // Start a core quiz while origin remains stopped.
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Normalを開始')).click()");
  await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '開始')");
  await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '開始').click()");
  await cdp.waitFor("!!document.querySelector('.buzz-button')");
  evidence.checks.offlineCoreQuiz = await cdp.evaluate("({ buzz: !!document.querySelector('.buzz-button'), question: !!document.querySelector('.question-text'), indicator: document.body.innerText.includes('オフライン — ローカルデータで利用中') })");
  assert(evidence.checks.offlineCoreQuiz.buzz && evidence.checks.offlineCoreQuiz.question && evidence.checks.offlineCoreQuiz.indicator, 'Core quiz cannot run with origin stopped');
  await cdp.screenshot('04-offline-core-quiz.png');

  // Restore origin, keep active Session, force a distinct SW script, verify waiting worker does not force reload.
  await listen(port);
  await cdp.evaluate("window.dispatchEvent(new Event('online')); window.__acceptanceSentinel = 'active-session-preserved'");
  await fetch(`${origin}/__acceptance__/sw-variant-on`, { method: 'POST' });
  await cdp.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())", true);
  await cdp.waitFor("navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting)", 20000);
  await cdp.waitFor("document.body.innerText.includes('セッション終了後に更新')", 20000);
  evidence.checks.waitingServiceWorker = await cdp.evaluate(`navigator.serviceWorker.getRegistration().then((r) => {
    const updateButton = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('セッション終了後に更新'));
    return {
      waiting: !!r.waiting,
      updateBanner: !!updateButton,
      updateDisabled: !!updateButton?.disabled,
      sentinel: window.__acceptanceSentinel,
      reading: !!document.querySelector('.buzz-button'),
      controller: !!navigator.serviceWorker.controller,
    };
  })`, true);
  const waiting = evidence.checks.waitingServiceWorker;
  assert(waiting.waiting && waiting.updateBanner && waiting.updateDisabled, 'Waiting SW is not deferred during active Session');
  assert(waiting.sentinel === 'active-session-preserved' && waiting.reading && waiting.controller, 'Waiting SW force-reloaded or disrupted active Session');
  await cdp.screenshot('05-waiting-worker-active-session.png');

  evidence.pass = true;
  await writeFile(join(outDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.error = String(error);
  evidence.chromeStderr = chromeStderr.slice(-5000);
  try {
    evidence.failurePage = await cdp?.evaluate("({ url: location.href, body: document.body?.innerText?.slice(0, 1200) })");
    await cdp?.screenshot('FAIL.png');
  } catch {
    // Best-effort failure evidence.
  }
  await writeFile(join(outDir, 'acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  cdp?.close();
  chrome.kill('SIGTERM');
  await closeServer().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}
