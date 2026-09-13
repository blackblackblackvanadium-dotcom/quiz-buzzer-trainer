import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db, toQuestionRecord } from '../../src/data/db';
import { PlayPage } from '../../src/pages/PlayPage';
import { makeQuestionV1 } from '../fixtures/questionV1';

afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
  localStorage.clear();
});

async function seedSingleQuestion(prompt = 'abcd', primaryAnswer = 'Answer'): Promise<void> {
  await db.open();
  const base = makeQuestionV1({ questionId: 'ui-q', revisionId: 'r1', revision: 1, prompt });
  const question = {
    ...base,
    answers: {
      ...base.answers,
      primaryAnswer: { ...base.answers.primaryAnswer, text: primaryAnswer },
    },
  };
  await db.questions.add(toQuestionRecord(question));
}

describe('UIUX-P0-707..714 interaction acceptance', () => {
  it('moves BUZZ to Answer only after ENGINE acceptance and blocks Enter carry-through in both transitions', async () => {
    await seedSingleQuestion();
    render(<PlayPage mode="normal" onSessionEnd={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: '開始' }));
    const buzz = await screen.findByRole('button', { name: 'BUZZ' });

    fireEvent.keyDown(buzz, { key: 'Enter', code: 'Enter', repeat: false });
    const input = await screen.findByLabelText('回答');
    expect(screen.queryByRole('button', { name: 'BUZZ' })).not.toBeInTheDocument();

    const form = input.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(await db.attempts.count()).toBe(0);

    fireEvent.keyUp(window, { key: 'Enter', code: 'Enter' });
    fireEvent.change(input, { target: { value: 'Answer' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', repeat: false });
    fireEvent.submit(form!);

    await screen.findByText('正解');
    expect(await db.attempts.count()).toBe(1);

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', repeat: false });
    expect(screen.getByText('正解')).toBeInTheDocument();

    fireEvent.keyUp(window, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', repeat: false });
    await screen.findByText('Session complete');
  });

  it('does not submit while Japanese IME composition is active and submits exactly once after composition ends', async () => {
    await seedSingleQuestion();
    render(<PlayPage mode="study" onSessionEnd={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: '開始' }));
    const input = await screen.findByLabelText('回答');
    const form = input.closest('form');
    expect(form).not.toBeNull();

    fireEvent.change(input, { target: { value: 'Answer' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.submit(form!);
    expect(await db.attempts.count()).toBe(0);
    expect(screen.queryByText('正解')).not.toBeInTheDocument();

    fireEvent.compositionEnd(input);
    fireEvent.keyUp(window, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', repeat: false });
    fireEvent.submit(form!);

    await screen.findByText('正解');
    await waitFor(async () => expect(await db.attempts.count()).toBe(1));
  });
});

describe('P0 #7 persistent XSS regression', () => {
  it('renders stored malicious prompt and answer as inert text, never as executable DOM', async () => {
    const maliciousPrompt = '<img src=x onerror="window.__qbtXss=1">';
    const maliciousAnswer = '<svg onload="window.__qbtXss=2"></svg>';
    await seedSingleQuestion(maliciousPrompt, maliciousAnswer);

    render(<PlayPage mode="study" onSessionEnd={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: '開始' }));

    expect(screen.getByText(maliciousPrompt)).toBeInTheDocument();
    expect(document.querySelector('img, svg, script')).toBeNull();

    const input = screen.getByLabelText('回答');
    fireEvent.change(input, { target: { value: maliciousAnswer } });
    fireEvent.submit(input.closest('form')!);

    await screen.findByText('正解');
    expect(screen.getByText(maliciousAnswer)).toBeInTheDocument();
    expect(document.querySelector('img, svg, script')).toBeNull();
    expect((window as Window & { __qbtXss?: number }).__qbtXss).toBeUndefined();
  });
});
