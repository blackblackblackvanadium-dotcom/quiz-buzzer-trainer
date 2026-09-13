export const MAX_UNTRUSTED_TEXT_CODE_UNITS = 32 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 32 * 1024 * 1024;

export function assertUntrustedTextWithinLimit(
  text: string,
  label: string,
  maxCodeUnits = MAX_UNTRUSTED_TEXT_CODE_UNITS,
): void {
  if (text.length > maxCodeUnits) {
    throw new Error(`${label} exceeds the Phase 1 input size limit`);
  }
}

export function assertFileSizeWithinLimit(
  sizeBytes: number,
  label: string,
  maxBytes = MAX_BACKUP_FILE_BYTES,
): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new Error(`${label} size is invalid`);
  if (sizeBytes > maxBytes) throw new Error(`${label} exceeds the Phase 1 input size limit`);
}
