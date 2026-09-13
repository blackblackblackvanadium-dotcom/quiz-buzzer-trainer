import { useEffect, useMemo, useState } from 'react';
import type { QuizMode } from './domain/types';
import { bootstrapLocalData } from './data/bootstrap';
import { PlayPage } from './pages/PlayPage';
import { RecordsPage } from './pages/RecordsPage';
import { MorePage } from './pages/MorePage';
import { MODE_CAPABILITIES } from './modes/strategies';
import { registerPwa, type PwaUpdateController } from './pwa';
import './styles/app.css';

type Tab = 'play' | 'study' | 'records' | 'more';

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const [mode, setMode] = useState<QuizMode>('normal');
  const [sessionMode, setSessionMode] = useState<QuizMode | null>(null);
  const [ready, setReady] = useState(false);
  const [updateController, setUpdateController] = useState<PwaUpdateController | null>(null);

  useEffect(() => {
    bootstrapLocalData().then(() => setReady(true)).catch(console.error);
    registerPwa(setUpdateController);
  }, []);

  const modes = useMemo(() => (['normal', 'kimari', 'review', 'survival'] as const), []);
  const activeSession = sessionMode !== null;

  if (!ready) return <main className="app-shell"><p>Initializing local database…</p></main>;

  return (
    <div className="app-shell">
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
          {MODE_CAPABILITIES[mode].policyStatus !== 'specified' && (
            <p className="policy-note">{MODE_CAPABILITIES[mode].unresolvedPolicy}</p>
          )}
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
