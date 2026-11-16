import { NextResponse } from 'next/server';
import type { CNPJLookupResult, CNPJProviderOutcome } from '@/lib/cnpj';
import { cleanCNPJ, isValidCNPJ } from '@/lib/utils/formatters';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Como a rota confere quem chama:
 * - `firebase`: exige o ID token do Firebase (`Authorization: Bearer`) e devolve o uid;
 * - `local`: modo local, sem Firebase (só fora de produção), sem login;
 * - `unavailable`: produção sem Firebase configurado — a consulta fica desligada.
 */
export type CnpjAuth =
  | { kind: 'firebase'; verify: (idToken: string) => Promise<string> }
  | { kind: 'local' }
  | { kind: 'unavailable' };

export interface CnpjHandlerOptions {
  auth: CnpjAuth;
  lookup: (cnpj: string) => Promise<CNPJProviderOutcome>;
  /** Se não vazia, só estes uids consultam (CNPJ_ALLOWED_UIDS). */
  allowedUids?: readonly string[];
  limits?: { perMinute: number; perDay: number };
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
}

/**
 * Limite por usuário em janelas de 1 minuto e 1 dia. Fica na memória da instância: na Vercel
 * cada instância conta a sua parte, então o limite é aproximado (suficiente para um escritório).
 * Devolve null se a chamada pode seguir, ou os segundos até a próxima liberação.
 */
export function createRateLimiter(limits: { perMinute: number; perDay: number }, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string): number | null => {
    const t = now();
    const today = (hits.get(key) ?? []).filter((h) => t - h < DAY_MS);
    const lastMinute = today.filter((h) => t - h < MINUTE_MS);
    let waitMs = 0;
    if (today.length >= limits.perDay) waitMs = today[today.length - limits.perDay] + DAY_MS - t;
    else if (lastMinute.length >= limits.perMinute) waitMs = lastMinute[lastMinute.length - limits.perMinute] + MINUTE_MS - t;
    if (waitMs > 0) {
      hits.set(key, today);
      return Math.max(1, Math.ceil(waitMs / 1000));
    }
    today.push(t);
    hits.set(key, today);
    return null;
  };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const bearer = (request: Request): string | null => {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match ? match[1] : null;
};

/**
 * Quem está consultando (uid, ou 'local' no modo local), ou a resposta de recusa. Compartilhado
 * pelas consultas públicas do cadastro (CNPJ e CEP): só usuário logado do escritório.
 */
export async function authorizeLookup(request: Request, auth: CnpjAuth, allowed: ReadonlySet<string>, subject: 'CNPJ' | 'CEP'): Promise<string | Response> {
  if (auth.kind === 'unavailable') return json({ error: `Consulta de ${subject} indisponível: Firebase não configurado no servidor.` }, 503);
  if (auth.kind === 'local') return 'local';
  const token = bearer(request);
  if (!token) return json({ error: `Faça login para consultar o ${subject}.` }, 401);
  let caller: string;
  try {
    caller = await auth.verify(token);
  } catch {
    return json({ error: `Sessão inválida ou expirada. Entre de novo para consultar o ${subject}.` }, 401);
  }
  if (allowed.size && !allowed.has(caller)) return json({ error: `Usuário sem permissão para consultar ${subject}.` }, 403);
  return caller;
}

/**
 * Handler de `GET /api/cnpj/[cnpj]`: login → CNPJ válido → limite → cache → provedores.
 * A resposta é `private` (só o navegador guarda): uma CDN não pode servi-la sem passar pelo login.
 */
export function createCnpjHandler(options: CnpjHandlerOptions) {
  const now = options.now ?? Date.now;
  const allowed = new Set(options.allowedUids ?? []);
  const limit = createRateLimiter(options.limits ?? { perMinute: 20, perDay: 200 }, now);
  const ttl = options.cacheTtlMs ?? DAY_MS;
  const maxEntries = options.cacheMaxEntries ?? 500;
  const cache = new Map<string, { data: CNPJLookupResult; expiresAt: number }>();

  return async function GET(request: Request, { params }: { params: Promise<{ cnpj: string }> }): Promise<Response> {
    const who = await authorizeLookup(request, options.auth, allowed, 'CNPJ');
    if (who instanceof Response) return who;
    const caller = who;

    const cnpj = cleanCNPJ((await params).cnpj);
    if (cnpj.length !== 14 || !isValidCNPJ(cnpj)) {
      return json({ error: 'CNPJ inválido.' }, 400);
    }

    const retryAfter = limit(caller);
    if (retryAfter !== null) {
      return json({ error: 'Muitas consultas de CNPJ em pouco tempo. Aguarde e tente de novo.' }, 429, { 'Retry-After': String(retryAfter) });
    }

    // O navegador não guarda a resposta: um cadastro consultado antes viria sem os campos novos
    // (cartão CNPJ, QSA) ou desatualizado. O cache fica só aqui, e "Atualizar pela Receita"
    // (`?atualizar=1`) passa por cima dele para trazer a situação de hoje.
    const headers = { 'Cache-Control': 'private, no-store' };
    const refresh = new URL(request.url).searchParams.get('atualizar') === '1';
    const hit = cache.get(cnpj);
    if (!refresh && hit && hit.expiresAt > now()) return json(hit.data, 200, headers);
    cache.delete(cnpj);

    // Falha inesperada na consulta também responde em JSON, com o motivo: a tela mostra o texto.
    let outcome: CNPJProviderOutcome;
    try {
      outcome = await options.lookup(cnpj);
    } catch {
      return json({ error: 'Não foi possível consultar o CNPJ agora. Tente de novo em instantes ou preencha os campos manualmente.' }, 502);
    }
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);

    // Map guarda a ordem de inclusão: ao encher, sai o mais antigo.
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
    cache.set(cnpj, { data: outcome.data, expiresAt: now() + ttl });
    return json(outcome.data, 200, headers);
  };
}
