import type { CodeDescription, CompanyAddress, CompanyPartner, CompanyRegistration } from '@/types/firestore';
import { cleanDigits } from '@/lib/utils/formatters';

/**
 * Cartão CNPJ e QSA a partir das respostas públicas da Receita (BrasilAPI e CNPJ.ws): tudo o
 * que o Comprovante de Inscrição e de Situação Cadastral mostra, além dos campos simples do
 * cadastro (src/lib/cnpj.ts), e o Quadro de Sócios e Administradores.
 */

export interface CnpjCard {
  address?: CompanyAddress;
  registration: CompanyRegistration;
  partners: CompanyPartner[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
};
/** Data YYYY-MM-DD (aceita também DD/MM/AAAA); outros formatos e datas vazias somem. */
export function isoDate(v: unknown): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[1] === '0000' ? undefined : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : undefined;
}
const money = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const yes = (v: unknown) => v === true || v === 'Sim' || v === 'S';
/** Tira chaves vazias (o Firestore recusa `undefined`, e o cadastro fica limpo). */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))) as T;
}

/** CNAE no formato do cartão: 4711302 → "47.11-3-02". */
export function formatCnae(raw: unknown): string | undefined {
  const d = cleanDigits(text(raw) ?? '');
  if (d.length !== 7 || /^0+$/.test(d)) return text(raw);
  return `${d.slice(0, 2)}.${d.slice(2, 4)}-${d.slice(4, 5)}-${d.slice(5)}`;
}

/** Natureza jurídica no formato do cartão: 2062 → "206-2". */
export function formatLegalNatureCode(raw: unknown): string | undefined {
  const d = cleanDigits(text(raw) ?? '');
  return d.length === 4 ? `${d.slice(0, 3)}-${d.slice(3)}` : text(raw);
}

/** Documento do sócio: CPF mascarado pela Receita (***123456**) vira ***.123.456-**; CNPJ ganha máscara. */
export function formatPartnerDocument(raw: unknown): string | undefined {
  const t = (text(raw) ?? '').replace(/[.\-/\s]/g, '');
  // A Receita manda ***000000** quando não há documento (ex.: sócio sem representante).
  if (!t || /^[*0]+$/.test(t)) return undefined;
  if (t.length === 11) return `${t.slice(0, 3)}.${t.slice(3, 6)}.${t.slice(6, 9)}-${t.slice(9)}`;
  if (t.length === 14) return `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}/${t.slice(8, 12)}-${t.slice(12)}`;
  return text(raw);
}

const activity = (code: unknown, description: unknown): CodeDescription | undefined => {
  const c = formatCnae(code);
  const d = text(description);
  return c && d ? { code: c, description: d } : undefined;
};

/** "206-2 - Sociedade Empresária Limitada" ou código e descrição separados. */
function legalNature(code: unknown, description: unknown): CodeDescription | undefined {
  const d = text(description);
  if (!d) return undefined;
  const joined = /^(\d{3}-?\d)\s*-\s*(.+)$/.exec(d);
  if (joined) return { code: formatLegalNatureCode(joined[1]) ?? joined[1], description: joined[2].trim() };
  const c = formatLegalNatureCode(code);
  return c ? { code: c, description: d } : { code: '', description: d };
}

const street = (type: unknown, name: unknown) => {
  const t = text(type);
  const n = text(name);
  if (!n) return undefined;
  return t && !n.toUpperCase().startsWith(t.toUpperCase()) ? `${t} ${n}` : n;
};

const phone = (ddd: unknown, number: unknown): string | undefined => {
  const d = cleanDigits(`${text(ddd) ?? ''}${text(number) ?? ''}`);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return undefined;
};

