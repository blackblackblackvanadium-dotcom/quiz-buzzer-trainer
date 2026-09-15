import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const distDir = resolve(process.argv[2] ?? 'dist');
const outDir = resolve(process.argv[3] ?? 'visual-review-evidence');
const targetSha = process.argv[4] ?? 'UNKNOWN';
await mkdir(outDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
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

await new Promise((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise);
  server.listen(0, '127.0.0.1', () => resolvePromise());
});
const address = server.address();
assert(address && typeof address === 'object', 'Visual review server did not start');
const origin = `http://127.0.0.1:${address.port}`;

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
      // Retry until Chrome DevTools is ready.
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

  async screenshot(path) {
    const shot = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(outDir, path), Buffer.from(shot.data, 'base64'));
  }

  close() {
    this.socket.close();
  }
}

const viewports = [
  {
    id: '1440x900', width: 1440, height: 900, mobile: false,
    safeArea: { top: 0, left: 0, right: 0, bottom: 0 },
    screenshot: '1440x900/active-reading.png',
  },
  {
    id: '390x844', width: 390, height: 844, mobile: true,
    safeArea: { top: 47, left: 12, right: 12, bottom: 34 },
    screenshot: '390x844/active-reading.png',
  },
  {
    id: '320x640', width: 320, height: 640, mobile: true,
    safeArea: { top: 24, left: 12, right: 12, bottom: 34 },
    screenshot: '320x640/active-reading.png',
  },
];

for (const viewport of viewports) {
  await mkdir(join(outDir, viewport.id), { recursive: true });
}

const debugPort = 9444;
const profile = join(tmpdir(), `qbt-visual-review-${process.pid}`);
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
  '--window-size=1440,900',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk.toString(); });

