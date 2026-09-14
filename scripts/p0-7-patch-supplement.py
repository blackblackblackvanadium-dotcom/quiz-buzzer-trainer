from pathlib import Path

path = Path('scripts/p0-7-acceptance-supplement.mjs')
text = path.read_text()

old = "  const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`);"
new = "  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });\n  if (!response.ok) throw new Error(`Chrome target creation failed: ${response.status}`);\n  const target = await response.json();"
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('Chrome target creation marker missing')

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
path.write_text(text)
