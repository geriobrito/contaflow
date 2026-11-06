import type { ChartAccount, ClientCompany } from '@/types/firestore';
import { accountKind, isContraAccount, type TrialBalance, type TrialBalanceRow } from '@/lib/ledger';
import { resolveDREGroup } from '@/lib/dre/build';
import { fromCents, toCents } from '@/lib/money';
import { formatCurrency } from '@/lib/utils/formatters';
import { OPENING_ACCOUNT_CODE } from '@/lib/ledger';
import { ACCUMULATED_LOSSES_CODE, PRIOR_ADJUSTMENTS_CODE, RETAINED_EARNINGS_CODE } from '@/lib/year-closing';
import type { StatementCheck } from '@/lib/statement-checks';

/**
 * Checklist do fechamento do exercício: as conferências que o sistema faz sozinho sobre o
 * balancete do ano (custo na DRE, saldos virados, terminologia, grupo de lucros acumulados,
 * depreciação) e os itens que o contador confere e marca à mão.
 */

const DEPRECIATION_CODES = ['3.3.2.15', '3.2.1.04'];
const LAND_CODE = '1.2.3.01';
const ACCUMULATED_DEPRECIATION_CODE = '1.2.3.07';
/** Contas que aceitam saldo dos dois lados (transitórias): fora da conferência de saldo virado. */
const EITHER_SIDE = new Set([OPENING_ACCOUNT_CODE, PRIOR_ADJUSTMENTS_CODE, '1.1.1.04']);

const money = (cents: number) => formatCurrency(fromCents(Math.abs(cents)));
const label = (a: Pick<ChartAccount, 'code' | 'name'>) => `${a.code} ${a.name}`;

/** Saldos analíticos do balancete por conta do plano, em centavos (positivo = devedor). */
function balancesOf(tb: TrialBalance, accounts: readonly ChartAccount[]): { account: ChartAccount; cents: number }[] {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  return tb.rows
    .filter((r: TrialBalanceRow) => !r.synthetic && byId.has(r.accountId))
    .map((r) => ({ account: byId.get(r.accountId)!, cents: toCents(r.final) }))
    .filter((b) => b.cents !== 0);
}

/** Lado natural do saldo: 'D' devedor, 'C' credor (retificadoras e deduções da receita invertem). */
function naturalSide(a: ChartAccount): 'D' | 'C' {
  const contra = isContraAccount(a);
  const kind = accountKind(a);
  if (kind === 'ASSET') return contra ? 'C' : 'D';
  if (kind === 'LIABILITY' || kind === 'EQUITY') return contra ? 'D' : 'C';
  if (a.type === 'REVENUE') return contra || resolveDREGroup(a) === 'DEDUCTIONS' ? 'D' : 'C';
  return contra ? 'C' : 'D';
}

/* =========================================================================
   Conferências automáticas
   ========================================================================= */

/** Que custo a DRE deveria trazer, pela receita: serviços, mercadorias ou produtos. */
function costKind(revenueAccounts: readonly ChartAccount[]): { name: string; code: string } {
  const text = revenueAccounts.map((a) => `${a.code} ${a.name}`).join(' ');
  if (/3\.1\.1\.03|produto/i.test(text)) return { name: 'Custo dos Produtos Vendidos', code: '3.2.1.02' };
  if (/3\.1\.1\.02|mercadoria/i.test(text)) return { name: 'Custo das Mercadorias Vendidas', code: '3.2.1.01' };
  return { name: 'Custo dos Serviços Prestados', code: '3.2.1.03' };
}

/**
 * Receita sem custo na DRE: prestadora sem custo dos serviços, comércio sem CMV. É o erro que os
 * CRCs mais encontram na fiscalização; toda atividade tem custo (mão de obra, insumos, energia).
 */