const evidence = {
  targetCommitSha: targetSha,
  buildInput: 'production npm ci + npm run build',
  browser: 'GitHub-hosted Chrome/Chromium via Chrome DevTools Protocol',
  criteria: {
    wideActivePlayNavigationHidden: 'At 1440×900 active Reading, app header/bottom navigation/sidebar absent.',
    mobileSafeArea: 'At 390×844 and 320×640 with emulated safe-area insets, play header and BUZZ remain within safe area.',
    buzzOperable: 'BUZZ is visible, enabled, hit-testable, and entirely inside viewport.',
    horizontalOverflow: 'documentElement/body scrollWidth do not exceed viewport width.',
    questionNotObscured: 'Question text bounding box does not overlap BUZZ button.',
  },
  viewports: {},
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

  for (const viewport of viewports) {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await cdp.call('Emulation.setSafeAreaInsetsOverride', { insets: viewport.safeArea });

    await cdp.call('Page.navigate', { url: `${origin}/` });
    await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
    await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Normalを開始')).click()");
    await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '開始')");
    await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '開始').click()");
    await cdp.waitFor("!!document.querySelector('.buzz-button')");
    await cdp.waitFor("document.querySelector('.question-text')?.textContent.length >= 10");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));

    const metrics = await cdp.evaluate(`(() => {
      const buzzEl = document.querySelector('.buzz-button');
      const headerEl = document.querySelector('.play-header');
      const textEl = document.querySelector('.question-text');
      const shellEl = document.querySelector('.app-shell');
      const buzz = buzzEl.getBoundingClientRect();
      const header = headerEl.getBoundingClientRect();
      const question = textEl.getBoundingClientRect();
      const shell = getComputedStyle(shellEl);
      const centerX = buzz.left + buzz.width / 2;
      const centerY = buzz.top + buzz.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      const buzzStyle = getComputedStyle(buzzEl);
      return {
        innerWidth,
        innerHeight,
        htmlScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        appHeaderPresent: !!document.querySelector('.app-header'),
        bottomNavPresent: !!document.querySelector('.bottom-nav'),
        sidebarPresent: !!document.querySelector('.sidebar, [class*="sidebar"], [class*="side-nav"], [class*="sidenav"]'),
        questionText: textEl.textContent,
        shellPadding: {
          top: parseFloat(shell.paddingTop),
          left: parseFloat(shell.paddingLeft),
          right: parseFloat(shell.paddingRight),
          bottom: parseFloat(shell.paddingBottom),
        },
        header: { x: header.x, y: header.y, left: header.left, right: header.right, top: header.top, bottom: header.bottom, width: header.width, height: header.height },
        question: { x: question.x, y: question.y, left: question.left, right: question.right, top: question.top, bottom: question.bottom, width: question.width, height: question.height },
        buzz: { x: buzz.x, y: buzz.y, left: buzz.left, right: buzz.right, top: buzz.top, bottom: buzz.bottom, width: buzz.width, height: buzz.height },
        buzzVisible: buzz.width > 0 && buzz.height > 0 && buzzStyle.visibility !== 'hidden' && buzzStyle.display !== 'none' && Number(buzzStyle.opacity) > 0,
        buzzEnabled: !buzzEl.disabled,
        buzzPointerEvents: buzzStyle.pointerEvents,
        buzzHitTest: hit === buzzEl || buzzEl.contains(hit),
      };
    })()`);

    const safe = viewport.safeArea;
    const checks = {
      activeReading: Boolean(metrics.questionText) && metrics.buzzVisible,
      noHorizontalOverflow: metrics.htmlScrollWidth <= viewport.width && metrics.bodyScrollWidth <= viewport.width,
      buzzOperable:
        metrics.buzzVisible && metrics.buzzEnabled && metrics.buzzPointerEvents !== 'none' && metrics.buzzHitTest &&
        metrics.buzz.left >= 0 && metrics.buzz.right <= viewport.width && metrics.buzz.top >= 0 && metrics.buzz.bottom <= viewport.height,
      questionNotObscured: metrics.question.bottom <= metrics.buzz.top,
      safeArea: true,
      wideNavigationHidden: true,
    };

    if (viewport.mobile) {
      checks.safeArea =
        metrics.shellPadding.top >= safe.top &&
        metrics.shellPadding.left >= safe.left &&
        metrics.shellPadding.right >= safe.right &&
        metrics.header.top >= safe.top &&
        metrics.header.left >= safe.left &&
        metrics.header.right <= viewport.width - safe.right &&
        metrics.buzz.left >= safe.left &&
        metrics.buzz.right <= viewport.width - safe.right &&
        metrics.buzz.bottom <= viewport.height - safe.bottom;
    }

    if (!viewport.mobile) {
      checks.wideNavigationHidden = !metrics.appHeaderPresent && !metrics.bottomNavPresent && !metrics.sidebarPresent;
    }

    const pass = Object.values(checks).every(Boolean);
    evidence.viewports[viewport.id] = {
      viewport: { width: viewport.width, height: viewport.height },
      safeAreaInsets: safe,
      screenshotPath: viewport.screenshot,
      checks,
      metrics,
      result: pass ? 'PASS' : 'FAIL',
    };

    await cdp.screenshot(viewport.screenshot);

    if (!pass) {
      throw new Error(`${viewport.id} visual acceptance failed: ${JSON.stringify(checks)}`);
    }

    await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '終了').click()");
    await cdp.waitFor("document.body.innerText.includes('Session ended')");
    await cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('メニューへ戻る')).click()");
    await cdp.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  }

  evidence.pass = true;
  await writeFile(join(outDir, 'visual-review.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.error = String(error);
  evidence.chromeStderr = chromeStderr.slice(-5000);
  try {
    evidence.failurePage = await cdp?.evaluate("({ url: location.href, body: document.body?.innerText?.slice(0, 1600) })");
    await cdp?.screenshot('FAIL.png');
  } catch {
    // Best effort only.
  }
  await writeFile(join(outDir, 'visual-review.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  cdp?.close();
  chrome.kill('SIGTERM');
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
