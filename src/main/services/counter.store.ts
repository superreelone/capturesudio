import Store from 'electron-store';
import { createLogger } from '@main/util/logger';

const log = createLogger('counter');

type Schema = { recording: number; screenshot: number };

let store: Store<Schema> | null = null;

function getStore(): Store<Schema> {
  if (store) return store;
  store = new Store<Schema>({
    name: 'counters',
    defaults: { recording: 0, screenshot: 0 }
  });
  return store;
}

export function nextCounter(kind: keyof Schema): number {
  const s = getStore();
  const next = (s.get(kind) ?? 0) + 1;
  s.set(kind, next);
  log.debug('counter incremented', { kind, value: next });
  return next;
}

export function peekCounter(kind: keyof Schema): number {
  return getStore().get(kind) ?? 0;
}
