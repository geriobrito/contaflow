import type { BankTransaction, ClassificationRule, RuleMatchType } from '@/types/firestore';
import { matchesRule } from '@/lib/reconciliation';

/**
 * Favorecido (quem pagou ou recebeu) de uma descrição de extrato, agrupamento de lançamentos
 * por favorecido e avaliação de termos de regra (genérico demais?).
 *
 * Formatos tratados (todos separados por " - "):
 *   InfinitePay  "Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado"
 *   Nubank       "Transferência recebida pelo Pix - VALQUIRIA LIMA SOUTO - •••.975.291-•• - COOP SICREDI… Agência: 810 Conta: 16754-4"
 *   PagBank      "Pix recebido - Natalino De Jesus Ferreira Dos Santos", "QR Code Pix enviado - Shpp Brasil…"
 *   Boleto/cartão "Pagamento de boleto efetuado - Claro", "Compra no débito - Vivi Modas Feminina"
 */

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Chave de comparação: minúsculas, sem acento nem pontuação, espaços colapsados. */
export const textKey = (s: string): string =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Trechos que só dizem o tipo da operação (não identificam o favorecido). Comparados por `textKey`. */
const DESCRIPTORS = new Set([
  'pix',
  'pix recebido',
  'pix enviado',
  'qr code pix',
  'qr code pix enviado',
  'qr code pix recebido',
  'transferencia',
  'transferencia recebida',
  'transferencia enviada',
  'transferencia recebida pelo pix',
  'transferencia enviada pelo pix',
  'reembolso recebido pelo pix',
  'reembolso enviado pelo pix',
  'estorno',
  'ted',
  'ted recebida',
  'ted enviada',
  'doc',
  'pagamento',
  'pagamento efetuado',
  'pagamento de boleto',
  'pagamento de boleto efetuado',
  'pagamento de fatura',
  'compra',
  'compra no debito',
  'compra no credito',
  'saque',
  'deposito',
  'enviado',
  'recebido',
]);

/** Trecho que é só documento (CPF mascarado, CNPJ, números) ou dados bancários. */
function isNoise(segment: string): boolean {
  const s = segment.trim();
  if (/^[•*·xX]{3}\.\d{3}\.\d{3}-[•*·xX]{2}$/.test(s)) return true; // CPF mascarado
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(s)) return true; // CPF
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(s)) return true; // CNPJ
  if (/Ag[êe]ncia:|\bConta:/i.test(s)) return true; // "… Agência: 810 Conta: 16754-4"
  if (/\(\d{4}\)\s*$/.test(s)) return true; // "CAIXA ECONOMICA FEDERAL (0104)"
  return false;
}

