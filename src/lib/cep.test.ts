import { describe, expect, it, vi } from 'vitest';
import { fetchCEPFromProviders, isValidCEP, mapBrasilApiCep, mapViaCep, maskCEP } from '@/lib/cep';
import { createCepHandler } from '@/lib/server/cep-handler';

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('consulta de CEP', () => {
  it('máscara e validação', () => {
    expect(maskCEP('51020000')).toBe('51020-000');
    expect(maskCEP('510')).toBe('510');
    expect(isValidCEP('51020-000')).toBe(true);
    expect(isValidCEP('00000-000')).toBe(false);
    expect(isValidCEP('5102')).toBe(false);
  });

  it('mapeia BrasilAPI e ViaCEP', () => {
    expect(mapBrasilApiCep({ cep: '51020000', state: 'pe', city: 'Recife', neighborhood: 'Boa Viagem', street: 'Avenida Boa Viagem', service: 'correios' })).toEqual({
      cep: '51020000',
      street: 'Avenida Boa Viagem',
      district: 'Boa Viagem',
      municipality: 'Recife',
      uf: 'PE',
      source: 'brasilapi',
    });
    expect(mapViaCep({ cep: '51020-000', logradouro: 'Avenida Boa Viagem', complemento: '', bairro: 'Boa Viagem', localidade: 'Recife', uf: 'PE' })).toEqual({
      cep: '51020000',
      street: 'Avenida Boa Viagem',
      district: 'Boa Viagem',
      municipality: 'Recife',
      uf: 'PE',
      source: 'viacep',
    });
    expect(mapViaCep({ erro: true })).toBeNull();
  });

  it('cai para o ViaCEP quando a BrasilAPI falha; 404 só quando o CEP não existe', async () => {
    const fallback = vi.fn().mockResolvedValueOnce(response(500, {})).mockResolvedValueOnce(response(200, { cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' }));
    expect(await fetchCEPFromProviders('01001000', fallback as unknown as typeof fetch)).toMatchObject({ ok: true, data: { municipality: 'São Paulo', source: 'viacep' } });
    const missing = vi.fn().mockResolvedValueOnce(response(404, {})).mockResolvedValueOnce(response(200, { erro: true }));
    expect(await fetchCEPFromProviders('99999999', missing as unknown as typeof fetch)).toEqual({ ok: false, status: 404, error: 'CEP não encontrado.' });
    const down = vi.fn().mockRejectedValue(new Error('rede'));
    expect(await fetchCEPFromProviders('01001000', down as unknown as typeof fetch)).toMatchObject({ ok: false, status: 502 });
  });

  it('rota: login, CEP válido, limite e cache', async () => {
    const lookup = vi.fn().mockResolvedValue({ ok: true, data: { cep: '01001000', municipality: 'São Paulo', uf: 'SP', source: 'brasilapi' } });
    const get = createCepHandler({ auth: { kind: 'firebase', verify: async (t) => (t === 'ok' ? 'u1' : Promise.reject(new Error('x'))) }, lookup, limits: { perMinute: 2, perDay: 10 } });
    const call = (cep: string, token?: string) =>
      get(new Request(`http://x/api/cep/${cep}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}), { params: Promise.resolve({ cep }) });

    expect((await call('01001000')).status).toBe(401);
    expect(await (await call('01001000')).json()).toEqual({ error: 'Faça login para consultar o CEP.' });
    expect((await call('01001000', 'ruim')).status).toBe(401);
    expect((await call('123', 'ok')).status).toBe(400);
    const first = await call('01001-000', 'ok');
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ municipality: 'São Paulo' });
    // A segunda vem do cache (o provedor não é chamado de novo); a terceira passa do limite por minuto.
    expect((await call('01001000', 'ok')).status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect((await call('01001000', 'ok')).status).toBe(429);
  });
});
