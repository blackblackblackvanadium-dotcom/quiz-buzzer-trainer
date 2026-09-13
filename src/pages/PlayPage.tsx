import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BuzzSnapshot,
  KimariReference,
  PersistedAttempt,
  QuestionRevision,
  QuizMode,
  QuizPhase,
  QuizSession,
  SessionId,
  StudyState,
} from '../domain/types';
import { createAttempt } from '../engine/attemptFactory';
import { judgeAnswer } from '../engine/judge';
import {
  createModeSessionState,
  isCompetitiveMode,
  resolveModeAttempt,
  terminateModeSession,
  type ModeSessionState,
} from '../engine/modeSessionEngine';
import { createSessionRecord, endSessionRecord, updateSessionProgress } from '../engine/sessionFactory';
import { transitionPhase } from '../engine/stateMachine';
import { TypewriterEngine, type TypewriterSnapshot } from '../engine/typewriterEngine';
import {
  QuestionRepository,
  SessionRepository,
  StudyStateRepository,
  persistAttemptAndSessionTransaction,
} from '../data/repositories';
import { getDatabaseGeneration } from '../data/concurrency';
import {
  MODE_CAPABILITIES,
  resolveKimariReference,
  selectQuestionsForMode,
} from '../modes/strategies';
import { initialStudyState, updateStudyState } from '../modes/studyScheduler';

interface PlayPageProps {
  readonly mode: QuizMode;
  readonly onSessionEnd: () => void;
}

const EMPTY_READER: TypewriterSnapshot = {
  committedCount: 0,
  totalGraphemeCount: 0,
  text: '',
  complete: false,
};

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatEndReason(session: QuizSession | null): string {
  if (session?.endReason === 'survival_failed') return 'Survival failed';
  if (session?.endReason === 'survival_cleared') return 'Survival cleared';
  if (session?.endReason === 'user_ended') return 'Session ended';
  if (session?.endReason === 'fatal_error') return 'Session error';
  return 'Session complete';
}

