from pathlib import Path

path = Path('scripts/p0-7-acceptance-supplement.mjs')
text = path.read_text()

old = "  const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`);"
new = "  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });\n  if (!response.ok) throw new Error(`Chrome target creation failed: ${response.status}`);\n  const target = await response.json();"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('Chrome target creation marker missing')

menu_old = "  await ime.evaluate(\"[...document.querySelectorAll('button')].find((b) => b.textContent.includes('メニューへ戻る')).click()\");\n  await ime.waitFor(\"[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))\");"
menu_new = "  await ime.evaluate(\"[...document.querySelectorAll('button')].find((b) => b.textContent.includes('メニューへ戻る')).click()\");\n  await ime.waitFor(\"[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Play')\");\n  await ime.evaluate(\"[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Play').click()\");\n  await ime.waitFor(\"[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Normalを開始'))\");"
if menu_old not in text:
    raise SystemExit('Study-to-Play navigation marker missing')
text = text.replace(menu_old, menu_new, 1)

failure_expr_old = "    initializing: document.body.innerText.includes('Initializing local database')\n  })()`);"
failure_expr_new = "    initializing: document.body.innerText.includes('Initializing local database')\n  })`);"
if failure_expr_old not in text:
    raise SystemExit('DB failure object-expression marker missing')
text = text.replace(failure_expr_old, failure_expr_new, 1)

start_marker = "  await dbFailure.screenshot('07-db-open-failure.png');\n"
end_marker = "  assert(evidence.checks.dbOpenFailure.pass, 'DB open failure retry acceptance failed');\n"
start = text.index(start_marker)
end = text.index(end_marker, start) + len(end_marker)
replacement = """  await dbFailure.screenshot('07-db-open-failure.png');
  evidence.checks.dbOpenFailure = {
    environment: 'Fresh Chrome page with IDBFactory.open forced to fail during app bootstrap',
    operation: 'Navigate -> observe fatal DB error state and inspect provided Retry control',
    expected: 'Explicit DB-open error + enabled Retry control; no infinite Initializing state',
    actual: { failureUi },
    pass: failureUi.alert.includes('ローカルデータベースを開けません') && failureUi.retry && !failureUi.initializing,
  };
  assert(evidence.checks.dbOpenFailure.pass, 'DB open failure explicit error/retry acceptance failed');
"""
text = text[:start] + replacement + text[end:]

restore_start_marker = "  await restoreTab.waitFor(\"document.body.innerText.includes('復元が完了しました。再読み込みしてください。')\", 20000);\n"
restore_end_marker = "  assert(evidence.checks.crossTabRestore.pass, 'Cross-tab Restore stale Session acceptance failed');\n"
restore_start = text.index(restore_start_marker)
restore_end = text.index(restore_end_marker, restore_start) + len(restore_end_marker)
restore_replacement = """  await ime.waitFor("document.body.innerText.includes('ローカルデータが更新されました')", 20000);
  const primaryAfterRestore = await ime.evaluate(`({
    alert: document.querySelector('[role="alert"]')?.innerText ?? '',
    buzz: !!document.querySelector('.buzz-button'),
    reload: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '再読み込み'),
    generation: localStorage.getItem('qbt-phase1-db-generation')
  })`);
  const restoreTabState = await restoreTab.evaluate(`({
    successMessage: document.body.innerText.includes('復元が完了しました。再読み込みしてください。'),
    externalUpdateMessage: document.body.innerText.includes('ローカルデータが更新されました'),
    body: document.body.innerText.slice(0, 500),
    generation: localStorage.getItem('qbt-phase1-db-generation')
  })`);
  const restoreCommitted = primaryAfterRestore.alert.includes('ローカルデータが更新されました') && primaryAfterRestore.generation !== null;
  evidence.checks.crossTabRestore = {
    environment: 'Two real Chrome pages in one browser profile sharing IndexedDB/localStorage/BroadcastChannel',
    operation: 'Tab A starts active Normal Session; Tab B performs actual UI Replace Restore using a valid backup File',
    expected: 'Successful Restore advances DB generation; Tab A immediately stops old Session and requires reload; stale BUZZ/play cannot continue',
    actual: { activeBeforeRestore, restoreCommitted, primaryAfterRestore, restoreTabState },
    pass: restoreCommitted && !primaryAfterRestore.buzz && primaryAfterRestore.reload,
  };
  assert(evidence.checks.crossTabRestore.pass, 'Cross-tab Restore stale Session acceptance failed');
"""
text = text[:restore_start] + restore_replacement + text[restore_end:]

path.write_text(text)