/** Payload da BrasilAPI (`/api/cnpj/v1/{cnpj}`). */
export function brasilApiCard(raw: unknown): CnpjCard {
  const d = obj(raw);
  const address = compact<CompanyAddress>({
    cep: cleanDigits(text(d.cep) ?? '') || undefined,
    street: street(d.descricao_tipo_de_logradouro, d.logradouro),
    number: text(d.numero),
    complement: text(d.complemento),
    district: text(d.bairro),
    municipality: text(d.municipio),
    uf: text(d.uf)?.toUpperCase(),
  });
  const secondary = list(d.cnaes_secundarios)
    .map((a) => activity(a.codigo, a.descricao))
    .filter((a): a is CodeDescription => Boolean(a));
  const registration = compact<CompanyRegistration>({
    branch: Number(d.identificador_matriz_filial) === 2 ? 'FILIAL' : Number(d.identificador_matriz_filial) === 1 ? 'MATRIZ' : undefined,
    openedAt: isoDate(d.data_inicio_atividade),
    legalNature: legalNature(d.codigo_natureza_juridica, d.natureza_juridica),
    mainActivity: activity(d.cnae_fiscal, d.cnae_fiscal_descricao),
    secondaryActivities: secondary,
    sizeLabel: text(d.porte),
    efr: text(d.ente_federativo_responsavel),
    status: text(d.descricao_situacao_cadastral),
    statusDate: isoDate(d.data_situacao_cadastral),
    statusReason: text(d.descricao_motivo_situacao_cadastral),
    specialStatus: text(d.situacao_especial),
    specialStatusDate: isoDate(d.data_situacao_especial),
    shareCapital: money(d.capital_social),
    phone2: phone(undefined, d.ddd_telefone_2),
    simples: compact({ optant: yes(d.opcao_pelo_simples), since: isoDate(d.data_opcao_pelo_simples), until: isoDate(d.data_exclusao_do_simples) }),
    mei: compact({ optant: yes(d.opcao_pelo_mei), since: isoDate(d.data_opcao_pelo_mei), until: isoDate(d.data_exclusao_do_mei) }),
    source: 'brasilapi',
  });
  const partners = list(d.qsa)
    .map((s) =>
      compact<CompanyPartner>({
        name: text(s.nome_socio) ?? '',
        document: formatPartnerDocument(s.cnpj_cpf_do_socio),
        role: text(s.qualificacao_socio),
        roleCode: text(s.codigo_qualificacao_socio),
        since: isoDate(s.data_entrada_sociedade),
        ageRange: text(s.faixa_etaria),
        country: text(s.pais),
        representativeName: text(s.nome_representante_legal),
        representativeDocument: formatPartnerDocument(s.cpf_representante_legal),
        representativeRole: text(s.qualificacao_representante_legal),
      })
    )
    .filter((p) => p.name);
  return { ...(Object.keys(address).length ? { address } : {}), registration, partners };
}

/** Payload da CNPJ.ws pública (`/cnpj/{cnpj}`). */
export function cnpjWsCard(raw: unknown): CnpjCard {
  const d = obj(raw);
  const e = obj(d.estabelecimento);
  const simples = obj(d.simples);
  const address = compact<CompanyAddress>({
    cep: cleanDigits(text(e.cep) ?? '') || undefined,
    street: street(e.tipo_logradouro, e.logradouro),
    number: text(e.numero),
    complement: text(e.complemento),
    district: text(e.bairro),
    municipality: text(obj(e.cidade).nome),
    uf: text(obj(e.estado).sigla)?.toUpperCase(),
  });
  const principal = obj(e.atividade_principal);
  const registration = compact<CompanyRegistration>({
    branch: /filial/i.test(text(e.tipo) ?? '') ? 'FILIAL' : /matriz/i.test(text(e.tipo) ?? '') ? 'MATRIZ' : undefined,
    openedAt: isoDate(e.data_inicio_atividade),
    legalNature: legalNature(obj(d.natureza_juridica).id, obj(d.natureza_juridica).descricao),
    mainActivity: activity(principal.subclasse ?? principal.id, principal.descricao),
    secondaryActivities: list(e.atividades_secundarias)
      .map((a) => activity(a.subclasse ?? a.id, a.descricao))
      .filter((a): a is CodeDescription => Boolean(a)),
    sizeLabel: text(obj(d.porte).descricao),
    status: text(e.situacao_cadastral),
    statusDate: isoDate(e.data_situacao_cadastral),
    statusReason: text(obj(e.motivo_situacao_cadastral).descricao),
    specialStatus: text(e.situacao_especial),
    specialStatusDate: isoDate(e.data_situacao_especial),
    shareCapital: money(d.capital_social),
    phone2: phone(e.ddd2, e.telefone2),
    simples: compact({ optant: yes(simples.simples), since: isoDate(simples.data_opcao_simples), until: isoDate(simples.data_exclusao_simples) }),
    mei: compact({ optant: yes(simples.mei), since: isoDate(simples.data_opcao_mei), until: isoDate(simples.data_exclusao_mei) }),
    source: 'cnpjws',
  });
  const partners = list(d.socios)
    .map((s) =>
      compact<CompanyPartner>({
        name: text(s.nome) ?? '',
        document: formatPartnerDocument(s.cpf_cnpj_socio),
        role: text(obj(s.qualificacao_socio).descricao),
        roleCode: text(obj(s.qualificacao_socio).id),
        since: isoDate(s.data_entrada),
        ageRange: text(s.faixa_etaria),
        country: text(obj(s.pais).nome),
        representativeName: text(s.nome_representante),
        representativeDocument: formatPartnerDocument(s.cpf_representante_legal),
        representativeRole: text(obj(s.qualificacao_representante).descricao),
      })
    )
    .filter((p) => p.name);
  return { ...(Object.keys(address).length ? { address } : {}), registration, partners };
}

/** Endereço numa linha (comparação e exibição): "Rua X, 10, Sala 2 - Centro - Recife/PE - CEP 50000-000". */
export function formatAddress(a: CompanyAddress | null | undefined): string {
  if (!a) return '';
  const cep = a.cep && a.cep.length === 8 ? `CEP ${a.cep.slice(0, 5)}-${a.cep.slice(5)}` : '';
  const cityUf = [a.municipality, a.uf].filter(Boolean).join('/');
  const first = [a.street, a.number, a.complement].filter(Boolean).join(', ');
  return [first, a.district, cityUf, cep].filter(Boolean).join(' - ');
}