export function missingCostCheck(beforeClosing: TrialBalance, accounts: readonly ChartAccount[]): StatementCheck | null {
  const balances = balancesOf(beforeClosing, accounts);
  const revenue = balances.filter((b) => resolveDREGroup(b.account) === 'GROSS_REVENUE');
  const revenueCents = -revenue.reduce((s, b) => s + b.cents, 0);
  if (revenueCents <= 0) return null;
  const costs = balances.filter((b) => resolveDREGroup(b.account) === 'COSTS').reduce((s, b) => s + b.cents, 0);
  if (costs > 0) return { id: 'cost', level: 'ok', title: 'A DRE traz custo junto com a receita' };
  const kind = costKind(revenue.map((b) => b.account));
  return {
    id: 'cost',
    level: 'warn',
    title: `Receita de ${money(revenueCents)} sem ${kind.name.toLowerCase()} na DRE`,
    items: [
      'Toda atividade tem custo: na prestadora de serviço, a mão de obra de quem executa (salários, pró-labore), os materiais aplicados e a parte da estrutura usada no serviço; no comércio, o custo das mercadorias vendidas.',
      `Reclassifique para ${kind.code} ${kind.name} o que hoje está em despesa. A ausência de custo na DRE é um dos erros mais apontados nas fiscalizações dos CRCs.`,
    ],
    href: '/',
    linkLabel: 'Revisar classificações',
  };
}

/**
 * Contas com saldo contrário à natureza: caixa credor, obrigação devedora, despesa credora,
 * receita devedora. As patrimoniais vêm do balancete final; as de resultado, do de antes do
 * encerramento (depois dele estão zeradas).
 */
export function invertedBalancesCheck(beforeClosing: TrialBalance, final: TrialBalance, accounts: readonly ChartAccount[]): StatementCheck | null {
  const patrimonial = balancesOf(final, accounts).filter((b) => accountKind(b.account) !== 'RESULT');
  const result = balancesOf(beforeClosing, accounts).filter((b) => accountKind(b.account) === 'RESULT');
  const inverted = [...patrimonial, ...result]
    .filter((b) => !EITHER_SIDE.has(b.account.code) && !b.account.code.startsWith('5'))
    .filter((b) => (naturalSide(b.account) === 'D' ? b.cents < 0 : b.cents > 0))
    .sort((x, y) => x.account.code.localeCompare(y.account.code, undefined, { numeric: true }));
  if (!inverted.length) return { id: 'inverted-all', level: 'ok', title: 'Nenhuma conta com saldo virado' };
  return {
    id: 'inverted-all',
    level: 'warn',
    title: `Saldo virado em ${inverted.length} conta(s)`,
    items: [
      ...inverted.map((b) => `${label(b.account)}: ${money(b.cents)} ${b.cents > 0 ? 'devedor' : 'credor'}, contrário à natureza da conta`),
      'Saldo virado indica lançamento invertido, pagamento sem a obrigação lançada ou erro de classificação. Caixa nunca fica credor.',
    ],
  };
}

const PROVISION_TERM = /\bprovis(?:ão|ao|ões|oes)\s+(?:de\s+|para\s+)?(f[ée]rias|13|d[ée]cimo)/i;

/** Novo nome sem "provisão": "Provisão de Férias e Encargos" → "Férias e Encargos a Pagar". */
export function withoutProvisionTerm(name: string): string {
  const rest = name.replace(/^\s*provis(?:ão|ao|ões|oes)\s+(?:de\s+|para\s+)?/i, '').trim();
  const base = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /a pagar\s*$/i.test(base) ? base : `${base} a Pagar`;
}

export type AccountRename = { account: ChartAccount; name: string };

/** Contas de férias e 13º com "provisão" no nome, com o nome correto. */
export function provisionRenames(accounts: readonly ChartAccount[]): AccountRename[] {
  return accounts.filter((a) => PROVISION_TERM.test(a.name)).map((account) => ({ account, name: withoutProvisionTerm(account.name) }));
}

/** Nomes antigos das contas da venda de bens no modelo ("ganho" e "perda" em vez de receita e custo). */
const DISPOSAL_NAMES: readonly { code: string; term: RegExp; name: string }[] = [
  { code: '3.3.9.02', term: /\bganhos?\b/i, name: 'Receita na Venda de Imobilizado e Intangível' },
  { code: '3.3.9.04', term: /\bperdas?\b/i, name: 'Custo do Imobilizado e Intangível Baixado' },
];

