import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const distDir = resolve(process.argv[2] ?? 'dist');
const outDir = resolve(process.argv[3] ?? 'p0-7-supplement');
await mkdir(outDir, { recursive: true });

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

const debugPort = 9444;
const profile = join(tmpdir(), `qbt-p0-7-supplement-${process.pid}`);
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

async function createPage(url = 'about:blank') {
  const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  await cdp.call('Network.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  return cdp;
}

async function idbCount(cdp, storeName) {
  return cdp.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('qbt-phase1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(${JSON.stringify(storeName)}, 'readonly');
      const count = tx.objectStore(${JSON.stringify(storeName)}).count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => { const value = count.result; db.close(); resolve(value); };
    };
  })`, true);
}

const evidence = {
  targetHead: '2feafdcef98c7879de4cf4834e10dc7ef084fb1e',
  targetBaselineRun: 60,
  targetBaselineRunId: 34784140753,
  targetArtifactId: 10325633644,
  environment: {
    browser: 'GitHub-hosted Chrome/Chromium headless via CDP',
    viewport: '320x640 portrait',
    origin: 'ephemeral localhost serving exact Baseline #60 dist',
  },
  checks: {},
  pass: false,
};

const pages = [];
try {
  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);

  // ③ IME composition Enter: ignored during composition; exactly one submit after composition end.
  const ime = await createPage();
  pages.push(ime);
  await ime.call('Page.navigate', { url: `${origin}/` });
  await ime.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Study')");
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Study').click()");
  await ime.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Studyを開始'))");
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Studyを開始')).click()");
  await ime.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '開始')");
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '開始').click()");
  await ime.waitFor("!!document.querySelector('#answer-input')");

  const attemptsBefore = await idbCount(ime, 'attempts');
  await ime.evaluate(`(() => {
    const input = document.querySelector('#answer-input');
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'あ' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', isComposing: true }));
    document.querySelector('.answer-panel').requestSubmit();
  })()`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  const attemptsDuring = await idbCount(ime, 'attempts');
  const duringState = await ime.evaluate("({ answering: !!document.querySelector('#answer-input'), result: !!document.querySelector('.result-card') })");
  assert(attemptsDuring === attemptsBefore && duringState.answering && !duringState.result, 'IME composing Enter submitted unexpectedly');

  await ime.evaluate(`(() => {
    const input = document.querySelector('#answer-input');
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'あ' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', isComposing: false }));
    document.querySelector('.answer-panel').requestSubmit();
  })()`);
  await ime.waitFor("!!document.querySelector('.result-card')");
  const attemptsAfter = await idbCount(ime, 'attempts');
  evidence.checks.imeComposition = {
    environment: '320x640 Chrome; native CompositionEvent + KeyboardEvent in browser document',
    operation: 'compositionstart -> Enter + requestSubmit -> verify ignored; compositionend -> new Enter + one requestSubmit',
    expected: 'No submit during composition; exactly one persisted Attempt and Result after composition end',
    actual: { attemptsBefore, attemptsDuring, attemptsAfter, duringState, resultVisible: true },
    pass: attemptsDuring === attemptsBefore && attemptsAfter === attemptsBefore + 1,
  };
  assert(evidence.checks.imeComposition.pass, 'IME composition acceptance failed');
  await ime.screenshot('06-ime-after-single-submit.png');

  // Return primary page to menu for multi-tab scenario.
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '終了').click()");
  await ime.waitFor("document.body.innerText.includes('Session ended')");
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('メニューへ戻る')).click()");
  await ime.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");

  // ⑦ DB open failure: explicit error + retry recovery.
  const dbFailure = await createPage();
  pages.push(dbFailure);
  await dbFailure.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const original = IDBFactory.prototype.open;
      let failOnce = true;
      IDBFactory.prototype.open = function(...args) {
        if (failOnce) {
          failOnce = false;
          throw new DOMException('forced acceptance DB open failure', 'InvalidStateError');
        }
        return original.apply(this, args);
      };
    })();`,
  });
  await dbFailure.call('Page.navigate', { url: `${origin}/?acceptance=db-open-failure` });
  await dbFailure.waitFor("document.body.innerText.includes('ローカルデータベースを開けません')");
  const failureUi = await dbFailure.evaluate(`({
    alert: document.querySelector('[role="alert"]')?.innerText ?? '',
    retry: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '再試行'),
    initializing: document.body.innerText.includes('Initializing local database')
  })()`);
  assert(failureUi.alert.includes('ローカルデータベースを開けません') && failureUi.retry && !failureUi.initializing, 'DB open failure UI missing');
  await dbFailure.screenshot('07-db-open-failure.png');
  await dbFailure.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '再試行').click()");
  await dbFailure.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  const retryRecovered = await dbFailure.evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))");
  evidence.checks.dbOpenFailure = {
    environment: 'Fresh Chrome page with IDBFactory.open forced to fail exactly once before app bootstrap',
    operation: 'Navigate -> observe fatal DB error -> click Retry',
    expected: 'Explicit error + Retry; no infinite Initializing state; retry restores usable app',
    actual: { failureUi, retryRecovered },
    pass: Boolean(retryRecovered),
  };
  assert(evidence.checks.dbOpenFailure.pass, 'DB open failure retry acceptance failed');

  // ⑧ Actual second-tab Replace Restore: old active Session must be stopped.
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Normalを開始')).click()");
  await ime.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '開始')");
  await ime.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '開始').click()");
  await ime.waitFor("!!document.querySelector('.buzz-button')");
  const activeBeforeRestore = await ime.evaluate("({ buzz: !!document.querySelector('.buzz-button'), body: document.body.innerText.slice(0, 400) })");
  assert(activeBeforeRestore.buzz, 'Primary tab did not enter active Session before Restore');

  const restoreTab = await createPage(`${origin}/`);
  pages.push(restoreTab);
  await restoreTab.waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'More')");
  await restoreTab.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'More').click()");
  await restoreTab.waitFor("!!document.querySelector('input[type=file]')");

  await restoreTab.evaluate(`(async () => {
    function readStore(db, storeName) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qbt-phase1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const [questionRecords, attempts, studyStates, sessions, settings] = await Promise.all([
      readStore(db, 'questions'), readStore(db, 'attempts'), readStore(db, 'studyStates'), readStore(db, 'sessions'), readStore(db, 'settings'),
    ]);
    db.close();
    const questions = questionRecords.map(({ key, ...question }) => question);
    const backup = {
      format: 'qbt-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      dbSchemaVersion: 4,
      questionDataVersion: 'seed-v1',
      data: { questions, attempts, studyStates, sessions, settings },
    };
    const file = new File([JSON.stringify(backup)], 'acceptance-restore.json', { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('input[type=file]');
    input.files = transfer.files;
    window.confirm = () => true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await restoreTab.waitFor("document.body.innerText.includes('復元が完了しました。再読み込みしてください。')", 20000);
  await ime.waitFor("document.body.innerText.includes('ローカルデータが更新されました')", 20000);
  const primaryAfterRestore = await ime.evaluate(`({
    alert: document.querySelector('[role="alert"]')?.innerText ?? '',
    buzz: !!document.querySelector('.buzz-button'),
    reload: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '再読み込み')
  })()`);
  const restoreCompleted = await restoreTab.evaluate("document.body.innerText.includes('復元が完了しました。再読み込みしてください。')");
  evidence.checks.crossTabRestore = {
    environment: 'Two real Chrome pages in one browser profile sharing IndexedDB/localStorage/BroadcastChannel',
    operation: 'Tab A starts active Normal Session; Tab B performs actual UI Replace Restore using a valid backup File',
    expected: 'Tab A immediately stops old Session and requires reload; stale BUZZ/play cannot continue',
    actual: { activeBeforeRestore, restoreCompleted, primaryAfterRestore },
    pass: restoreCompleted && primaryAfterRestore.alert.includes('ローカルデータが更新されました') && !primaryAfterRestore.buzz && primaryAfterRestore.reload,
  };
  assert(evidence.checks.crossTabRestore.pass, 'Cross-tab Restore stale Session acceptance failed');
  await ime.screenshot('08-cross-tab-restore-stale-session-blocked.png');
  await restoreTab.screenshot('09-restore-completed-other-tab.png');

  evidence.pass = Object.values(evidence.checks).every((check) => check.pass === true);
  await writeFile(join(outDir, 'supplement.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.error = String(error);
  evidence.chromeStderr = chromeStderr.slice(-5000);
  await writeFile(join(outDir, 'supplement.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  for (const page of pages) page.close();
  chrome.kill('SIGTERM');
  server.close();
  // GitHub-hosted runner is ephemeral; intentionally do not remove Chrome profile synchronously.
}
