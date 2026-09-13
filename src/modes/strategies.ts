import type { QuestionRevision, QuizMode, StudyState } from '../domain/types';

export interface ModeCapabilities {
  readonly mode: QuizMode;
  readonly label: string;
  readonly usesTypewriter: boolean;
  readonly requiresBuzz: boolean;
  readonly policyStatus: 'specified' | 'requires-core-clarification';
  readonly unresolvedPolicy?: string;
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
    policyStatus: 'requires-core-clarification',
    unresolvedPolicy: 'Current Spec available to APP does not define the exact Kimari-ji question-selection/ranking rule.',
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
    policyStatus: 'requires-core-clarification',
    unresolvedPolicy: 'Current Spec available to APP does not define the exact Survival termination/life rule.',
  },
  study: {
    mode: 'study',
    label: 'Study',
    usesTypewriter: false,
    requiresBuzz: false,
    policyStatus: 'specified',
  },
};

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

  // Kimari-ji and Survival keep the shared engine path until CORE supplies
  // their missing selection/termination policies. No speculative filtering.
  return [...questions];
}
