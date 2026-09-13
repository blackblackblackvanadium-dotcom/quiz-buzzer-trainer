import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MorePage } from '../../src/pages/MorePage';
import { MAX_BACKUP_FILE_BYTES } from '../../src/security/inputLimits';

describe('P0 #7 Restore input UI guard', () => {
  it('rejects an oversized Backup file before reading its text or asking for destructive confirmation', async () => {
    const text = vi.fn<() => Promise<string>>().mockResolvedValue('{}');
    const file = {
      name: 'oversized.json',
      type: 'application/json',
      size: MAX_BACKUP_FILE_BYTES + 1,
      text,
    } as unknown as File;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MorePage />);
    const input = screen.getByLabelText('バックアップから復元');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('status')).toHaveTextContent('Phase 1 input size limit');
    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