/** Contas da venda de bens do modelo ainda com "ganho" ou "perda" no nome, com o nome correto. */
export function disposalRenames(accounts: readonly ChartAccount[]): AccountRename[] {
  return DISPOSAL_NAMES.flatMap(({ code, term, name }) => accounts.filter((a) => a.code === code && term.test(a.name)).map((account) => ({ account, name })));
}

const FINANCIAL_TERM = /\b(multas?|juros|tarifas?|iof|encargos financeiros)\b/i;
const GENERIC_TERM = /\b(diversas?|diversos|gerais|outras|outros)\b/i;
const PROFIT_IN_ASSET = /antecipa\S*\s+de\s+lucros?|dividendos?|distribui\S*\s+de\s+lucros?/i;

/**
 * Terminologia e classificação: "provisão" em férias e 13º (são obrigações certas, "a pagar"),
 * lucro antecipado no ativo, multa/juros/tarifas fora do resultado financeiro e contas genéricas
 * com saldo (o leitor da DRE não sabe o que são).
 */
export function terminologyChecks(beforeClosing: TrialBalance, final: TrialBalance, accounts: readonly ChartAccount[]): StatementCheck[] {
  const out: StatementCheck[] = [];
  const renames = provisionRenames(accounts);
  if (renames.length) {
    out.push({
      id: 'provision-term',
      level: 'warn',
      title: `“Provisão” no nome de ${renames.length} conta(s) de férias e 13º`,
      items: [
        ...renames.map((r) => `${label(r.account)} → ${r.name}`),
        'Férias e 13º têm valor e prazo conhecidos: são obrigações a pagar. Provisão é para obrigação incerta (ex.: processo trabalhista).',
      ],
    });
  }
  const disposal = disposalRenames(accounts);
  if (disposal.length) {
    out.push({
      id: 'disposal-term',
      level: 'warn',
      title: '“Ganho” ou “perda” no nome das contas da venda de bens',
      items: [
        ...disposal.map((r) => `${label(r.account)} → ${r.name}`),
        'Na venda de um bem, lançam-se a receita e o custo (valor contábil baixado) separados; o ganho ou a perda é a diferença, que só aparece na DRE.',
      ],
    });
  }

  const patrimonial = balancesOf(final, accounts);
  const profitInAsset = patrimonial.filter((b) => accountKind(b.account) === 'ASSET' && PROFIT_IN_ASSET.test(b.account.name));
  if (profitInAsset.length) {
    out.push({
      id: 'profit-in-asset',
      level: 'warn',
      title: 'Retirada de lucro registrada no ativo',
      items: [
        ...profitInAsset.map((b) => `${label(b.account)}: ${money(b.cents)}`),
        'Não existe “antecipação de lucro” no ativo. Com distribuição intermediária prevista no contrato social (e demonstrações levantadas para ela), lance em 2.3.3.03 (-) Lucros Distribuídos; sem ela, a retirada é empréstimo ao sócio (1.2.1.01 Créditos com Sócios).',
      ],
    });
  }

  const result = balancesOf(beforeClosing, accounts).filter((b) => accountKind(b.account) === 'RESULT');
  const misplaced = result.filter((b) => {
    const group = resolveDREGroup(b.account);
    return b.account.type === 'EXPENSE' && FINANCIAL_TERM.test(b.account.name) && group !== 'FINANCIAL_EXPENSES' && group !== 'INCOME_TAXES';
  });
  if (misplaced.length) {
    out.push({
      id: 'financial-misplaced',
      level: 'warn',
      title: 'Despesa financeira fora do resultado financeiro',
      items: [...misplaced.map((b) => `${label(b.account)}: ${money(b.cents)}`), 'Multas, juros, tarifas bancárias e IOF são despesas financeiras (3.4.1.01).'],
      href: '/plano-de-contas',
      linkLabel: 'Ajustar no plano de contas',
    });
  }

  // "Outras receitas/despesas operacionais" (3.3.9) são linhas próprias da DRE, não contas genéricas.
  const generic = result.filter((b) => GENERIC_TERM.test(b.account.name) && !b.account.code.startsWith('3.3.9'));
  if (generic.length) {
    out.push({
      id: 'generic-accounts',
      level: 'info',
      title: `Contas genéricas com saldo no exercício (${generic.length})`,
      items: [
        ...generic.map((b) => `${label(b.account)}: ${money(b.cents)}`),
        'Quem lê a DRE não sabe o que há em “diversas” ou “outras despesas gerais”: discrimine os valores relevantes em contas próprias.',
      ],
    });
  }
  return out;
}

