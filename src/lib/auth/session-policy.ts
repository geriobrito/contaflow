/**
 * Validade da sessão no navegador: sai sozinha após 30 minutos sem uso ou 12 horas depois do
 * login, o que vier primeiro. O Firebase guarda o login indefinidamente; esta política é aplicada
 * pelo app ao abrir e durante o uso, antes de qualquer dado ser carregado.
 *
 * O último uso fica no localStorage, compartilhado entre as abas: usar uma aba mantém as outras
 * ativas, e quem volta no dia seguinte encontra o registro antigo e cai no login.
 */

export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const MAX_SESSION_MS = 12 * 3_600_000;
/** Antecedência do aviso de saída por inatividade (com opção de continuar). */
export const IDLE_WARNING_MS = 60_000;
/** Antecedência do aviso do fim da sessão máxima (não dá para estender). */
export const MAX_WARNING_MS = 5 * 60_000;

export type SessionEndReason = 'idle' | 'max';

export interface SessionStatus {
  /** Motivo da expiração; null enquanto a sessão vale. */
  expired: SessionEndReason | null;
  /** Aviso a mostrar antes de expirar; null fora da janela de aviso. */
  warning: SessionEndReason | null;
  /** Tempo até a próxima expiração (inatividade ou limite), em ms. */
  remainingMs: number;
}

/**
 * Situação da sessão em `now`. `signedInAt` é o momento do login (o `auth_time` do token);
 * `lastActivityAt`, o último uso registrado. Um login mais recente que o último uso conta como
 * uso: entrar de novo depois de expirar não derruba a sessão nova pelo registro antigo.
 */
export function sessionStatus(signedInAt: number, lastActivityAt: number | null, now: number): SessionStatus {
  const lastUse = Math.max(lastActivityAt ?? now, signedInAt);
  const idleLeft = lastUse + IDLE_TIMEOUT_MS - now;
  const maxLeft = signedInAt + MAX_SESSION_MS - now;
  const remainingMs = Math.max(0, Math.min(idleLeft, maxLeft));
  if (maxLeft <= 0) return { expired: 'max', warning: null, remainingMs };
  if (idleLeft <= 0) return { expired: 'idle', warning: null, remainingMs };
  const warning: SessionEndReason | null = maxLeft <= MAX_WARNING_MS && maxLeft <= idleLeft ? 'max' : idleLeft <= IDLE_WARNING_MS ? 'idle' : null;
  return { expired: null, warning, remainingMs };
}

export const SESSION_END_MESSAGE: Record<SessionEndReason, string> = {
  idle: 'Sua sessão foi encerrada após 30 minutos sem uso. Entre novamente para continuar.',
  max: 'Por segurança, a sessão dura no máximo 12 horas. Entre novamente para continuar.',
};

/* Registro do último uso (localStorage, compartilhado entre abas). */

export const LAST_ACTIVITY_KEY = 'contaflow_last_activity';

export function readLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastActivity(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* armazenamento indisponível: a aba segue só com o próprio relógio */
  }
}

export function clearLastActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* armazenamento indisponível */
  }
}
