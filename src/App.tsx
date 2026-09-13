import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuizMode } from './domain/types';
import { bootstrapLocalData } from './data/bootstrap';
import { subscribeToDatabaseReplacement } from './data/concurrency';
import { PlayPage } from './pages/PlayPage';
import { RecordsPage } from './pages/RecordsPage';
import { MorePage } from './pages/MorePage';
import { MODE_CAPABILITIES } from './modes/strategies';
import { registerPwa, type PwaUpdateController } from './pwa';
import './styles/app.css';

type Tab = 'play' | 'study' | 'records' | 'more';

function onlineNow(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const [mode, setMode] = useState<QuizMode>('normal');
  const [sessionMode, setSessionMode] = useState<QuizMode | null>(null);
  const [ready, setReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [externalDbChange, setExternalDbChange] = useState(false);
  const [online, setOnline] = useState(onlineNow);
  const [updateController, setUpdateController] = useState<PwaUpdateController | null>(null);

  const runBootstrap = useCallback(async () => {
    setReady(false);
    setBootstrapError(null);
    try {
      await bootstrapLocalData();
      setReady(true);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void runBootstrap();
    registerPwa(setUpdateController);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribeReplacement = subscribeToDatabaseReplacement(() => {
      setSessionMode(null);
      setExternalDbChange(true);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeReplacement();
    };
  }, [runBootstrap]);

  const modes = useMemo(() => (['normal', 'kimari', 'review', 'survival'] as const), []);
  const activeSession = sessionMode !== null;

  if (externalDbChange) {
    return (
      <main className="app-shell fatal-shell">
        <div className="error-card" role="alert">
          <h1>ローカルデータが更新されました</h1>
          <p>別タブでRestoreが完了したため、このタブの古いSessionは続行できません。</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>再読み込み</button>
        </div>
      </main>
    );
  }

  if (bootstrapError !== null) {
    return (
      <main className="app-shell fatal-shell">
        <div className="error-card" role="alert">
          <h1>ローカルデータベースを開けません</h1>
          <p>{bootstrapError}</p>
          <button className="primary-button" type="button" onClick={() => void runBootstrap()}>再試行</button>
        </div>
      </main>
    );
  }

  if (!ready) return <main className="app-shell"><p>Initializing local database…</p></main>;

  return (
    <div className="app-shell">
      {!online && <div className="offline-indicator" role="status">オフライン — ローカルデータで利用中</div>}
      {!activeSession && <header className="app-header"><strong>Quiz Buzzer Trainer</strong><span>Phase 1</span></header>}

      {updateController !== null && (
        <div className="update-banner" role="status">
          <span>新しいバージョンがあります。</span>
          <button type="button" disabled={activeSession} onClick={() => void updateController.update(true)}>
            {activeSession ? 'セッション終了後に更新' : '更新'}
          </button>
        </div>
      )}

      {!activeSession && tab === 'play' && (
        <section className="mode-start-panel">
          <div className="mode-picker" aria-label="練習モード">
            {modes.map((item) => (
              <button key={item} className={mode === item ? 'selected' : ''} type="button" onClick={() => setMode(item)}>
                {MODE_CAPABILITIES[item].label}
              </button>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={() => setSessionMode(mode)}>
            {MODE_CAPABILITIES[mode].label}を開始
          </button>
        </section>
      )}

      {!activeSession && tab === 'study' && (
        <section className="mode-start-panel">
          <h1>Study</h1>
          <p>全文を表示して回答する学習モードです。</p>
          <button className="primary-button" type="button" onClick={() => setSessionMode('study')}>Studyを開始</button>
        </section>
      )}

      <main className="content">
        {activeSession && <PlayPage key={sessionMode} mode={sessionMode} onSessionEnd={() => setSessionMode(null)} />}
        {!activeSession && tab === 'records' && <RecordsPage />}
        {!activeSession && tab === 'more' && <MorePage />}
      </main>

      {!activeSession && (
        <nav className="bottom-nav" aria-label="メインナビゲーション">
          <button type="button" className={tab === 'play' ? 'selected' : ''} onClick={() => setTab('play')}>Play</button>
          <button type="button" className={tab === 'study' ? 'selected' : ''} onClick={() => setTab('study')}>Study</button>
          <button type="button" className={tab === 'records' ? 'selected' : ''} onClick={() => setTab('records')}>Records</button>
          <button type="button" className={tab === 'more' ? 'selected' : ''} onClick={() => setTab('more')}>More</button>
        </nav>
      )}
    </div>
  );
}
