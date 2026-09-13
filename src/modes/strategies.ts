import type { KimariReference, QuestionRevision, QuizMode, StudyState } from '../domain/types';

export interface ModeCapabilities {
  readonly mode: QuizMode;
  readonly label: string;
  readonly usesTypewriter: boolean;
  readonly requiresBuzz: boolean;
  readonly policyStatus: 'specified';
}

export interface KimariPlanItem {
  readonly question: QuestionRevision;
  readonly reference: KimariReference;
}

export const MODE_CAPABILITIES: Readonly<Record<QuizMode, ModeCapabilities>> = {
  normal: {
    mode: 'normal',
    label: 'Normal',
    usesTypewriter: true,
    requiresBuzz: true,
    policyStatus: 'specified',
  },
  kimari: {
    mode: 'kimari',
    label: 'Kimari-ji',
    usesTypewriter: true,
    requiresBuzz: true,
    policyStatus: 'specified',
  },
  review: {
    mode: 'review',
    label: 'Review',
    usesTypewriter: true,
    requiresBuzz: true,
    policyStatus: 'specified',
  },
  survival: {
    mode: 'survival',
    label: 'Survival',
    usesTypewriter: true,
    requiresBuzz: true,
    policyStatus: 'specified',
  },
  study: {
    mode: 'study',
    label: 'Study',
    usesTypewriter: false,
    requiresBuzz: false,
    policyStatus: 'specified',
  },
};

/**
 * QBT-01 requires a valid Kimari reference for every target question.
 * Current DATA does not define a priority between multiple determiningPoints,
 * so APP only accepts an unambiguous single valid point and never invents ranking.
 */
export function resolveKimariReference(question: QuestionRevision): KimariReference | null {
  const valid = question.determiningPoints.filter((point) =>
    Number.isInteger(point.requiredPrefixGraphemes)
    && point.requiredPrefixGraphemes >= 0
    && point.requiredPrefixGraphemes <= question.derived.graphemeCount,
  );
  if (valid.length !== 1) return null;
  const [point] = valid;
  if (point === undefined) return null;
  return {
    questionId: question.questionId,
    revisionId: question.revisionId,
    referenceBuzzIndex: point.requiredPrefixGraphemes,
  };
}

export function selectKimariPlan(questions: readonly QuestionRevision[]): KimariPlanItem[] {
  return questions.flatMap((question) => {
    const reference = resolveKimariReference(question);
    return reference === null ? [] : [{ question, reference }];
  });
}

export function selectQuestionsForMode(
  mode: QuizMode,
  questions: readonly QuestionRevision[],
  studyStates: readonly StudyState[],
  nowIso: string,
): QuestionRevision[] {
  if (mode === 'review') {
    const dueKeys = new Set(
      studyStates
        .filter((state) => state.dueAt <= nowIso)
        .map((state) => `${state.questionId}::${state.revisionId}`),
    );
    return questions.filter((question) => dueKeys.has(`${question.questionId}::${question.revisionId}`));
  }

  if (mode === 'kimari') return selectKimariPlan(questions).map((item) => item.question);

  // Survival uses the same source pool/order as Normal. No life/ranking filter exists.
  return [...questions];
}
