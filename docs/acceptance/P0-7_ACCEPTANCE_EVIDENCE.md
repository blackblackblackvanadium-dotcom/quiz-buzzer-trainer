# QBT-10 APP — P0 #7 Acceptance Evidence

## Scope

This document records browser-executed acceptance evidence for P0 #7 only.

- Production source under test: `main` @ `2feafdcef98c7879de4cf4834e10dc7ef084fb1e`
- Exact built PWA under test: Baseline #60 / run `34784140753` / artifact `10325633644`
- Browser acceptance run: `P0-7 Manual Acceptance Evidence` #19 / run `34811751784`
- Browser acceptance evidence artifact: `p0-7-close-evidence-34811751784` / artifact `10335225345`
- Evidence artifact digest: `sha256:2c94d41bd47df5bc5f3c5360efcdf53339c1ea03a3a07376fc0aa7133fbd5cea`
- Browser execution: GitHub-hosted Chrome/Chromium via Chrome DevTools Protocol
- Viewport used for portrait acceptance: `320×640`
- Production behavior/spec changes made for this evidence: **none**
- P0 #8: **not started**
- 1000-question Dataset: **frozen / untouched**

The acceptance harness lived outside the production source under test. The production PWA evaluated in the browser was the exact Baseline #60 `dist` artifact for commit `2feafdcef98c7879de4cf4834e10dc7ef084fb1e`.

## Acceptance results

| Case | Environment | Operation | Expected | Actual | Result |
|---|---|---|---|---|---|
| ① 320px portrait | GitHub-hosted Chrome/Chromium, exact Baseline #60 PWA, viewport `320×640` portrait | Home → Normal → Reading → BUZZ → Answer → Result; measure document scroll width and interactive element rectangles | No horizontal scroll. Navigation, BUZZ Dock, Answer UI, and Result actions remain visible and operable | Home / Reading / Answer / Result all reported `scrollWidth=320`. Start button `296×54`. BUZZ button `296×96` at `x=12`. Result action `262×54` | **PASS** |
| ② Safe Area | Same browser and viewport with emulated Safe Area insets top `24`, left `12`, right `12`, bottom `34` px | Measure shell, navigation, Reading UI, and BUZZ Dock positions under Safe Area override | Top / left / right / bottom interactive elements do not intrude into the Safe Area | Shell padding top/left/right=`24/12/12`. Navigation left/right/bottom=`12/12/34`. BUZZ Dock bottom=`34`; BUZZ spans `x=12..308` | **PASS** |
| ③ IME composition Enter | `320×640` Chrome; native `CompositionEvent` and `KeyboardEvent` dispatched in the browser document | In Study Answer: `compositionstart` → Enter / submit attempt → verify ignored; `compositionend` → fresh Enter → submit | Enter during composition does nothing. After composition ends, exactly one answer submit is accepted | Persisted Attempt count before/during/after=`0/0/1`. During composition `answering=true`, `result=false`. After composition end Result became visible once | **PASS** |
| ④ BUZZ → Answer Enter carry-through | Chrome CDP physical keyDown + autoRepeat + keyUp | Trigger BUZZ with Enter and continue the same held/repeating Enter after transition to Answer | The Enter used to BUZZ must not carry through and submit the Answer | Immediately after BUZZ: `answering=true`, `buzzGone=true`, `result=false`. After held/repeat Enter: `answering=true`, `result=false` | **PASS** |
| ⑤ Offline cold-start after one online start | Service-worker-controlled exact Baseline #60 PWA | Start online once → establish SW control → physically stop the HTTP origin server → navigate away → cold-navigate back to PWA → start Normal quiz | With the origin unavailable, the installed/cached PWA cold-starts and core quiz remains usable | `originServerClosed=true`. Cold start: `normalStart=true`, `controller=true`, `scrollWidth=320`. Core quiz: `buzz=true`, `question=true`. Offline indicator visible | **PASS** |
| ⑥ Service Worker waiting/update during active play | Active Normal Reading Session plus a distinct `sw.js` update | During Reading, publish a different SW script and call `registration.update()` to create a real waiting worker | Active play is not force-reloaded; update is deferred until the Session is safe to leave | `waiting=true`. Update banner present. Update action disabled during play. Sentinel remained `active-session-preserved`; `reading=true`; active controller retained | **PASS** |
| ⑦ DB open failure explicit error + retry | Fresh Chrome page with `IDBFactory.open` fault-injected during app bootstrap | Navigate into the DB-open failure state and inspect the rendered recovery UI | Explicit DB-open error is shown, an enabled Retry action is present, and the app does not remain indefinitely in Initializing | Alert displayed `ローカルデータベースを開けません … 再試行`; `retry=true`; `initializing=false` | **PASS** |
| ⑧ Old Session invalidation after Restore in another tab | Two real Chrome pages in one browser profile sharing IndexedDB / localStorage / BroadcastChannel | Tab A starts an active Normal Session. Tab B performs the real More-page Replace Restore flow using a valid backup File | Successful Restore invalidates the stale Session in Tab A. Tab A cannot continue old play and must reload | Before Restore `buzz=true`. After Restore commit, Tab A displayed `ローカルデータが更新されました … 古いSessionは続行できません`; `buzz=false`; reload action present; DB generation advanced/shared across tabs | **PASS** |

## Execution status

All eight requested acceptance cases were executed in a real browser-equivalent execution environment. There are **no NOT EXECUTED cases** in this acceptance set.

Overall result: **PASS — 8/8**.

Release-blocking P0 #7 acceptance residual: **none found**.

## Machine/browser evidence

The browser acceptance artifact for run `34811751784` contains the machine-readable results and screenshots used for the table above:

- `p0-7-primary/acceptance.json`
- `p0-7-supplement/supplement.json`
- `01-home.png`
- `02-reading.png`
- `03-result.png`
- `04-offline-core-quiz.png`
- `05-waiting-worker-active-session.png`
- `06-ime-after-single-submit.png`
- `07-db-open-failure.png`
- `08-cross-tab-restore-stale-session-blocked.png`
- `09-restore-completed-other-tab.png`

## Baseline for the production source under test

Baseline #60 / run `34784140753` completed successfully for `2feafdcef98c7879de4cf4834e10dc7ef084fb1e` with all four gates green:

1. `npm install` — PASS
2. `typecheck` — PASS
3. `unit test` — PASS
4. `production build` — PASS

A new Baseline run for the documentation-only evidence commit must also be green before P0 #7 is presented to CORE for CLOSE.
