const APP_WRITE_LOCK = 'qbt-phase1-db-write';
const GENERATION_STORAGE_KEY = 'qbt-phase1-db-generation';
const REPLACEMENT_CHANNEL = 'qbt-phase1-db-events';

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

let memoryGeneration = newGenerationToken();

function newGenerationToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStorageGeneration(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(GENERATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorageGeneration(value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(GENERATION_STORAGE_KEY, value);
  } catch {
    // IndexedDB transactions still provide atomic fallback when storage is unavailable.
  }
}

export function getDatabaseGeneration(): string {
  const stored = readStorageGeneration();
  if (stored !== null) return stored;
  writeStorageGeneration(memoryGeneration);
  return memoryGeneration;
}

export function assertDatabaseGeneration(expected: string): void {
  if (getDatabaseGeneration() !== expected) {
    throw new Error('Local database changed in another tab; reload before continuing this session');
  }
}

export function bumpDatabaseGeneration(): string {
  memoryGeneration = newGenerationToken();
  writeStorageGeneration(memoryGeneration);
  return memoryGeneration;
}

export async function withExclusiveAppWrite<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined') {
    const locks = (navigator as Navigator & { readonly locks?: LockManagerLike }).locks;
    if (locks !== undefined && typeof locks.request === 'function') {
      return locks.request(APP_WRITE_LOCK, work);
    }
  }
  return work();
}

export function broadcastDatabaseReplacement(generation: string): void {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(REPLACEMENT_CHANNEL);
    channel.postMessage({ type: 'database-replaced', generation });
    channel.close();
  }
}

export function subscribeToDatabaseReplacement(listener: (generation: string) => void): () => void {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(REPLACEMENT_CHANNEL);
  if (channel !== null) {
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data === 'object'
        && data !== null
        && (data as { type?: unknown }).type === 'database-replaced'
        && typeof (data as { generation?: unknown }).generation === 'string'
      ) {
        listener((data as { generation: string }).generation);
      }
    });
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === GENERATION_STORAGE_KEY && typeof event.newValue === 'string') listener(event.newValue);
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

  return () => {
    channel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