/**
 * Grupo de Lucros ou Prejuízos Acumulados depois do encerramento: só Lucros Acumulados ou
 * Prejuízos Acumulados podem ficar com saldo. Balanço de abertura, ajustes, lucros distribuídos
 * e outras contas do grupo precisam estar zerados.
 */
export function retainedGroupCheck(final: TrialBalance, accounts: readonly ChartAccount[], yearClosed: boolean): StatementCheck | null {
  if (!yearClosed) return null;
  const left = balancesOf(final, accounts).filter(
    (b) => b.account.code.startsWith('2.3.3.') && b.account.code !== RETAINED_EARNINGS_CODE && b.account.code !== ACCUMULATED_LOSSES_CODE
  );
  if (!left.length) return { id: 'retained-group', level: 'ok', title: 'Grupo de lucros acumulados só com Lucros ou Prejuízos Acumulados' };
  return {
    id: 'retained-group',
    level: 'warn',
    title: `${left.length} conta(s) do grupo de lucros acumulados com saldo depois do encerramento`,
    items: [
      ...left.map((b) => `${label(b.account)}: ${money(b.cents)} ${b.cents > 0 ? 'devedor' : 'credor'}`),
      'No fim do exercício só Lucros Acumulados ou Prejuízos Acumulados ficam com saldo: reabra e encerre o exercício de novo para zerar as demais.',
    ],
    href: '/balanco',
    linkLabel: 'Ir ao encerramento',
  };
}

/** Imobilizado depreciável sem depreciação no ano, ou depreciação acumulada maior que o custo. */
export function depreciationCheck(beforeClosing: TrialBalance, final: TrialBalance, accounts: readonly ChartAccount[]): StatementCheck | null {
  const patrimonial = balancesOf(final, accounts);
  const depreciable = patrimonial
    .filter((b) => b.account.code.startsWith('1.2.3.') && b.account.code !== LAND_CODE && !isContraAccount(b.account) && b.account.code !== ACCUMULATED_DEPRECIATION_CODE)
    .reduce((s, b) => s + b.cents, 0);
  if (depreciable <= 0) return null;
  const accumulated = -(patrimonial.find((b) => b.account.code === ACCUMULATED_DEPRECIATION_CODE)?.cents ?? 0);
  const expense = balancesOf(beforeClosing, accounts)
    .filter((b) => accountKind(b.account) === 'RESULT' && (DEPRECIATION_CODES.includes(b.account.code) || /deprecia/i.test(b.account.name)))
    .reduce((s, b) => s + b.cents, 0);
  if (accumulated > depreciable) {
    return {
      id: 'depreciation',
      level: 'warn',
      title: 'Depreciação acumulada maior que o custo do imobilizado',
      items: [`Custo depreciável ${money(depreciable)}, depreciação acumulada ${money(accumulated)}.`],
      href: '/imobilizado',
      linkLabel: 'Conferir no Imobilizado',
    };
  }
  if (expense <= 0) {
    return {
      id: 'depreciation',
      level: 'warn',
      title: `Imobilizado de ${money(depreciable)} sem depreciação no exercício`,
      items: ['A depreciação é obrigatória e mensal. Cadastre os bens no Imobilizado: o sistema calcula e lança as cotas.'],
      href: '/imobilizado',
      linkLabel: 'Cadastrar bens',
    };
  }
  return { id: 'depreciation', level: 'ok', title: 'Depreciação lançada no exercício' };
}

