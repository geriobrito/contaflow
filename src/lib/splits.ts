import type { BankTransaction, ChartAccount, TransactionSplit } from '@/types/firestore';
import { generateId } from '@/lib/utils/id';
import { fromCents, toCents } from '@/lib/money';

// Valores monetários são comparados em centavos inteiros (ver src/lib/money.ts).
export { fromCents, toCents };

export interface SplitDraft {
  id: string;
  accountId: string;
  memo: string;
  /** Valor absoluto em centavos, como digitado pelo usuário. */
  cents: number;
  /**
   * Linha redutora: subtrai do lançamento em vez de somar. É a retenção ou a tarifa entre o
   * valor bruto e o líquido que caiu no banco (ex.: recebimento de 1.000 com 15 de IRRF retido:
   * receita 1.000 e IRRF 15 redutora = 985 no extrato).
   */
  reduces?: boolean;
}

/** Valor da linha com sinal: redutora conta negativo. */
const signedCents = (d: Pick<SplitDraft, 'cents' | 'reduces'>) => (d.reduces ? -d.cents : d.cents);

export interface SplitSummary {
  totalCents: number;
  allocatedCents: number;
  remainingCents: number;
  /** Soma igual ao total (|diferença| < R$ 0,01) e todas as linhas completas. */
  isBalanced: boolean;
  isComplete: boolean;
  errors: string[];
}

/** Resume e valida um rascunho de rateio contra o valor absoluto do lançamento. */
export function summarizeSplits(
  transactionAmount: number,
  drafts: readonly SplitDraft[],
  accountsById?: ReadonlyMap<string, ChartAccount>
): SplitSummary {
  const totalCents = Math.abs(toCents(transactionAmount));
  const allocatedCents = drafts.reduce((sum, d) => sum + signedCents(d), 0);
  const remainingCents = totalCents - allocatedCents;
  const errors: string[] = [];

  if (drafts.length < 2) errors.push('Um rateio precisa de pelo menos duas linhas.');
  drafts.forEach((d, i) => {
    const n = i + 1;
    if (!d.accountId) errors.push(`Linha ${n}: selecione a conta.`);
    else if (accountsById && accountsById.get(d.accountId)?.nature === 'SYNTHETIC')
      errors.push(`Linha ${n}: conta sintética não recebe lançamentos.`);
    if (d.cents <= 0) errors.push(`Linha ${n}: informe um valor maior que zero.`);
  });
  if (drafts.length > 0 && drafts.every((d) => d.reduces)) errors.push('Pelo menos uma linha precisa somar ao lançamento (o valor bruto).');

  const isBalanced = Math.abs(remainingCents) < 1;
  return {
    totalCents,
    allocatedCents,
    remainingCents,
    isBalanced,
    isComplete: errors.length === 0,
    errors,
  };
}

/**
 * Converte o rascunho em `TransactionSplit[]` com o sinal do lançamento original (redutoras
 * com o sinal oposto), de modo que a soma dos splits reproduza exatamente `transaction.amount`.
 */
export function draftsToSplits(
  transaction: Pick<BankTransaction, 'amount'>,
  drafts: readonly SplitDraft[],
  accountsById: ReadonlyMap<string, ChartAccount>
): TransactionSplit[] {
  const sign = transaction.amount < 0 ? -1 : 1;
  return drafts.map((d) => {
    const account = accountsById.get(d.accountId);
    return {
      id: d.id,
      accountId: d.accountId,
      amount: fromCents(sign * signedCents(d)),
      memo: d.memo.trim(),
      accountCode: account?.code,
      accountName: account?.name,
    };
  });
}

/**
 * Converte splits gravados de volta em rascunho editável. Com o valor do lançamento, a linha de
 * sinal oposto a ele volta como redutora.
 */
export function splitsToDrafts(splits: readonly TransactionSplit[], transactionAmount?: number): SplitDraft[] {
  const sign = transactionAmount !== undefined && transactionAmount < 0 ? -1 : 1;
  return splits.map((s) => {
    const reduces = transactionAmount !== undefined && sign * s.amount < 0;
    return { id: s.id, accountId: s.accountId, memo: s.memo, cents: Math.abs(toCents(s.amount)), ...(reduces ? { reduces: true } : {}) };
  });
}

export const newSplitId = (): string => generateId('split');

/* =========================================================================
   Bruto × líquido: retenções e tarifas
   ========================================================================= */

