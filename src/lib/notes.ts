import type { ClientCompany, ExplanatoryNoteBlock, TaxRegime } from '@/types/firestore';
import { accountingStandard, porteOf } from '@/lib/accounting-standard';
import { formatCNPJ, formatCurrency } from '@/lib/utils/formatters';

/**
 * Notas explicativas: blocos de texto-padrão que o contador revisa e completa antes de gerar o
 * PDF. Trechos entre colchetes ([...]) são o que falta preencher com dados da empresa.
 */

export type NoteId = 'context' | 'basis' | 'policies' | 'equity' | 'consumption-taxes' | 'subsequent';

export interface NoteBlock extends ExplanatoryNoteBlock {
  id: NoteId;
}

const REGIME_LABEL: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'Simples Nacional, como Microempreendedor Individual (MEI)',
};

/**
 * Regime normal (fora do Simples): é a ele que se aplicam CBS e IBS destacados por fora. As alíquotas-teste
 * de 2026 não se aplicam aos optantes pelo Simples Nacional (art. 348, III, "c", da Lei Complementar nº 214/2025).
 */
export const isNormalRegime = (regime: TaxRegime | undefined) => regime === 'LUCRO_PRESUMIDO' || regime === 'LUCRO_REAL';

/** Trechos ainda por preencher. */
export const PLACEHOLDER = /\[[^\]]+\]/g;
export const placeholdersIn = (text: string): string[] => text.match(PLACEHOLDER) ?? [];

/** Saldos do exercício (em 31/12) que preenchem a nota de patrimônio líquido. */
export interface NoteFigures {
  /** 2.3.1.01 Capital Subscrito. */
  capital: number;
  /** 2.3.1.02 (-) Capital a Integralizar, em valor positivo. */
  capitalToPay: number;
  /** Lucro (positivo) ou prejuízo do exercício. */
  netResult: number;
  /** Lucros distribuídos no exercício, em valor positivo. */
  distributions: number;
  /** Lucros ou prejuízos acumulados em 31/12 (saldo final da DLPA). */
  retained: number;
  /** Exercício já encerrado (ARE lançada). */
  closed: boolean;
}

function equityText(year: string, f: NoteFigures | null | undefined): string {
  if (!f) {
    return `O capital social subscrito e integralizado é de R$ [valor], dividido em [número] quotas de R$ [valor] cada. O resultado do exercício de ${year} foi transferido para Lucros ou Prejuízos Acumulados[, e foram distribuídos lucros aos sócios no valor de R$ (valor)].`;
  }
  const result = `${f.netResult >= 0 ? 'lucro' : 'prejuízo'} de ${formatCurrency(Math.abs(f.netResult))}`;
  return [
    `O capital social subscrito é de ${formatCurrency(f.capital)}${f.capitalToPay ? `, dos quais ${formatCurrency(f.capitalToPay)} a integralizar` : ', totalmente integralizado'}, dividido em [número] quotas de R$ [valor] cada.`,
    `O ${result} do exercício de ${year} ${f.closed ? 'foi transferido' : 'será transferido, no encerramento do exercício,'} para Lucros ou Prejuízos Acumulados${
      f.distributions ? `, e foram distribuídos lucros aos sócios no valor de ${formatCurrency(f.distributions)}` : ''
    }.`,
    `Em 31 de dezembro de ${year}, o saldo de ${f.retained >= 0 ? 'lucros acumulados' : 'prejuízos acumulados'} é de ${formatCurrency(Math.abs(f.retained))}.`,
  ].join(' ');
}

