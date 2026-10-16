import { describe, expect, it } from 'vitest';
import { THEME_KEY, THEME_SCRIPT, nextPreference, parsePreference, resolveTheme } from '@/lib/theme';

/** Roda o script do <head> com um navegador falso e devolve o tema que ele gravou no <html>. */
function runScript(stored: string | null, systemDark: boolean, storageFails = false): string | undefined {
  const html = { dataset: {} as Record<string, string> };
  const fakeWindow = { matchMedia: (q: string) => ({ matches: q.includes('dark') && systemDark }) };
  const fakeStorage = {
    getItem: (k: string) => {
      if (storageFails) throw new Error('bloqueado');
      return k === THEME_KEY ? stored : null;
    },
  };
  new Function('window', 'localStorage', 'document', THEME_SCRIPT)(fakeWindow, fakeStorage, { documentElement: html });
  return html.dataset.theme;
}

describe('tema', () => {
  it('preferência salva: claro, escuro ou sistema (qualquer outra coisa)', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('azul')).toBe('system');
  });

  it('sistema segue o Windows/macOS; claro e escuro ignoram', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('o botão do menu recolhido alterna Claro → Escuro → Sistema → Claro', () => {
    expect([nextPreference('light'), nextPreference('dark'), nextPreference('system')]).toEqual(['dark', 'system', 'light']);
  });

  it('o script do <head> grava o tema certo antes de pintar, mesmo sem localStorage', () => {
    expect(runScript('dark', false)).toBe('dark');
    expect(runScript('light', true)).toBe('light');
    expect(runScript(null, true)).toBe('dark');
    expect(runScript(null, false)).toBe('light');
    expect(runScript(null, true, true)).toBe('dark');
  });
});
