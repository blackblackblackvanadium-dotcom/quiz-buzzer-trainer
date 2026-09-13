import { useEffect, useState } from 'react';
import type { Attempt } from '../domain/types';
import { AttemptRepository } from '../data/repositories';
import { calculatePhase1Kpis, type Phase1Kpis } from '../analytics/kpis';

const EMPTY: Phase1Kpis = {
  scoredAttempts: 0,
  accuracy: null,
  firstExposureAccuracy: null,
  correctMedianBuzzRatio: null,
  incorrectMedianBuzzRatio: null,
  correctMedianResponseTimeMs: null,
};

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function RecordsPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [kpis, setKpis] = useState<Phase1Kpis>(EMPTY);

  useEffect(() => {
    new AttemptRepository().list().then((items) => {
      setAttempts(items);
      setKpis(calculatePhase1Kpis(items));
    }).catch(console.error);
  }, []);

  return (
    <section className="screen">
      <h1>Records</h1>
      <div className="metric-grid">
        <article><span>Scored</span><strong>{kpis.scoredAttempts}</strong></article>
        <article><span>Accuracy</span><strong>{percent(kpis.accuracy)}</strong></article>
        <article><span>First exposure</span><strong>{percent(kpis.firstExposureAccuracy)}</strong></article>
        <article><span>Correct buzz median</span><strong>{percent(kpis.correctMedianBuzzRatio)}</strong></article>
        <article><span>Incorrect buzz median</span><strong>{percent(kpis.incorrectMedianBuzzRatio)}</strong></article>
        <article><span>Correct recall median</span><strong>{kpis.correctMedianResponseTimeMs === null ? '—' : `${Math.round(kpis.correctMedianResponseTimeMs)} ms`}</strong></article>
      </div>
      <p className="muted">Scored KPIにはPass / Skipを含めません。履歴: {attempts.length}件</p>
    </section>
  );
}