export function defaultNotes(
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'regime' | 'taxRegime' | 'porte'>,
  year: string,
  figures?: NoteFigures | null
): NoteBlock[] {
  const regime = client.regime ?? client.taxRegime;
  const small = porteOf(client) === 'PEQUENA_EMPRESA';
  // "NBC TG 1002 - Contabilidade para Microentidades".
  const standard = accountingStandard(client).replace(' - ', ' - Contabilidade para ');
  const end = `31 de dezembro de ${year}`;
  const cnpj = client.cnpj ? formatCNPJ(client.cnpj) : '[CNPJ]';

  const consumption =
    Number(year) >= 2026
      ? `A Emenda Constitucional nº 132/2023 e a Lei Complementar nº 214/2025 instituíram a Contribuição sobre Bens e Serviços (CBS) e o Imposto sobre Bens e Serviços (IBS), que substituirão gradualmente o PIS, a COFINS, o IPI, o ICMS e o ISS. Em ${year}, período de teste da transição, a CBS (0,9%) e o IBS (0,1%) são destacados nos documentos fiscais, com recolhimento dispensado quando cumpridas as obrigações acessórias, sem efeito no resultado do exercício, nos termos dos arts. 343, 346 e 348, § 1º, da Lei Complementar nº 214/2025 e dos itens 17, 29.5 e 29.7 da Orientação Técnica CFC nº 01/2026 (combinados com a NBC TG 25). A entidade [descreva as providências adotadas e os efeitos esperados da transição sobre preços, sistemas e capital de giro].`
      : `A Emenda Constitucional nº 132/2023 e a Lei Complementar nº 214/2025 instituíram a Contribuição sobre Bens e Serviços (CBS) e o Imposto sobre Bens e Serviços (IBS), que substituirão gradualmente o PIS, a COFINS, o IPI, o ICMS e o ISS a partir de 2026. A entidade [descreva os efeitos esperados da transição].`;

  return [
    {
      id: 'context',
      title: 'Contexto operacional',
      enabled: true,
      text: `${client.name}, inscrita no CNPJ sob o nº ${cnpj}, é uma sociedade [empresária limitada] com sede em [município/UF], que tem por objeto [descreva a atividade principal]. A entidade é tributada pelo ${regime ? REGIME_LABEL[regime] : '[regime tributário]'}.`,
    },
    {
      id: 'basis',
      title: 'Base de preparação',
      enabled: true,
      text: `As demonstrações contábeis do exercício findo em ${end} foram elaboradas de acordo com a ${standard}, aprovada pelo Conselho Federal de Contabilidade (CFC), e compreendem ${
        small
          ? 'o Balanço Patrimonial, a Demonstração do Resultado e a Demonstração de Lucros ou Prejuízos Acumulados [e as demais demonstrações apresentadas]'
          : 'o Balanço Patrimonial e a Demonstração do Resultado'
      }, acompanhadas destas notas. Os valores estão expressos em reais (R$).`,
    },
    {
      id: 'policies',
      title: 'Principais práticas contábeis',
      enabled: true,
      text: [
        'a) Regime de competência: receitas e despesas são reconhecidas no período em que ocorrem, independentemente de recebimento ou pagamento.',
        'b) Caixa e equivalentes de caixa: saldos em caixa, depósitos bancários e aplicações financeiras de liquidez imediata.',
        'c) Contas a receber e a pagar: registradas pelo valor das operações[, ajustadas por perdas estimadas quando aplicável].',
        'd) Imobilizado: registrado pelo custo de aquisição, deduzido da depreciação acumulada, calculada pelo método linear [informe as taxas ou a vida útil adotadas].',
      ].join('\n'),
    },
    {
      id: 'equity',
      title: 'Patrimônio líquido',
      enabled: true,
      text: equityText(year, figures),
    },
    {
      id: 'consumption-taxes',
      title: 'Reforma tributária do consumo (CBS e IBS)',
      enabled: isNormalRegime(regime),
      text: consumption,
    },
    {
      id: 'subsequent',
      title: 'Eventos subsequentes',
      enabled: true,
      text: 'Não ocorreram, entre a data do balanço e a data de autorização destas demonstrações, eventos que exigissem ajuste ou divulgação [ou descreva-os].',
    },
  ];
}

/**
 * Blocos guardados sobre os padrões: a ordem e os blocos são sempre os do padrão (blocos novos
 * aparecem), e o que foi salvo substitui título, texto e seleção.
 */
export function mergeNotes(defaults: readonly NoteBlock[], saved: readonly Partial<ExplanatoryNoteBlock>[] | null | undefined): NoteBlock[] {
  const byId = new Map((saved ?? []).filter((s) => s.id).map((s) => [s.id, s] as const));
  return defaults.map((d) => {
    const s = byId.get(d.id);
    return {
      ...d,
      ...(typeof s?.title === 'string' ? { title: s.title } : {}),
      ...(typeof s?.text === 'string' ? { text: s.text } : {}),
      ...(typeof s?.enabled === 'boolean' ? { enabled: s.enabled } : {}),
    };
  });
}
