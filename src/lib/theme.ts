/**
 * Tema da interface: Claro, Escuro ou Sistema (segue o Windows/macOS). A escolha fica no
 * localStorage e vira `data-theme` no <html>, de que depende a variante `dark:` (globals.css).
 * O script THEME_SCRIPT roda no <head> antes da primeira pintura, sem piscar o tema errado.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'contaflow_theme';
/** Evento disparado nesta aba quando a preferência muda (o `storage` só chega às outras abas). */
export const THEME_EVENT = 'contaflow-theme';

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

export const parsePreference = (raw: string | null | undefined): ThemePreference => (raw === 'light' || raw === 'dark' ? raw : 'system');

export const resolveTheme = (pref: ThemePreference, systemDark: boolean): ResolvedTheme =>
  pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

/** Próxima opção no ciclo Claro → Escuro → Sistema (botão único do menu recolhido). */
export const nextPreference = (pref: ThemePreference): ThemePreference => (pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light');

const DARK_QUERY = '(prefers-color-scheme: dark)';
const systemDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

export function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(pref, systemDark());
}

export function setPreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* armazenamento indisponível: vale só até recarregar */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Assina mudanças de preferência (nesta aba ou em outra) e do tema do sistema, reaplicando o
 * tema. Para `useSyncExternalStore`.
 */
export function subscribeTheme(onChange: () => void): () => void {
  const reapply = () => {
    applyTheme(readPreference());
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === null) reapply();
  };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  media?.addEventListener('change', reapply);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener('change', reapply);
  };
}

/** Roda no <head>, antes de pintar: grava o tema resolvido no <html>. Sem dependências. */
export const THEME_SCRIPT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var d=p==='dark'||(p!=='light'&&!!window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);document.documentElement.dataset.theme=d?'dark':'light'})()`;
