import { beforeEach, describe, expect, it, vi } from 'vitest';

type Captured = { error: unknown; tags: Record<string, string>; level?: string };
const captured: Captured[] = [];
let scope: Captured | null = null;
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: unknown) => void) => {
    scope = { error: null, tags: {} };
    fn({
      setTag: (k: string, v: string) => void (scope!.tags[k] = v),
      setLevel: (l: string) => void (scope!.level = l),
    });
    scope = null;
  },
  captureException: (e: unknown) => {
    if (scope) captured.push(Object.assign(scope, { error: e }));
  },
  setUser: vi.fn(),
}));

const { errorKind, reportError } = await import('@/lib/monitoring');

describe('reportError', () => {
  beforeEach(() => {
    captured.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('marca a área, a operação e o tipo (recusa das regras, importação ou erro comum)', () => {
    reportError(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }), { area: 'dre', op: 'carregar' });
    expect(captured[0]).toMatchObject({ tags: { area: 'dre', op: 'carregar', kind: 'regra', code: 'permission-denied' }, level: 'error' });
    expect(errorKind(new Error('OFX inválido'), 'importacao')).toBe('importacao');
    expect(errorKind(new Error('x'), 'dre')).toBe('erro');
  });

  it('falha contornada vai como aviso', () => {
    reportError(new Error('sem snapshot'), { area: 'livros', level: 'warning' });
    expect(captured[0]).toMatchObject({ level: 'warning' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('erro de digitação no login não vai ao monitoramento (mas segue no console)', () => {
    reportError(Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), { code: 'auth/invalid-credential' }), { area: 'login', op: 'entrar' });
    expect(captured).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});
