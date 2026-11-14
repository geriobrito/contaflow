import { NextResponse } from 'next/server';
import type { CepLookupResult, CepProviderOutcome } from '@/lib/cep';
import { isValidCEP } from '@/lib/cep';
import { cleanDigits } from '@/lib/utils/formatters';
import { authorizeLookup, createRateLimiter, type CnpjAuth } from '@/lib/server/cnpj-handler';

const DAY_MS = 86_400_000;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export interface CepHandlerOptions {
  auth: CnpjAuth;
  lookup: (cep: string) => Promise<CepProviderOutcome>;
  allowedUids?: readonly string[];
  limits?: { perMinute: number; perDay: number };
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
}

/**
 * Handler de `GET /api/cep/[cep]`: mesmo caminho da consulta de CNPJ (login → CEP válido →
 * limite por usuário → cache → provedores). O navegador só fala com o próprio app (CSP).
 */
export function createCepHandler(options: CepHandlerOptions) {
  const now = options.now ?? Date.now;
  const allowed = new Set(options.allowedUids ?? []);
  const limit = createRateLimiter(options.limits ?? { perMinute: 30, perDay: 300 }, now);
  const ttl = options.cacheTtlMs ?? 7 * DAY_MS;
  const maxEntries = options.cacheMaxEntries ?? 1000;
  const cache = new Map<string, { data: CepLookupResult; expiresAt: number }>();

  return async function GET(request: Request, { params }: { params: Promise<{ cep: string }> }): Promise<Response> {
    const who = await authorizeLookup(request, options.auth, allowed, 'CEP');
    if (who instanceof Response) return who;

    const cep = cleanDigits((await params).cep);
    if (!isValidCEP(cep)) return json({ error: 'CEP inválido.' }, 400);

    const retryAfter = limit(who);
    if (retryAfter !== null) {
      return json({ error: 'Muitas consultas de CEP em pouco tempo. Aguarde e tente de novo.' }, 429, { 'Retry-After': String(retryAfter) });
    }

    const headers = { 'Cache-Control': 'private, max-age=604800' };
    const hit = cache.get(cep);
    if (hit && hit.expiresAt > now()) return json(hit.data, 200, headers);
    cache.delete(cep);

    const outcome = await options.lookup(cep);
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
    cache.set(cep, { data: outcome.data, expiresAt: now() + ttl });
    return json(outcome.data, 200, headers);
  };
}
