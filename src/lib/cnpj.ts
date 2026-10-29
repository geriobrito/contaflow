import type { CompanyPorte, TaxRegime } from '@/types/firestore';
import { cleanCNPJ, cleanDigits } from '@/lib/utils/formatters';

export interface CNPJLookupResult {
  cnpj: string;
  name: string;
  tradeName?: string;
  city?: string;
  regime?: TaxRegime;
  porte?: CompanyPorte;
  email?: string;
  phone?: string;
  legalRepresentativeName?: string;
  situacaoCadastral?: string;
  source: 'brasilapi' | 'cnpjws';
}

const LOWERCASE_WORDS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/** Formata município e UF no padrão usado nos termos contábeis (ex.: "Recife/PE", "São Paulo/SP"). */
export function formatCityUF(municipio?: string | null, uf?: string | null): string | undefined {
  const rawCity = (municipio ?? '').trim();
  const rawUf = (uf ?? '').trim().toUpperCase();
  if (!rawCity && !rawUf) return undefined;

  const formattedCity = rawCity
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      if (idx > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  if (formattedCity && rawUf) return `${formattedCity}/${rawUf}`;
  return formattedCity || rawUf;
}

/** Formata telefone brasileiro com DDD (10 ou 11 dígitos). */
export function formatBrazilianPhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const d = cleanDigits(raw);
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return d.length >= 8 ? raw.trim() : undefined;
}

