import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attempt, BuzzSnapshot, QuestionRevision, QuizMode, QuizPhase, SessionId } from '../domain/types';
import { createAttempt } from '../engine/attemptFactory';
import { judgeAnswer } from '../engine/judge';
import { transitionPhase } from '../engine/stateMachine';
import { TypewriterEngine, type TypewriterSnapshot } from '../engine/typewriterEngine';
import { AttemptRepository, QuestionRepository, SessionRepository, StudyStateRepository, persistAttemptTransaction } from '../data/repositories';
import { MODE_CAPABILITIES, selectQuestionsForMode } from '../modes/strategies';
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

export function PlayPage({ mode, onSessionEnd }: PlayPageProps) {
  const [questions, setQuestions] = useState<QuestionRevision[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>('loading');
  const [reader, setReader] = useState<TypewriterSnapshot>(EMPTY_READER);
  const [buzz, setBuzz] = useState<BuzzSnapshot | null>(null);
  const [answer, setAnswer] = useState('');
  const [lastAttempt, setLastAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<TypewriterEngine | null>(null);
  const answerStartedAtRef = useRef<number | null>(null);
  const questionStartedAtRef = useRef<string>('');
  const sessionIdRef = useRef<SessionId>(randomId('session'));

  const capability = MODE_CAPABILITIES[mode];
  const question = questions[questionIndex] ?? null;

  useEffect(() => {
    let cancelled = false;
    const repo = new QuestionRepository();
    const studyRepo = new StudyStateRepository();
    const sessionRepo = new SessionRepository();
    sessionRepo
      .create({
        sessionId: sessionIdRef.current,
        mode,
        startedAt: new Date().toISOString(),
        endedAt: null,
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    Promise.all([repo.list(), studyRepo.list()]).then(([items, states]) => {
      if (cancelled) return;
      setQuestions(selectQuestionsForMode(mode, items, states, new Date().toISOString()));
      setPhase('ready');
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
      engineRef.current?.pause();
      void sessionRepo.end(sessionIdRef.current, new Date().toISOString());
    };
  }, [mode]);

  const startQuestion = useCallback(() => {
    if (question === null) return;
    setBuzz(null);
    setAnswer('');
    setLastAttempt(null);
    setReader(EMPTY_READER);
    setError(null);
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
      answerStartedAtRef.current = performance.now();
      return;
    }

    const engine = new TypewriterEngine(question.prompt, 85);
    engineRef.current = engine;
    engine.start((snapshot) => setReader(snapshot));
  }, [capability.usesTypewriter, mode, question]);

  const doBuzz = useCallback(() => {
    if (phase !== 'reading' || engineRef.current === null) return;
    const snapshot = engineRef.current.buzz();
    setBuzz(snapshot);
    answerStartedAtRef.current = performance.now();
    setPhase(transitionPhase(phase, 'BUZZ', mode));
  }, [mode, phase]);

  const saveOutcome = useCallback(async (outcome: 'pass' | 'skip') => {
    if (question === null || (phase !== 'reading' && phase !== 'answering')) return;
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
      responseTimeMs: answerStartedAtRef.current === null ? null : performance.now() - answerStartedAtRef.current,
    });
    await new AttemptRepository().add(attempt);
    setLastAttempt(attempt);
    setPhase('result');
  }, [buzz, mode, phase, question]);

  const submitAnswer = useCallback(async () => {
    if (question === null || phase !== 'answering') return;
    const judged = judgeAnswer(question, answer);
    const completedAt = new Date().toISOString();
    const responseTimeMs = answerStartedAtRef.current === null ? null : performance.now() - answerStartedAtRef.current;
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
    });

    if (mode === 'review' || mode === 'study') {
      const studyRepo = new StudyStateRepository();
      const previous = (await studyRepo.get(question.questionId, question.revisionId)) ?? initialStudyState(question, new Date());
      await persistAttemptTransaction(attempt, updateStudyState(previous, attempt, new Date()));
    } else {
      await new AttemptRepository().add(attempt);
    }

    setLastAttempt(attempt);
    setPhase(transitionPhase(phase, 'SUBMIT', mode));
  }, [answer, buzz, mode, phase, question]);

  const next = useCallback(() => {
    if (phase !== 'result') return;
    const nextIndex = questionIndex + 1;
    if (nextIndex >= questions.length) {
      setPhase('finished');
      return;
    }
    setQuestionIndex(nextIndex);
    setPhase('ready');
  }, [phase, questionIndex, questions.length]);

  const progress = useMemo(() => `${Math.min(questionIndex + 1, questions.length)} / ${questions.length}`, [questionIndex, questions.length]);

  if (error !== null) {
    return <section className="screen"><div className="error-card" role="alert">{error}</div></section>;
  }

  if (phase === 'loading') {
    return <section className="screen"><p>Loading…</p></section>;
  }

  if (questions.length === 0) {
    return <section className="screen"><p>問題データがありません。</p></section>;
  }

  if (phase === 'finished') {
    return <section className="screen"><div className="result-card"><h2>Session complete</h2><p>{progress}</p><button className="primary-button" type="button" onClick={onSessionEnd}>メニューへ戻る</button></div></section>;
  }

  return (
    <section className="screen play-screen" aria-live="polite">
      <header className="play-header">
        <div><strong>{capability.label}</strong><span className="muted"> {progress}</span></div>
        {capability.policyStatus !== 'specified' && <span className="spec-badge">CORE確認待ち</span>}
      </header>

      <main className="question-stage">
        <p className="question-text">{phase === 'ready' ? '準備ができたら開始' : reader.text}</p>
      </main>

      {phase === 'ready' && (
        <button className="primary-button" type="button" onClick={startQuestion}>開始</button>
      )}

      {phase === 'reading' && (
        <div className="buzz-dock">
          <button className="buzz-button" type="button" onPointerDown={doBuzz}>BUZZ</button>
          <div className="secondary-actions">
            <button type="button" onClick={() => void saveOutcome('pass')}>Pass</button>
            <button type="button" onClick={() => void saveOutcome('skip')}>Skip</button>
          </div>
        </div>
      )}

      {phase === 'answering' && (
        <form className="answer-panel" onSubmit={(event) => { event.preventDefault(); void submitAnswer(); }}>
          <label htmlFor="answer-input">回答</label>
          <input id="answer-input" autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" />
          <button className="primary-button" type="submit">判定</button>
        </form>
      )}

      {phase === 'result' && lastAttempt !== null && (
        <div className="result-card">
          <h2>{lastAttempt.outcome === 'correct' ? '正解' : lastAttempt.outcome === 'incorrect' ? '不正解' : lastAttempt.outcome}</h2>
          <p>正答: <strong>{question?.canonicalAnswer}</strong></p>
          {lastAttempt.buzzIndex !== null && <p>BUZZ: {lastAttempt.buzzIndex}文字 / {((lastAttempt.buzzRatio ?? 0) * 100).toFixed(1)}%</p>}
          {lastAttempt.responseTimeMs !== null && <p>想起: {Math.round(lastAttempt.responseTimeMs)} ms</p>}
          <button className="primary-button" type="button" onClick={next}>次へ</button>
        </div>
      )}
    </section>
  );
}