/** Limpa sobras do nome: prefixo "Pix ", número de CNPJ/CPF colado no início ou no fim. */
function cleanPayee(raw: string): string {
  return raw
    .replace(/^pix\s+(?=\S)/i, '')
    .replace(/^[\d.\/-]{6,}\s+(?=\D)/, '')
    .replace(/\s+\d{11,14}$/, '')
    .replace(/[\s.,;:-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Favorecido da descrição, ou null quando ela só descreve a operação ("Pagamento de fatura").
 * É o primeiro trecho que não é descritor da operação nem documento/dados do banco.
 */
export function extractPayee(memo: string): string | null {
  const segments = memo
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of segments) {
    if (isNoise(segment)) continue;
    const cleaned = cleanPayee(segment);
    if (!cleaned || DESCRIPTORS.has(textKey(cleaned))) continue;
    return cleaned;
  }
  return null;
}

const collapseSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Termo sugerido para uma regra de favorecido: o favorecido (sem "Pix", sem "- Enviado"); sem
 * favorecido, a descrição toda. Mantém a grafia original — a comparação das regras já ignora
 * maiúsculas/minúsculas (`matchesRule`) e o termo é normalizado ao salvar.
 */
export function suggestRuleTerm(memo: string): string {
  return collapseSpaces(extractPayee(memo) ?? memo);
}

/**
 * Termo sugerido para um lançamento: a descrição como aparece na lista
 * ("Pix recebido - Marcelya Luyza Sales De Assis"), do início até o favorecido e os descritores
 * logo depois dele ("- Enviado"). Corta só o que costuma variar ou poluir: CPF/CNPJ e dados
 * bancários ("- •••.975.291-•• - COOP… Agência: 810 Conta: 16754-4").
 *
 * O resultado é sempre um trecho inicial da descrição, então a regra casa o próprio lançamento.
 * Sem favorecido, devolve a descrição inteira; se houver documento antes do favorecido, o favorecido.
 */
export function suggestMemoTerm(memo: string): string {
  const segments = memo
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let payeeFound = false;
  for (const segment of segments) {
    if (isNoise(segment)) {
      if (!payeeFound) return suggestRuleTerm(memo);
      break;
    }
    const cleaned = cleanPayee(segment);
    const isDescriptor = !cleaned || DESCRIPTORS.has(textKey(cleaned));
    if (payeeFound && !isDescriptor) break; // segundo nome/complemento: fica de fora
    kept.push(segment);
    if (!isDescriptor) payeeFound = true;
  }
  return payeeFound ? collapseSpaces(kept.join(' - ')) : collapseSpaces(memo);
}

/** Chave do favorecido para agrupar (sem favorecido, a própria descrição). */
export const payeeKey = (memo: string): string => textKey(extractPayee(memo) ?? memo);

/* =========================================================================
   Agrupamento por favorecido
   ========================================================================= */

export type FlowDirection = 'IN' | 'OUT';

export interface PayeeGroup {
  /** `${direction}|${chave do favorecido}` */
  id: string;
  direction: FlowDirection;
  /** Nome para exibição (grafia mais frequente). */
  label: string;
  /** Termo sugerido para a regra. */
  term: string;
  transactions: BankTransaction[];
  /** Soma com sinal. */
  total: number;
}

/**
 * Agrupa por favorecido e sentido (entrada/saída): receber de alguém e pagar a esse alguém
 * são operações diferentes e raramente vão para a mesma conta.
 */
export function groupByPayee(transactions: readonly BankTransaction[]): PayeeGroup[] {
  type Acc = { direction: FlowDirection; labels: Map<string, number>; txs: BankTransaction[] };
  const groups = new Map<string, Acc>();
  for (const t of transactions) {
    const direction: FlowDirection = t.amount < 0 ? 'OUT' : 'IN';
    const id = `${direction}|${payeeKey(t.memo)}`;
    const g: Acc = groups.get(id) ?? { direction, labels: new Map<string, number>(), txs: [] };
    const label = extractPayee(t.memo) ?? t.memo;
    g.labels.set(label, (g.labels.get(label) ?? 0) + 1);
    g.txs.push(t);
    groups.set(id, g);
  }
  return [...groups]
    .map(([id, g]) => {
      const label = [...g.labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return {
        id,
        direction: g.direction,
        label,
        term: suggestRuleTerm(g.txs[0].memo),
        transactions: [...g.txs].sort((a, b) => b.date.localeCompare(a.date)),
        total: Math.round(g.txs.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      };
    })
    .sort(
      (a, b) =>
        b.transactions.length - a.transactions.length ||
        Math.abs(b.total) - Math.abs(a.total) ||
        a.label.localeCompare(b.label)
    );
}

/* =========================================================================
   Avaliação de termos de regra
   ========================================================================= */

/** Palavras que descrevem a operação e não identificam ninguém. */
const GENERIC_WORDS = new Set([
  'pix', 'enviado', 'enviada', 'recebido', 'recebida', 'transferencia', 'transf', 'ted', 'doc', 'pagamento', 'pagto', 'pag',
  'compra', 'debito', 'credito', 'saque', 'deposito', 'boleto', 'fatura', 'de', 'da', 'do', 'no', 'na', 'pelo', 'para', 'por', 'em',
  'efetuado', 'efetuada', 'a', 'o', 'e',
]);

export type TermLevel = 'ok' | 'broad' | 'generic';

export interface TermAssessment {
  /**
   * generic: o termo só tem palavras que descrevem a operação (ou é curto demais);
   * broad: casa com muitos favorecidos diferentes;
   * ok: específico.
   */
  level: TermLevel;
  reasons: string[];
  /** Lançamentos (da amostra) que o termo casaria. */
  matchCount: number;
  /** Favorecidos diferentes entre eles. */
  payeeCount: number;
}

/** Quantos favorecidos diferentes tornam o termo amplo demais. */
const BROAD_PAYEES = 3;
/** Fração da amostra a partir da qual o termo "casa com quase tudo". */
const BROAD_SHARE = 0.4;
const SHARE_MIN_SAMPLE = 10;

/**
 * Avalia um termo de regra contra descrições existentes (amostra): "enviado" ou "pix"
 * casariam com dezenas de favorecidos diferentes e classificariam tudo na mesma conta.
 */
export function assessRuleTerm(
  rule: Pick<ClassificationRule, 'pattern' | 'matchType'> | { pattern: string; matchType?: RuleMatchType },
  memos: readonly string[]
): TermAssessment {
  const reasons: string[] = [];
  const key = textKey(rule.pattern);
  const words = key.split(' ').filter(Boolean);
  const type = rule.matchType ?? 'CONTAINS';

  let level: TermLevel = 'ok';
  if (type !== 'REGEX') {
    if (!words.length) {
      level = 'generic';
      reasons.push('O termo está vazio.');
    } else if (words.every((w) => GENERIC_WORDS.has(w))) {
      level = 'generic';
      reasons.push('O termo só tem palavras que descrevem a operação (como “pix”, “enviado” ou “recebido”), não um favorecido.');
    } else if (key.replace(/ /g, '').length < 4) {
      level = 'generic';
      reasons.push('O termo é muito curto e casaria com descrições sem relação entre si.');
    }
  }

  const matched = memos.filter((m) => matchesRule(m, { pattern: rule.pattern, matchType: type }));
  const payees = new Set(matched.map(payeeKey));
  if (matched.length > 0 && payees.size >= BROAD_PAYEES) {
    if (level === 'ok') level = 'broad';
    reasons.push(`Casa com ${matched.length} lançamento(s) de ${payees.size} favorecidos diferentes.`);
  } else if (memos.length >= SHARE_MIN_SAMPLE && matched.length / memos.length >= BROAD_SHARE && payees.size >= 2) {
    if (level === 'ok') level = 'broad';
    reasons.push(`Casa com ${Math.round((matched.length / memos.length) * 100)}% dos lançamentos carregados.`);
  }

  return { level, reasons, matchCount: matched.length, payeeCount: payees.size };
}
