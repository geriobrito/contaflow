import type { ClientCompany, TaxRegime } from '@/types/firestore';
import { cleanCNPJ, isValidCNPJ } from '@/lib/utils/formatters';

/**
 * Diagnóstico do cadastro de cada empresa da carteira: o que falta ou diverge, e onde isso
 * aparece (demonstrações, livros, carta de responsabilidade). Sai só do documento do cliente,
 * já em memória: não lê nada a mais do banco.
 */

export type IssueSeverity = 'high' | 'medium' | 'low';

/** Aba do formulário de Clientes em que a pendência se resolve. */
export type ClientFormTab = 'cadastro' | 'endereco' | 'cartao' | 'socios';

export interface ClientIssue {
  id: string;
  severity: IssueSeverity;
  /** Texto curto, para a etiqueta. */
  label: string;
  /** O que a pendência causa e como resolver. */
  detail: string;
  tab: ClientFormTab;
}

/** Consulta à Receita com mais de um ano conta como antiga (situação e QSA podem ter mudado). */
export const RECEITA_STALE_MONTHS = 12;

const SEVERITY_ORDER: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 };

const REGIME_NAME: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
};

/** Meses inteiros entre duas datas ISO (YYYY-MM-DD…); negativo vira zero. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  if (![fy, fm, fd, ty, tm, td].every(Number.isFinite)) return 0;
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

/** Divergência entre o regime do cadastro e a opção pelo Simples/SIMEI do cartão CNPJ. */
function regimeMismatch(client: ClientCompany): string | null {
  const simples = client.registration?.simples?.optant;
  const mei = client.registration?.mei?.optant;
  const name = REGIME_NAME[client.regime] ?? client.regime;
  if (mei === true && client.regime !== 'MEI') return `Regime ${name}, mas a Receita indica opção pelo SIMEI (MEI).`;
  if (client.regime === 'MEI' && mei === false) return 'Regime MEI, mas a Receita não indica opção pelo SIMEI.';
  if (client.regime === 'SIMPLES_NACIONAL' && simples === false) return 'Regime Simples Nacional, mas a Receita não indica opção pelo Simples.';
  if ((client.regime === 'LUCRO_PRESUMIDO' || client.regime === 'LUCRO_REAL') && simples === true)
    return `Regime ${name}, mas a Receita indica opção pelo Simples Nacional.`;
  return null;
}

/** CNPJs (só os caracteres) que aparecem em mais de uma empresa da carteira. */
export function duplicateCnpjs(clients: readonly ClientCompany[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of clients) {
    if (c.deletingAt) continue;
    const doc = cleanCNPJ(c.cnpj);
    if (!doc) continue;
    if (seen.has(doc)) dup.add(doc);
    else seen.add(doc);
  }
  return dup;
}

export interface IssueContext {
  /** Data de hoje (YYYY-MM-DD), de `todayISO()`. */
  today: string;
  /** Resultado de `duplicateCnpjs` para a carteira. */
  duplicates?: ReadonlySet<string>;
}

