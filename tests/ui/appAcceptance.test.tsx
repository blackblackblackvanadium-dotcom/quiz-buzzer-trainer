import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn<() => Promise<void>>(),
  registerPwa: vi.fn(),
  subscribeReplacement: vi.fn(),
  update: vi.fn<(reloadPage?: boolean) => Promise<void>>(),
}));

vi.mock('../../src/data/bootstrap', () => ({
  bootstrapLocalData: mocks.bootstrap,
}));

vi.mock('../../src/pwa', () => ({
  registerPwa: mocks.registerPwa,
}));

vi.mock('../../src/data/concurrency', () => ({
  subscribeToDatabaseReplacement: mocks.subscribeReplacement,
}));

vi.mock('../../src/pages/PlayPage', () => ({
  PlayPage: () => <section data-testid="active-session">Active session</section>,
}));

import App from '../../src/App';

let replacementListener: ((generation: string) => void) | null = null;

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  replacementListener = null;
  setOnline(true);
  mocks.bootstrap.mockReset();
  mocks.bootstrap.mockResolvedValue(undefined);
  mocks.registerPwa.mockReset();
  mocks.subscribeReplacement.mockReset();
  mocks.subscribeReplacement.mockImplementation((listener: (generation: string) => void) => {
    replacementListener = listener;
    return () => undefined;
  });
  mocks.update.mockReset();
  mocks.update.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('UIUX-P0-715..720 app failure/offline acceptance', () => {
  it('shows a recoverable fatal UI instead of hanging when IndexedDB/bootstrap open fails', async () => {
    mocks.bootstrap.mockRejectedValueOnce(new Error('IndexedDB open failed'));
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ローカルデータベースを開けません');
    expect(alert).toHaveTextContent('IndexedDB open failed');
    expect(screen.queryByText('Initializing local database…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Normalを開始/ })).not.toBeInTheDocument();

    mocks.bootstrap.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('button', { name: /Normalを開始/ })).toBeEnabled();
  });

  it('shows a nonblocking offline indicator and removes it on the online event', async () => {
    setOnline(false);
    render(<App />);

    expect(await screen.findByText('オフライン — ローカルデータで利用中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Normalを開始/ })).toBeEnabled();

    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText('オフライン — ローカルデータで利用中')).not.toBeInTheDocument());
  });

  it('does not activate a waiting Service Worker while an active Session exists', async () => {
    mocks.registerPwa.mockImplementation((onNeedRefresh: (controller: { update: (reloadPage?: boolean) => Promise<void> }) => void) => {
      onNeedRefresh({ update: mocks.update });
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Normalを開始/ }));
    expect(screen.getByTestId('active-session')).toBeInTheDocument();

    const updateButton = screen.getByRole('button', { name: 'セッション終了後に更新' });
    expect(updateButton).toBeDisabled();
    fireEvent.click(updateButton);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('stops the active UI and requires reload after another tab replaces the local database', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Normalを開始/ }));
    expect(screen.getByTestId('active-session')).toBeInTheDocument();
    expect(replacementListener).not.toBeNull();

    act(() => replacementListener?.('new-generation'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ローカルデータが更新されました');
    expect(screen.queryByTestId('active-session')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeEnabled();
  });
});