function normalizeEmail(raw?: string | null): string | undefined {
  const email = (raw ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function inferPorte(args: { isMei?: boolean; codigoPorte?: number | string | null; descricaoPorte?: string | null }): CompanyPorte | undefined {
  if (args.isMei) return 'MICROENTIDADE';
  const code = Number(args.codigoPorte);
  if (code === 1 || code === 2) return 'MICROENTIDADE';
  if (code === 3 || code === 5) return 'PEQUENA_EMPRESA';

  const desc = (args.descricaoPorte ?? '').toUpperCase();
  if (!desc) return undefined;
  if (desc.includes('MICRO') || /\bME\b/.test(desc)) return 'MICROENTIDADE';
  if (desc.includes('PEQUENO') || /\bEPP\b/.test(desc) || desc.includes('DEMAIS')) return 'PEQUENA_EMPRESA';
  return undefined;
}

function pickAdministrator(
  partners: readonly { name?: string | null; role?: string | null; roleCode?: number | string | null }[]
): string | undefined {
  const valid = partners.filter((p) => Boolean(p.name && p.name.trim()));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0].name!.trim();

  const adminCodes = new Set(['5', '05', '10', '16', '49', '65']);
  const admin = valid.find((p) => {
    const code = p.roleCode !== undefined && p.roleCode !== null ? String(p.roleCode).trim() : '';
    const role = (p.role ?? '').toLowerCase();
    return (
      adminCodes.has(code) ||
      role.includes('administrador') ||
      role.includes('presidente') ||
      role.includes('diretor') ||
      role.includes('titular')
    );
  });
  return admin?.name?.trim();
}

/** Mapeia o payload da BrasilAPI (`GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`). */
export function mapBrasilApiResponse(raw: unknown): CNPJLookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const name = typeof data.razao_social === 'string' ? data.razao_social.trim() : '';
  const cnpj = typeof data.cnpj === 'string' ? cleanCNPJ(data.cnpj) : '';
  if (!name || !cnpj) return null;

  const isMei = data.opcao_pelo_mei === true;
  const isSimples = data.opcao_pelo_simples === true;
  const regime: TaxRegime | undefined = isMei ? 'MEI' : isSimples ? 'SIMPLES_NACIONAL' : undefined;
  const porte = inferPorte({
    isMei,
    codigoPorte: data.codigo_porte as number | string | null | undefined,
    descricaoPorte: typeof data.porte === 'string' ? data.porte : undefined,
  });

  const qsa = Array.isArray(data.qsa) ? (data.qsa as Record<string, unknown>[]) : [];
  const legalRepresentativeName = pickAdministrator(
    qsa.map((s) => ({
      name: typeof s.nome_socio === 'string' ? s.nome_socio : undefined,
      role: typeof s.qualificacao_socio === 'string' ? s.qualificacao_socio : undefined,
      roleCode: s.codigo_qualificacao_socio as number | string | null | undefined,
    }))
  );

  const tradeName = typeof data.nome_fantasia === 'string' && data.nome_fantasia.trim() ? data.nome_fantasia.trim() : undefined;
  const city = formatCityUF(
    typeof data.municipio === 'string' ? data.municipio : undefined,
    typeof data.uf === 'string' ? data.uf : undefined
  );
  const email = normalizeEmail(typeof data.email === 'string' ? data.email : undefined);
  const phone = formatBrazilianPhone(typeof data.ddd_telefone_1 === 'string' ? data.ddd_telefone_1 : undefined);
  const situacaoCadastral =
    typeof data.descricao_situacao_cadastral === 'string' && data.descricao_situacao_cadastral.trim()
      ? data.descricao_situacao_cadastral.trim()
      : undefined;

  return {
    cnpj,
    name,
    ...(tradeName ? { tradeName } : {}),
    ...(city ? { city } : {}),
    ...(regime ? { regime } : {}),
    ...(porte ? { porte } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(legalRepresentativeName ? { legalRepresentativeName } : {}),
    ...(situacaoCadastral ? { situacaoCadastral } : {}),
    source: 'brasilapi',
  };
}

/** Mapeia o payload da API pública CNPJ.ws (`GET https://publica.cnpj.ws/cnpj/{cnpj}`). */
export function mapCnpjWsResponse(raw: unknown): CNPJLookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const estab = (data.estabelecimento && typeof data.estabelecimento === 'object'
    ? data.estabelecimento
    : {}) as Record<string, unknown>;
  const simples = (data.simples && typeof data.simples === 'object' ? data.simples : {}) as Record<string, unknown>;
  const porteObj = (data.porte && typeof data.porte === 'object' ? data.porte : {}) as Record<string, unknown>;
  const cidade = (estab.cidade && typeof estab.cidade === 'object' ? estab.cidade : {}) as Record<string, unknown>;
  const estado = (estab.estado && typeof estab.estado === 'object' ? estab.estado : {}) as Record<string, unknown>;

  const name = typeof data.razao_social === 'string' ? data.razao_social.trim() : '';
  const rawCnpj = typeof estab.cnpj === 'string' ? estab.cnpj : typeof data.cnpj_raiz === 'string' ? data.cnpj_raiz : '';
  const cnpj = cleanCNPJ(rawCnpj);
  if (!name || cnpj.length !== 14) return null;

  const isMei = simples.mei === 'Sim' || simples.mei === true;
  const isSimples = simples.simples === 'Sim' || simples.simples === true;
  const regime: TaxRegime | undefined = isMei ? 'MEI' : isSimples ? 'SIMPLES_NACIONAL' : undefined;
  const porte = inferPorte({
    isMei,
    codigoPorte: porteObj.id as string | number | null | undefined,
    descricaoPorte: typeof porteObj.descricao === 'string' ? porteObj.descricao : undefined,
  });

  const socios = Array.isArray(data.socios) ? (data.socios as Record<string, unknown>[]) : [];
  const legalRepresentativeName = pickAdministrator(
    socios.map((s) => {
      const qual = (s.qualificacao_socio && typeof s.qualificacao_socio === 'object'
        ? s.qualificacao_socio
        : {}) as Record<string, unknown>;
      return {
        name: typeof s.nome === 'string' ? s.nome : undefined,
        role: typeof qual.descricao === 'string' ? qual.descricao : undefined,
        roleCode: qual.id as number | string | null | undefined,
      };
    })
  );

  const tradeName = typeof estab.nome_fantasia === 'string' && estab.nome_fantasia.trim() ? estab.nome_fantasia.trim() : undefined;
  const city = formatCityUF(
    typeof cidade.nome === 'string' ? cidade.nome : undefined,
    typeof estado.sigla === 'string' ? estado.sigla : undefined
  );
  const email = normalizeEmail(typeof estab.email === 'string' ? estab.email : undefined);
  const ddd = typeof estab.ddd1 === 'string' ? estab.ddd1 : '';
  const tel = typeof estab.telefone1 === 'string' ? estab.telefone1 : '';
  const phone = formatBrazilianPhone(`${ddd}${tel}`);
  const situacaoCadastral =
    typeof estab.situacao_cadastral === 'string' && estab.situacao_cadastral.trim()
      ? estab.situacao_cadastral.trim()
      : undefined;

  return {
    cnpj,
    name,
    ...(tradeName ? { tradeName } : {}),
    ...(city ? { city } : {}),
    ...(regime ? { regime } : {}),
    ...(porte ? { porte } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(legalRepresentativeName ? { legalRepresentativeName } : {}),
    ...(situacaoCadastral ? { situacaoCadastral } : {}),
    source: 'cnpjws',
  };
}

export type CNPJProviderOutcome =
  | { ok: true; data: CNPJLookupResult }
  | { ok: false; status: 404 | 502; error: string };

/**
 * Consulta provedores públicos de CNPJ com timeout curto e fallback automático:
 * 1. BrasilAPI (`brasilapi.com.br`)
 * 2. Pública CNPJ.ws (`publica.cnpj.ws`)
 */
export async function fetchCNPJFromProviders(
  rawCnpj: string,
  fetchImpl: typeof fetch = fetch
): Promise<CNPJProviderOutcome> {
  const cnpj = cleanCNPJ(rawCnpj);
  let sawNotFound = false;

  const providers: {
    url: string;
    mapper: (json: unknown) => CNPJLookupResult | null;
  }[] = [
    {
      url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      mapper: mapBrasilApiResponse,
    },
    {
      url: `https://publica.cnpj.ws/cnpj/${cnpj}`,
      mapper: mapCnpjWsResponse,
    },
  ];

  for (const provider of providers) {
    try {
      const response = await fetchImpl(provider.url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.status === 404) {
        sawNotFound = true;
        continue;
      }
      if (!response.ok) {
        continue;
      }

      const json: unknown = await response.json();
      const mapped = provider.mapper(json);
      if (mapped) {
        return { ok: true, data: mapped };
      }
    } catch {
      // Tenta o próximo provedor em caso de timeout ou erro de rede
    }
  }

  if (sawNotFound) {
    return { ok: false, status: 404, error: 'CNPJ não encontrado na base pública da Receita Federal.' };
  }
  return { ok: false, status: 502, error: 'Serviço público de consulta de CNPJ temporariamente indisponível.' };
}