export interface RetentionOption {
  /** Conta do modelo de plano de contas (CFC). */
  code: string;
  hint: string;
}

export interface RetentionPreset {
  key: string;
  label: string;
  /** Contas possíveis; a primeira é a sugerida. */
  options: readonly RetentionOption[];
}

/**
 * Retenções comuns entre o valor bruto e o que caiu no banco. No recebimento, o que o tomador
 * reteve é imposto a recuperar (IRRF, PIS/COFINS/CSLL); o ISS retido abate o imposto do mês já
 * provisionado (nunca uma segunda dedução da receita); a taxa da maquininha é despesa. No
 * pagamento, o que a empresa reteve do fornecedor é imposto a recolher.
 */
export const RECEIPT_RETENTIONS: readonly RetentionPreset[] = [
  { key: 'irrf', label: 'IRRF retido pelo tomador', options: [{ code: '1.1.2.05', hint: 'Tributos a recuperar (compensa no IRPJ)' }] },
  { key: 'csrf', label: 'PIS/COFINS/CSLL retidos', options: [{ code: '1.1.2.05', hint: 'Tributos a recuperar (4,65%)' }] },
  {
    key: 'iss',
    label: 'ISS retido pelo tomador',
    options: [
      { code: '2.1.5.03', hint: 'Abate o ISS a recolher do mês' },
      { code: '2.1.5.01', hint: 'Abate o Simples a recolher (ISS retido deduzido no PGDAS)' },
      { code: '1.1.2.05', hint: 'Tributos a recuperar / compensar' },
    ],
  },
  { key: 'card', label: 'Taxa de cartão / maquininha', options: [{ code: '3.4.1.01.002', hint: 'Despesas bancárias' }] },
];

export const PAYMENT_RETENTIONS: readonly RetentionPreset[] = [
  { key: 'irrf', label: 'IRRF retido do fornecedor', options: [{ code: '2.1.5.04', hint: 'IRRF a recolher' }] },
  { key: 'iss', label: 'ISS retido do fornecedor', options: [{ code: '2.1.5.03', hint: 'ISS a recolher' }] },
  { key: 'inss', label: 'INSS retido (11%)', options: [{ code: '2.1.1.03', hint: 'INSS a recolher' }] },
];

export const retentionPresetsFor = (amount: number): readonly RetentionPreset[] => (amount < 0 ? PAYMENT_RETENTIONS : RECEIPT_RETENTIONS);

export interface GrossOrigin {
  key: string;
  label: string;
  /** Conta fixa do valor bruto; sem ela, a conta escolhida no seletor (receita ou despesa). */
  code?: string;
  hint: string;
}

/**
 * De onde vem o valor bruto. Venda (ou compra) à vista vai direto à receita (ou despesa); a
 * baixa de uma nota já lançada a prazo (modelo "Faturamento a prazo") vai a Clientes, sem
 * lançar a receita de novo.
 */
export const grossOriginsFor = (amount: number): readonly GrossOrigin[] =>
  amount < 0
    ? [
        { key: 'cash', label: 'Despesa à vista', hint: 'A despesa entra agora, pelo bruto.' },
        { key: 'settle', label: 'Baixa de fornecedor', code: '2.1.2.01', hint: 'A compra já foi provisionada em Fornecedores.' },
      ]
    : [
        { key: 'cash', label: 'Venda à vista', hint: 'A receita entra agora, pelo bruto.' },
        { key: 'settle', label: 'Baixa de Clientes a receber', code: '1.1.2.01', hint: 'A nota já foi lançada no faturamento a prazo: a receita não se repete.' },
      ];

/**
 * Rateio bruto × líquido: a conta principal pelo valor bruto (líquido do extrato + retenções) e
 * cada retenção como linha redutora. Retenções zeradas ficam de fora.
 */
export function grossNetDrafts(args: {
  transactionAmount: number;
  grossAccountId: string;
  retentions: readonly { accountId: string; memo: string; cents: number }[];
}): SplitDraft[] {
  const kept = args.retentions.filter((r) => r.cents > 0);
  const net = Math.abs(toCents(args.transactionAmount));
  const gross = net + kept.reduce((s, r) => s + r.cents, 0);
  return [
    { id: newSplitId(), accountId: args.grossAccountId, memo: 'Valor bruto', cents: gross },
    ...kept.map((r) => ({ id: newSplitId(), accountId: r.accountId, memo: r.memo, cents: r.cents, reduces: true })),
  ];
}
