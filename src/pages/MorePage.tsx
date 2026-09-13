import { useState } from 'react';
import { createBackup, parseBackupJson, replaceRestore, serializeBackup } from '../backup/backup';

export function MorePage() {
  const [message, setMessage] = useState<string>('');

  const exportBackup = async () => {
    const payload = serializeBackup(await createBackup());
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qbt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('バックアップを書き出しました。');
  };

  const restore = async (file: File) => {
    try {
      const parsed = parseBackupJson(await file.text());
      const confirmed = window.confirm('現在のローカルデータを検証済みバックアップで置換します。続行しますか？');
      if (!confirmed) return;
      await replaceRestore(parsed);
      setMessage('復元が完了しました。再読み込みしてください。');
    } catch (error) {
      setMessage(error instanceof Error ? `復元失敗: ${error.message}` : '復元に失敗しました。');
    }
  };

  return (
    <section className="screen">
      <h1>More</h1>
      <div className="settings-card">
        <h2>Backup / Restore</h2>
        <p>Phase 1はReplace Restoreのみ。ファイル全体を検証してからDBを書き換えます。</p>
        <button type="button" onClick={() => void exportBackup()}>バックアップを書き出す</button>
        <label className="file-label">
          バックアップから復元
          <input type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void restore(file);
          }} />
        </label>
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
