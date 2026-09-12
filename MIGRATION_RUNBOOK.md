# Baseline Migration Runbook

## Purpose
Move QBT baseline verification from the blocked local environment to GitHub Actions.

## Freeze rule
No feature implementation is allowed until one GitHub Actions run passes all four gates in order:

1. `npm install`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

If a gate fails, fix only the first failing gate before re-running. Do not widen the scope to later failures.

## Success criteria
A baseline run is GREEN only when all four commands exit with status 0 in the same workflow run and the build produces:

- `dist/index.html`
- `dist/manifest.webmanifest`
- `dist/sw.js`
- at least one `dist/workbox-*.js`

Anything else is NOT PASSED.

## Evidence
Every workflow run must retain logs/results as GitHub Actions artifacts using `if: always()`.

## Implementation status
Until GREEN, ENGINE / DATA / UI / ANALYTICS / PWA / MODES / BACKUP-RESTORE are all **UNVERIFIED IMPLEMENTATION**. Only the baseline scaffold itself is being validated.