/** Pendências do cadastro de uma empresa, das mais graves para as mais leves. */
export function clientIssues(client: ClientCompany, { today, duplicates }: IssueContext): ClientIssue[] {
  if (client.deletingAt) return [];
  const issues: ClientIssue[] = [];
  const reg = client.registration;
  const doc = cleanCNPJ(client.cnpj);

  const status = reg?.status?.trim();
  if (status && status.toUpperCase() !== 'ATIVA') {
    issues.push({
      id: 'status',
      severity: 'high',
      label: `Situação ${status.toUpperCase()} na Receita`,
      detail: `O cartão CNPJ traz a situação cadastral ${status.toUpperCase()}${reg?.statusReason ? ` (${reg.statusReason})` : ''}. Confira antes de seguir com a escrituração.`,
      tab: 'cartao',
    });
  }
  if (duplicates?.has(doc)) {
    issues.push({
      id: 'duplicate',
      severity: 'high',
      label: 'CNPJ repetido na carteira',
      detail: 'Outra empresa da carteira tem este mesmo CNPJ. Uma das duas provavelmente é cadastro em duplicidade.',
      tab: 'cadastro',
    });
  }
  if (!isValidCNPJ(doc)) {
    issues.push({
      id: 'cnpj',
      severity: 'high',
      label: 'CNPJ inválido',
      detail: 'Os dígitos verificadores do CNPJ não conferem. Ele sai assim nas demonstrações e nos livros.',
      tab: 'cadastro',
    });
  }
  const mismatch = regimeMismatch(client);
  if (mismatch) {
    issues.push({ id: 'regime', severity: 'medium', label: 'Regime diverge da Receita', detail: `${mismatch} O regime define a agenda de obrigações.`, tab: 'cadastro' });
  }
  if (!client.legalRepresentativeName?.trim() || !client.legalRepresentativeCpf?.trim()) {
    issues.push({
      id: 'representative',
      severity: 'medium',
      label: 'Sem representante legal',
      detail: 'Falta o nome ou o CPF do representante legal, que assina as demonstrações e a carta de responsabilidade.',
      tab: 'cadastro',
    });
  }
  if (!client.activity?.trim()) {
    issues.push({
      id: 'activity',
      severity: 'medium',
      label: 'Sem atividade principal',
      detail: 'A atividade principal sai na declaração de conformidade, no fim das demonstrações.',
      tab: 'cadastro',
    });
  }
  if (!client.city?.trim()) {
    issues.push({
      id: 'city',
      severity: 'medium',
      label: 'Sem município/UF',
      detail: 'O Município/UF sai nos termos do Livro Diário e na carta de responsabilidade.',
      tab: 'cadastro',
    });
  }
  if (!reg?.fetchedAt && !status) {
    issues.push({
      id: 'receita',
      severity: 'low',
      label: 'Cartão CNPJ não consultado',
      detail: 'Use "Atualizar pela Receita" para trazer situação cadastral, CNAEs, endereço e quadro de sócios.',
      tab: 'cartao',
    });
  } else if (reg?.fetchedAt) {
    const months = monthsBetween(reg.fetchedAt, today);
    if (months >= RECEITA_STALE_MONTHS) {
      issues.push({
        id: 'receita',
        severity: 'low',
        label: `Receita consultada há ${months} meses`,
        detail: 'A situação cadastral e o quadro de sócios podem ter mudado. Use "Atualizar pela Receita".',
        tab: 'cartao',
      });
    }
  }
  if (!client.address?.street?.trim() && !client.address?.cep) {
    issues.push({ id: 'address', severity: 'low', label: 'Sem endereço', detail: 'Endereço da sede não cadastrado. O CEP preenche o restante.', tab: 'endereco' });
  }
  if (client.regime !== 'MEI' && !client.partners?.length) {
    issues.push({ id: 'partners', severity: 'low', label: 'Sem sócios (QSA)', detail: 'Quadro de sócios e administradores vazio. A consulta à Receita o preenche.', tab: 'socios' });
  }
  if (!client.email?.trim() && !client.phone?.trim()) {
    issues.push({ id: 'contact', severity: 'low', label: 'Sem contato', detail: 'Nem e-mail nem telefone do cliente no cadastro.', tab: 'cadastro' });
  }
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Gravidade mais alta entre as pendências, ou null sem nenhuma. */
export const worstSeverity = (issues: readonly ClientIssue[]): IssueSeverity | null => issues[0]?.severity ?? null;

/** Pendências que afetam documentos ou a rotina (as leves são só complemento do cadastro). */
export const blockingIssues = (issues: readonly ClientIssue[]): ClientIssue[] => issues.filter((i) => i.severity !== 'low');

export type ClientSort = 'name' | 'issues' | 'since' | 'recent';

const displayName = (c: ClientCompany) => c.tradeName || c.name;
const byName = (a: ClientCompany, b: ClientCompany) => displayName(a).localeCompare(displayName(b), 'pt-BR', { sensitivity: 'base' });

/** Peso das pendências para ordenar: uma grave pesa mais que qualquer número de leves. */
const issueWeight = (issues: readonly ClientIssue[]) => issues.reduce((n, i) => n + (i.severity === 'high' ? 10_000 : i.severity === 'medium' ? 100 : 1), 0);

/**
 * Ordena a carteira. Empresas com exclusão incompleta ficam sempre no topo (precisam de ação).
 * - `name`: nome de exibição; `issues`: mais pendências primeiro; `since`: clientes mais
 *   antigos primeiro (sem data no fim); `recent`: cadastro alterado por último primeiro.
 */
export function sortClients(clients: readonly ClientCompany[], sort: ClientSort, issuesOf: (c: ClientCompany) => readonly ClientIssue[]): ClientCompany[] {
  const cmp: Record<ClientSort, (a: ClientCompany, b: ClientCompany) => number> = {
    name: byName,
    issues: (a, b) => issueWeight(issuesOf(b)) - issueWeight(issuesOf(a)) || byName(a, b),
    since: (a, b) => (a.clientSince || '9999').localeCompare(b.clientSince || '9999') || byName(a, b),
    recent: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || byName(a, b),
  };
  return [...clients].sort((a, b) => Number(Boolean(b.deletingAt)) - Number(Boolean(a.deletingAt)) || cmp[sort](a, b));
}
