import { describe, expect, it, vi } from 'vitest';
import type { CNPJProviderOutcome } from '@/lib/cnpj';
import { createCnpjHandler, createRateLimiter, type CnpjHandlerOptions } from '@/lib/server/cnpj-handler';

const CNPJ = '11222333000181';
const FOUND: CNPJProviderOutcome = { ok: true, data: { cnpj: CNPJ, name: 'EMPRESA TESTE LTDA', source: 'brasilapi' } };

const firebase = (uidByToken: Record<string, string> = { 'token-ok': 'uid-1' }): CnpjHandlerOptions['auth'] => ({
  kind: 'firebase',
  verify: async (token) => {
    const uid = uidByToken[token];
    if (!uid) throw new Error('auth/argument-error');
    return uid;
  },
});

function setup(overrides: Partial<CnpjHandlerOptions> = {}) {
  const lookup = vi.fn(async () => FOUND);
  const GET = createCnpjHandler({ auth: firebase(), lookup, ...overrides });
  const call = (token?: string, cnpj = CNPJ) =>
    GET(new Request(`http://localhost/api/cnpj/${cnpj}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}), {
      params: Promise.resolve({ cnpj }),
    });
  return { call, lookup };
}

describe('GET /api/cnpj/[cnpj]', () => {
  it('sem token → 401, sem consultar os provedores', async () => {
    const { call, lookup } = setup();
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('token inválido → 401', async () => {
    const { call, lookup } = setup();
    expect((await call('forjado')).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uid fora de CNPJ_ALLOWED_UIDS → 403', async () => {
    const { call } = setup({ auth: firebase({ 'token-ok': 'uid-1', outro: 'uid-2' }), allowedUids: ['uid-1'] });
    expect((await call('outro')).status).toBe(403);
    expect((await call('token-ok')).status).toBe(200);
  });

  it('tudo certo → 200 com os dados, cache só no navegador (private)', async () => {
    const { call } = setup();
    const res = await call('token-ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cnpj: CNPJ, name: 'EMPRESA TESTE LTDA' });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
  });

  it('CNPJ inválido → 400, sem contar no limite', async () => {
    const { call, lookup } = setup({ limits: { perMinute: 1, perDay: 10 } });
    expect((await call('token-ok', '11222333000100')).status).toBe(400);
    expect((await call('token-ok')).status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('acima do limite → 429 com Retry-After', async () => {
    let now = 1_000_000;
    const { call } = setup({ limits: { perMinute: 2, perDay: 100 }, now: () => now });
    expect((await call('token-ok')).status).toBe(200);
    expect((await call('token-ok')).status).toBe(200);
    const blocked = await call('token-ok');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    now += 60_000;
    expect((await call('token-ok')).status).toBe(200);
  });

  it('repete o mesmo CNPJ do cache em memória, sem nova consulta aos provedores', async () => {
    let now = 0;
    const { call, lookup } = setup({ cacheTtlMs: 1000, now: () => now });
    await call('token-ok');
    await call('token-ok');
    expect(lookup).toHaveBeenCalledTimes(1);
    now += 1001;
    await call('token-ok');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('erro dos provedores é repassado e não fica em cache', async () => {
    const lookup = vi.fn(async (): Promise<CNPJProviderOutcome> => ({ ok: false, status: 404, error: 'CNPJ não encontrado.' }));
    const { call } = setup({ lookup });
    expect((await call('token-ok')).status).toBe(404);
    await call('token-ok');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('modo local atende sem login; produção sem Firebase fica desligada (503)', async () => {
    expect((await setup({ auth: { kind: 'local' } }).call()).status).toBe(200);
    expect((await setup({ auth: { kind: 'unavailable' } }).call('token-ok')).status).toBe(503);
  });
});

describe('createRateLimiter', () => {
  it('conta por usuário e aplica o limite diário', () => {
    let now = 0;
    const limit = createRateLimiter({ perMinute: 100, perDay: 3 }, () => now);
    expect([limit('a'), limit('a'), limit('a')]).toEqual([null, null, null]);
    expect(limit('a')).toBeGreaterThan(60);
    expect(limit('b')).toBeNull();
    now += 86_400_000;
    expect(limit('a')).toBeNull();
  });
});