/** Porte não informado: a norma do fechamento é suposta (microentidade). */
export function porteCheck(client: Pick<ClientCompany, 'porte'>): StatementCheck {
  return client.porte
    ? { id: 'porte', level: 'ok', title: `Norma definida pelo porte (${client.porte === 'PEQUENA_EMPRESA' ? 'NBC TG 1001' : 'NBC TG 1002'})` }
    : {
        id: 'porte',
        level: 'info',
        title: 'Porte da empresa não informado: as demonstrações seguem a NBC TG 1002 (microentidade)',
        items: ['Confirme o porte pela receita bruta anual no cadastro da empresa. A norma escolhida vale por pelo menos dois exercícios seguidos.'],
        href: '/clientes',
        linkLabel: 'Abrir o cadastro',
      };
}

export interface ClosingChecksInput {
  client: Pick<ClientCompany, 'porte'>;
  accounts: readonly ChartAccount[];
  /** Balancete do exercício (1º/01 a 31/12) sem o encerramento. */
  beforeClosing: TrialBalance;
  /** Balancete do exercício com o encerramento: a posição final. */
  final: TrialBalance;
  yearClosed: boolean;
}

/** Conferências automáticas do fechamento, na ordem da tela. */
export function closingChecks(i: ClosingChecksInput): StatementCheck[] {
  return [
    porteCheck(i.client),
    missingCostCheck(i.beforeClosing, i.accounts),
    invertedBalancesCheck(i.beforeClosing, i.final, i.accounts),
    ...terminologyChecks(i.beforeClosing, i.final, i.accounts),
    depreciationCheck(i.beforeClosing, i.final, i.accounts),
    retainedGroupCheck(i.final, i.accounts, i.yearClosed),
  ].filter((c): c is StatementCheck => Boolean(c));
}

/* =========================================================================
   Itens conferidos à mão
   ========================================================================= */

export interface ManualItem {
  id: string;
  title: string;
  hint: string;
}

/** Itens que só o contador confere, com o documento do cliente na mão. */
export function manualItems(hasStock: boolean): ManualItem[] {
  return [
    { id: 'cash', title: 'Saldo de caixa confirmado com o cliente', hint: 'O caixa é o dinheiro físico na data. Saldo alto ou sem movimento costuma ser fictício.' },
    { id: 'taxes', title: 'Impostos a recolher conferidos com as guias', hint: 'Simples a recolher em 31/12 = DAS de dezembro, pago em janeiro. Imposto vencido precisa de multa e juros lançados.' },
    { id: 'payroll', title: 'Contas da folha conferidas com o departamento pessoal', hint: 'Salários, INSS, FGTS, férias e 13º a pagar iguais aos relatórios da folha.' },
    { id: 'equity', title: 'Capital social conferido com o contrato social', hint: 'Capital subscrito e a integralizar conforme a última alteração contratual.' },
    { id: 'revenue', title: 'Receita conferida com o fiscal', hint: 'Receita do ano igual ao faturamento das notas e ao declarado no PGDAS-D; deduções iguais às guias.' },
    ...(hasStock ? [{ id: 'stock', title: 'Estoque conferido com o inventário', hint: 'Saldo de estoque igual ao inventário de 31/12, com o custo das vendas baixado na DRE.' }] : []),
    { id: 'norm', title: 'Norma conferida', hint: 'Porte pela receita bruta anual e a regra de permanência por dois exercícios seguidos.' },
  ];
}

export const BOOK_METHOD_LABEL: Record<'ECD' | 'JUNTA' | 'CARTORIO', string> = {
  ECD: 'ECD (SPED Contábil)',
  JUNTA: 'Junta Comercial',
  CARTORIO: 'Cartório (registro civil de pessoas jurídicas)',
};

/** Há estoque no balanço (o item de inventário entra no checklist). */
export const hasStockBalance = (final: TrialBalance, accounts: readonly ChartAccount[]): boolean =>
  balancesOf(final, accounts).some((b) => b.account.code.startsWith('1.1.3.') && b.cents > 0);
