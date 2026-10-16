'use client';

import { useSyncExternalStore } from 'react';
import { readPreference, setPreference, subscribeTheme, type ThemePreference } from '@/lib/theme';

/** Preferência de tema atual e a função para trocá-la; todas as instâncias ficam em sincronia. */
export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  // No servidor não há preferência: 'system' até hidratar (o <html> já veio certo pelo script).
  const pref = useSyncExternalStore(subscribeTheme, readPreference, () => 'system' as const);
  return [pref, setPreference];
}
