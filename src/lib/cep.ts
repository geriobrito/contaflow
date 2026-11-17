import type { CompanyAddress } from '@/types/firestore';
import { DIRECT_HEADERS, PROVIDER_HEADERS, type ProviderLookupOptions } from '@/lib/cnpj';
import { cleanDigits } from '@/lib/utils/formatters';

/**
 * Consulta de endereço pelo CEP, no servidor (src/app/api/cep). A API oficial dos Correios (CWS)
 * exige contrato e credenciais; aqui vão as públicas, na ordem:
 *   1. BrasilAPI CEP v2 — consulta a base dos Correios e outras, com fallback próprio;
 *   2. ViaCEP — base dos Correios mantida pelo projeto ViaCEP.
 */

export interface CepLookupResult extends CompanyAddress {
  cep: string;
  source: 'brasilapi' | 'viacep';
}

export type CepProviderOutcome = { ok: true; data: CepLookupResult } | { ok: false; status: 404 | 502; error: string };

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : undefined);
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Máscara 00000-000 enquanto digita. */
export function maskCEP(value: string): string {
  const d = cleanDigits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** CEP com 8 dígitos e não zerado. */
export const isValidCEP = (value: string): boolean => /^\d{8}$/.test(cleanDigits(value)) && !/^0{8}$/.test(cleanDigits(value));

export function mapBrasilApiCep(raw: unknown): CepLookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const cep = cleanDigits(text(d.cep) ?? '');
  if (cep.length !== 8 || !text(d.city)) return null;
  return clean({ cep, street: text(d.street), district: text(d.neighborhood), municipality: text(d.city), uf: text(d.state)?.toUpperCase(), source: 'brasilapi' as const });
}

export function mapViaCep(raw: unknown): CepLookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.erro) return null;
  const cep = cleanDigits(text(d.cep) ?? '');
  if (cep.length !== 8 || !text(d.localidade)) return null;
  return clean({
    cep,
    street: text(d.logradouro),
    complement: text(d.complemento),
    district: text(d.bairro),
    municipality: text(d.localidade),
    uf: text(d.uf)?.toUpperCase(),
    source: 'viacep' as const,
  });
}

/** Provedores em ordem, com timeout curto; 404 só se nenhum achou e algum respondeu "não existe". */
export async function fetchCEPFromProviders(
  rawCep: string,
  fetchImpl: typeof fetch = fetch,
  { direct = false, signal }: ProviderLookupOptions = {}
): Promise<CepProviderOutcome> {
  const cep = cleanDigits(rawCep);
  let sawNotFound = false;
  const providers = [
    { url: `https://brasilapi.com.br/api/cep/v2/${cep}`, map: mapBrasilApiCep },
    { url: `https://viacep.com.br/ws/${cep}/json/`, map: mapViaCep },
  ];
  for (const p of providers) {
    if (signal?.aborted) break;
    try {
      const timeout = AbortSignal.timeout(direct ? 8000 : 5000);
      // `direct`: consulta pelo navegador (os dois provedores têm CORS aberto), só com `Accept`.
      const res = await fetchImpl(p.url, { headers: direct ? DIRECT_HEADERS : PROVIDER_HEADERS, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (res.status === 404) {
        sawNotFound = true;
        continue;
      }
      if (!res.ok) continue;
      const json: unknown = await res.json();
      const mapped = p.map(json);
      if (mapped) return { ok: true, data: mapped };
      // ViaCEP responde 200 com { erro: true } para CEP inexistente.
      if (json && typeof json === 'object' && (json as Record<string, unknown>).erro) sawNotFound = true;
    } catch {
      // Timeout ou rede: tenta o próximo.
    }
  }
  return sawNotFound
    ? { ok: false, status: 404, error: 'CEP não encontrado.' }
    : { ok: false, status: 502, error: 'Consulta de CEP temporariamente indisponível — preencha o endereço manualmente.' };
}
