/** Mensagem de um erro qualquer, para compor o aviso ao usuário. */
export const describeError = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

/** Verdadeiro quando o Firestore recusou a operação pelas regras de segurança. */
export function isPermissionDenied(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  if (code === 'permission-denied' || code === 'PERMISSION_DENIED') return true;
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' && /Missing or insufficient permissions|PERMISSION_DENIED/i.test(message);
}

/** Traduz `permission-denied` do Firestore para uma mensagem clara ao usuário, preservando `code`. */
export function rethrowPermissionDenied(e: unknown, reason: string): never {
  if (isPermissionDenied(e)) {
    throw Object.assign(new Error(reason), { code: 'permission-denied', cause: e });
  }
  throw e;
}

/**
 * Conflito de concorrência otimista ao gravar um cadastro único por empresa
 * (outro usuário salvou alterações depois da última leitura).
 */
export class RegisterConflictError extends Error {
  readonly code = 'conflict' as const;

  constructor(
    message = 'Este cadastro foi alterado por outro usuário desde que você abriu a tela. Os dados foram recarregados — revise e tente novamente.'
  ) {
    super(message);
    this.name = 'RegisterConflictError';
  }
}

export function isRegisterConflictError(e: unknown): e is RegisterConflictError {
  if (e instanceof RegisterConflictError) return true;
  return Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'conflict');
}