export function PlayPage({ mode, onSessionEnd }: PlayPageProps) {
  const [questions, setQuestions] = useState<QuestionRevision[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>('loading');
  const [reader, setReader] = useState<TypewriterSnapshot>(EMPTY_READER);
  const [buzz, setBuzz] = useState<BuzzSnapshot | null>(null);
  const [answer, setAnswer] = useState('');
  const [lastAttempt, setLastAttempt] = useState<PersistedAttempt | null>(null);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [modeState, setModeState] = useState<ModeSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<TypewriterEngine | null>(null);
  const questionStartedAtRef = useRef<string>('');
  const sessionIdRef = useRef<SessionId>(randomId('session'));
  const sessionStartedAtRef = useRef<string>(new Date().toISOString());
  const sessionGenerationRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const buzzingRef = useRef(false);
  const answerComposingRef = useRef(false);
  const answerEnterBlockedRef = useRef(false);
  const resultEnterBlockedRef = useRef(false);

  const capability = MODE_CAPABILITIES[mode];
  const question = questions[questionIndex] ?? null;
  const kimariReference = useMemo<KimariReference | null>(
    () => (mode === 'kimari' && question !== null ? resolveKimariReference(question) : null),
    [mode, question],
  );

  useEffect(() => {
    const releaseCarryThrough = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.isComposing) {
        answerEnterBlockedRef.current = false;
        resultEnterBlockedRef.current = false;
      }
    };
    window.addEventListener('keyup', releaseCarryThrough, true);
    return () => window.removeEventListener('keyup', releaseCarryThrough, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const repo = new QuestionRepository();
    const studyRepo = new StudyStateRepository();
    const sessionRepo = new SessionRepository();

    Promise.all([repo.list(), studyRepo.list()]).then(async ([items, states]) => {
      if (cancelled) return;
      const selected = selectQuestionsForMode(mode, items, states, new Date().toISOString());
      setQuestions(selected);
      setQuestionIndex(0);

      if (selected.length === 0) {
        setPhase('ready');
        return;
      }

      const competitiveState = isCompetitiveMode(mode)
        ? createModeSessionState(mode, selected.length)
        : null;
      const created = createSessionRecord({
        sessionId: sessionIdRef.current,
        mode,
        startedAt: sessionStartedAtRef.current,
        targetQuestionCount: selected.length,
        modeResult: competitiveState?.modeResult ?? null,
      });
      const generation = getDatabaseGeneration();
      sessionGenerationRef.current = generation;
      await sessionRepo.put(created, generation);
      if (cancelled) return;
      setModeState(competitiveState);
      setSession(created);
      setPhase('ready');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));

    return () => {
      cancelled = true;
      engineRef.current?.pause();
    };
  }, [mode]);

  useEffect(() => {
    if (error === null || session === null || session.endReason !== null) return;
    engineRef.current?.pause();
    const failed = endSessionRecord(
      session,
      'fatal_error',
      new Date().toISOString(),
      { modeResult: modeState?.modeResult ?? session.modeResult },
    );
    setSession(failed);
    void new SessionRepository()
      .put(failed, sessionGenerationRef.current ?? undefined)
      .catch(() => undefined);
  }, [error, modeState, session]);

  const startQuestion = useCallback(() => {
    if (question === null) return;
    if (mode === 'kimari' && kimariReference === null) {
      setError('Kimari-ji target is missing an unambiguous Kimari reference.');
      return;
    }
    setBuzz(null);
    setAnswer('');
    setLastAttempt(null);
    setReader(EMPTY_READER);
    setError(null);
    buzzingRef.current = false;
    answerComposingRef.current = false;
    answerEnterBlockedRef.current = false;
    resultEnterBlockedRef.current = false;
    questionStartedAtRef.current = new Date().toISOString();
    const nextPhase = transitionPhase('ready', 'START_READING', mode);
    setPhase(nextPhase);

    if (!capability.usesTypewriter) {
      setReader({
        committedCount: 0,
        totalGraphemeCount: 0,
        text: question.prompt,
        complete: true,
      });
      return;
    }

    const engine = new TypewriterEngine(question.prompt, 85);
    engineRef.current = engine;
    engine.start((snapshot) => setReader(snapshot));
  }, [capability.usesTypewriter, kimariReference, mode, question]);

  const doBuzz = useCallback((keyboardEnter: boolean) => {
    if (phase !== 'reading' || engineRef.current === null || buzzingRef.current) return;
    buzzingRef.current = true;
    try {
      const snapshot = engineRef.current.buzz();
      if (keyboardEnter) answerEnterBlockedRef.current = true;
      setBuzz(snapshot);
      setPhase(transitionPhase(phase, 'BUZZ', mode));
    } catch (reason: unknown) {
      buzzingRef.current = false;
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [mode, phase]);

  const persistResolvedAttempt = useCallback(async (
    attempt: PersistedAttempt,
    studyState: StudyState | null,
  ): Promise<void> => {
    if (session === null) throw new Error('Session is not initialized');

    let nextSession: QuizSession;
    let nextModeState = modeState;

    if (isCompetitiveMode(mode)) {
      if (modeState === null) throw new Error(`${mode} engine state is not initialized`);
      const resolution = resolveModeAttempt(modeState, attempt);
      nextModeState = resolution.state;
      nextSession = resolution.state.endReason === null
        ? updateSessionProgress(session, resolution.state.consumedQuestionCount, resolution.state.modeResult)
        : endSessionRecord(
            session,
            resolution.state.endReason,
            attempt.completedAt,
            {
              consumedQuestionCount: resolution.state.consumedQuestionCount,
              modeResult: resolution.state.modeResult,
            },
          );
    } else {
      const consumedQuestionCount = session.consumedQuestionCount + 1;
      nextSession = consumedQuestionCount === session.targetQuestionCount
        ? endSessionRecord(
            session,
            'completed',
            attempt.completedAt,
            { consumedQuestionCount },
          )
        : updateSessionProgress(session, consumedQuestionCount, null);
    }

    await persistAttemptAndSessionTransaction(
      attempt,
      nextSession,
      studyState,
      undefined,
      sessionGenerationRef.current ?? undefined,
    );
    setSession(nextSession);
    setModeState(nextModeState);
  }, [mode, modeState, session]);

  const saveOutcome = useCallback(async (outcome: 'pass' | 'skip') => {
    if (savingRef.current || question === null || session === null) return;
    if (outcome === 'skip' && phase !== 'reading') return;
    if (outcome === 'pass' && phase !== 'reading' && phase !== 'answering') return;
    if (mode === 'survival' && outcome === 'skip') {
      setError('Skip is forbidden in Survival.');
      return;
    }

    savingRef.current = true;
    try {
      engineRef.current?.pause();
      const completedAt = new Date().toISOString();
      const attempt = createAttempt({
        attemptId: randomId('attempt'),
        question,
        sessionId: sessionIdRef.current,
        mode,
        outcome,
        judge: null,
        submittedAnswer: null,
        startedAt: questionStartedAtRef.current || completedAt,
        completedAt,
        buzz,
        responseTimeMs: null,
        kimariReference,
      });
      await persistResolvedAttempt(attempt, null);
      setLastAttempt(attempt);
      setPhase(transitionPhase(phase, outcome === 'pass' ? 'PASS' : 'SKIP', mode));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
    }
  }, [buzz, kimariReference, mode, persistResolvedAttempt, phase, question, session]);

  const submitAnswer = useCallback(async () => {
    if (savingRef.current || question === null || session === null || phase !== 'answering') return;
    savingRef.current = true;
    try {
      let responseTimeMs: number | null = null;
      if (capability.requiresBuzz) {
        const engine = engineRef.current;
        if (engine === null) throw new Error('回答時間を確定するクイズエンジンがありません。');
        responseTimeMs = engine.confirmAnswerSubmit();
      }

      const judged = judgeAnswer(question, answer);
      const completedAt = new Date().toISOString();
      const attempt = createAttempt({
        attemptId: randomId('attempt'),
        question,
        sessionId: sessionIdRef.current,
        mode,
        outcome: judged.isCorrect ? 'correct' : 'incorrect',
        judge: judged,
        submittedAnswer: answer,
        startedAt: questionStartedAtRef.current || completedAt,
        completedAt,
        buzz,
        responseTimeMs,
        kimariReference,
      });

      let nextStudyState: StudyState | null = null;
      if (mode === 'review' || mode === 'study') {
        const studyRepo = new StudyStateRepository();
        const previous = (await studyRepo.get(question.questionId, question.revisionId))
          ?? initialStudyState(question, new Date());
        nextStudyState = updateStudyState(previous, attempt, new Date());
      }

      await persistResolvedAttempt(attempt, nextStudyState);
      setLastAttempt(attempt);
      setPhase(transitionPhase(phase, 'SUBMIT', mode));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
    }
  }, [answer, buzz, capability.requiresBuzz, kimariReference, mode, persistResolvedAttempt, phase, question, session]);

  const next = useCallback(async () => {
    if (savingRef.current || phase !== 'result' || session === null) return;
    savingRef.current = true;
    try {
      if (session.endReason !== null) {
        setPhase('finished');
        return;
      }

      const nextIndex = questionIndex + 1;
      if (nextIndex >= questions.length) {
        throw new Error('Session plan exhausted without an atomically persisted terminal state');
      }

      setQuestionIndex(nextIndex);
      questionStartedAtRef.current = '';
      setLastAttempt(null);
      const loading = transitionPhase(phase, 'NEXT', mode);
      setPhase(transitionPhase(loading, 'READY', mode));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
    }
  }, [mode, phase, questionIndex, questions.length, session]);

  useEffect(() => {
    if (phase !== 'result') return;
    const handleResultEnter = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (event.repeat || resultEnterBlockedRef.current) return;
      void next();
    };
    window.addEventListener('keydown', handleResultEnter);
    return () => window.removeEventListener('keydown', handleResultEnter);
  }, [next, phase]);

  const endManually = useCallback(async () => {
    if (savingRef.current || session === null || session.endReason !== null) return;
    savingRef.current = true;
    try {
      engineRef.current?.pause();
      const terminatedState = modeState === null ? null : terminateModeSession(modeState, 'user_ended');
      const ended = endSessionRecord(
        session,
        'user_ended',
        new Date().toISOString(),
        { modeResult: terminatedState?.modeResult ?? session.modeResult },
      );
      await new SessionRepository().put(ended, sessionGenerationRef.current ?? undefined);
      setModeState(terminatedState);
      setSession(ended);
      setPhase('finished');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
    }
  }, [modeState, session]);

  const progress = useMemo(
    () => `${Math.min(questionIndex + 1, questions.length)} / ${questions.length}`,
    [questionIndex, questions.length],
  );
  const survivalScore = modeState?.mode === 'survival' ? modeState.score : null;

  if (error !== null) {
    return (
      <section className="screen">
        <div className="error-card" role="alert">{error}</div>
        <button className="primary-button" type="button" onClick={onSessionEnd}>メニューへ戻る</button>
      </section>
    );
  }

  if (phase === 'loading') {
    return <section className="screen"><p>Loading…</p></section>;
  }

  if (questions.length === 0) {
    return (
      <section className="screen">
        <p>{mode === 'kimari' ? '有効な決まり字基準位置を持つ問題がありません。' : '問題データがありません。'}</p>
        <button className="primary-button" type="button" onClick={onSessionEnd}>メニューへ戻る</button>
      </section>
    );
  }

  if (phase === 'finished') {
    return (
      <section className="screen">
        <div className="result-card">
          <h2>{formatEndReason(session)}</h2>
          <p>{session?.consumedQuestionCount ?? 0} / {session?.targetQuestionCount ?? questions.length}</p>
          {survivalScore !== null && <p>Score: <strong>{survivalScore}</strong></p>}
          <button className="primary-button" type="button" onClick={onSessionEnd}>メニューへ戻る</button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen play-screen" aria-live="polite">
      <header className="play-header">
        <div>
          <strong>{capability.label}</strong><span className="muted"> {progress}</span>
          {survivalScore !== null && <span className="muted"> Score {survivalScore}</span>}
        </div>
        <button type="button" onClick={() => void endManually()}>終了</button>
      </header>

      <main className="question-stage">
        <p className="question-text">{phase === 'ready' ? '準備ができたら開始' : reader.text}</p>
      </main>

      {phase === 'ready' && (
        <button className="primary-button" type="button" onClick={startQuestion}>開始</button>
      )}

      {phase === 'reading' && (
        <div className="buzz-dock">
          <button
            className="buzz-button"
            type="button"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              doBuzz(false);
            }}
            onKeyDown={(event) => {
              if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
              event.preventDefault();
              doBuzz(event.key === 'Enter');
            }}
          >
            BUZZ
          </button>
          <div className="secondary-actions">
            <button type="button" onClick={() => void saveOutcome('pass')}>Pass</button>
            {mode !== 'survival' && <button type="button" onClick={() => void saveOutcome('skip')}>Skip</button>}
          </div>
        </div>
      )}

      {phase === 'answering' && (
        <form
          className="answer-panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (answerComposingRef.current || answerEnterBlockedRef.current) return;
            void submitAnswer();
          }}
        >
          <label htmlFor="answer-input">回答</label>
          <input
            id="answer-input"
            autoFocus
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onCompositionStart={() => { answerComposingRef.current = true; }}
            onCompositionEnd={() => { answerComposingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              if (event.nativeEvent.isComposing || answerComposingRef.current || answerEnterBlockedRef.current) {
                event.preventDefault();
                return;
              }
              resultEnterBlockedRef.current = true;
            }}
            autoComplete="off"
          />
          <button className="primary-button" type="submit">判定</button>
          {(mode === 'kimari' || mode === 'survival') && (
            <button type="button" onClick={() => void saveOutcome('pass')}>Pass</button>
          )}
        </form>
      )}

      {phase === 'result' && lastAttempt !== null && (
        <div className="result-card">
          <h2>{lastAttempt.outcome === 'correct' ? '正解' : lastAttempt.outcome === 'incorrect' ? '不正解' : lastAttempt.outcome}</h2>
          <p>正答: <strong>{question?.answers.primaryAnswer.text}</strong></p>
          {lastAttempt.buzzIndex !== null && <p>BUZZ: {lastAttempt.buzzIndex}文字 / {((lastAttempt.buzzRatio ?? 0) * 100).toFixed(1)}%</p>}
          {lastAttempt.responseTimeMs !== null && <p>想起: {Math.round(lastAttempt.responseTimeMs)} ms</p>}
          {lastAttempt.kimari !== null && (
            <p>決まり字差: {lastAttempt.kimari.deltaGraphemes === null ? '—' : `${lastAttempt.kimari.deltaGraphemes >= 0 ? '+' : ''}${lastAttempt.kimari.deltaGraphemes}`}</p>
          )}
          {survivalScore !== null && <p>Score: <strong>{survivalScore}</strong></p>}
          <button className="primary-button" type="button" onClick={() => void next()}>
            {session?.endReason === null ? '次へ' : 'セッション結果'}
          </button>
        </div>
      )}
    </section>
  );
}
