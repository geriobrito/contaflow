'use client';

import { useSyncExternalStore } from 'react';
import { getReadTally, getServerReadTally, subscribeReads, type ReadTally } from '@/lib/data/read-meter';

const snapshot = () => getReadTally();

/** Leituras do Firestore feitas por este navegador no dia da cota; atualiza a cada consulta. */
export function useReadTally(): ReadTally {
  return useSyncExternalStore(subscribeReads, snapshot, getServerReadTally);
}
