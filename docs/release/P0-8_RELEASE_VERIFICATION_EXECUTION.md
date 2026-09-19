# P0 #8 Release Verification Execution

- Production Source of Truth: `6e2d74aaabcc8a0041934378d4b81f3c682879b8`
- Scope: verification/evidence only; production `src/**` changes are forbidden.
- Install oracle: committed `package-lock.json` + `npm ci`.
- Stop rule: any P0 FAIL/ERROR/SKIP, flaky/known failure, or Blocker/Critical stops verification and returns to CORE.
- Required final counters: P0 failed=0, error=0, skipped=0, flaky=0, knownFailure=0, blocked=0; Blocker/Critical=0.
- Prescribed execution order: AC-01, AC-20, AC-19, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-15, AC-03, AC-04, AC-05, AC-06, AC-16, AC-17, AC-13, AC-14, AC-18, AC-02, then completeness/evidence audit.
- This branch must not be merged wholesale into production. Only approved release evidence/harness changes may be retained as directed by CORE.
