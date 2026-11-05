import type { ClientCompany, OrgSettings } from '@/types/firestore';
import { accountingStandard } from '@/lib/accounting-standard';
import { formatIssueDate } from '@/lib/export/dre-rows';
import { formatCNPJ } from '@/lib/utils/formatters';

/**
 * Carta de responsabilidade da administração: o representante legal declara ao profissional da
 * contabilidade que as informações e os documentos do exercício são fidedignos. Texto-padrão,
 * montado com os dados do cadastro; quem assina é só a administração.
 */

export interface ResponsibilityLetter {
  /** "Recife/PE, 04 de novembro de 2026." (sem município, só a data). */
  place: string;
  /** Destinatário, uma linha por item. */
  addressee: string[];
  reference: string;
  salutation: string;
  intro: string;
  /** Declarações, já com a letra ("a) ..."). */
  items: string[];
  closing: string;
  farewell: string;
  signer: { name?: string; cpf?: string };
}

export interface LetterInput {
  client: Pick<ClientCompany, 'name' | 'cnpj' | 'porte' | 'city' | 'legalRepresentativeName' | 'legalRepresentativeCpf'>;
  org: Pick<OrgSettings, 'officeName' | 'accountantName' | 'accountantCrc'> | null | undefined;
  year: string;
  issuedAt: Date;
}

const DECLARATIONS = [
  'as informações, os registros e os documentos entregues para a escrituração contábil são fidedignos e completos, e a empresa mantém controles internos adequados ao seu porte e à sua atividade;',
  'não foram praticadas operações à margem da lei nem atos ilegais que devessem estar registrados ou divulgados nas demonstrações contábeis;',
  'os documentos emitidos e recebidos são idôneos e foram todos entregues para a escrituração;',
  'os estoques, quando existentes, foram levantados fisicamente e avaliados corretamente na data do balanço;',
  'não temos conhecimento de fraudes, nem de fatos ou eventos que possam afetar a continuidade das operações da empresa ou que exijam ajuste ou divulgação nas demonstrações contábeis.',
];

export function buildResponsibilityLetter({ client, org, year, issuedAt }: LetterInput): ResponsibilityLetter {
  const city = client.city?.trim();
  const accountant = org?.accountantName?.trim();
  const crc = org?.accountantCrc?.trim();
  const office = org?.officeName?.trim();
  const cnpj = client.cnpj ? formatCNPJ(client.cnpj) : '';
  // "NBC TG 1002 - Contabilidade para Microentidades", como nas notas.
  const standard = accountingStandard(client).replace(' - ', ' - Contabilidade para ');
  return {
    place: `${city ? `${city}, ` : ''}${formatIssueDate(issuedAt)}.`,
    addressee: [
      'Ao(À)',
      accountant || 'Profissional da contabilidade responsável',
      ...(crc ? [`Contador(a) - CRC ${crc}`] : []),
      ...(office && office !== accountant ? [office] : []),
    ],
    reference: `Ref.: Demonstrações contábeis do exercício findo em 31 de dezembro de ${year}`,
    salutation: 'Prezado(a) senhor(a),',
    intro: `Na qualidade de administradores da ${client.name}${cnpj ? `, inscrita no CNPJ sob o nº ${cnpj}` : ''}, e em conexão com a elaboração das demonstrações contábeis do exercício findo em 31 de dezembro de ${year}, de acordo com a ${standard}, declaramos, para os devidos fins, que:`,
    items: DECLARATIONS.map((text, i) => `${String.fromCharCode(97 + i)}) ${text}`),
    closing: 'Reconhecemos que a administração é responsável pelas informações prestadas e pelas demonstrações contábeis, elaboradas pelo profissional da contabilidade com base nelas.',
    farewell: 'Atenciosamente,',
    signer: { name: client.legalRepresentativeName?.trim() || undefined, cpf: client.legalRepresentativeCpf?.trim() || undefined },
  };
}

/** O que falta no cadastro para a carta sair completa; a carta sai mesmo assim. */
export function letterGaps(client: LetterInput['client'], org: LetterInput['org']): string[] {
  const gaps: string[] = [];
  if (!client.legalRepresentativeName?.trim() || !client.legalRepresentativeCpf?.trim()) {
    gaps.push('Representante legal (nome e CPF) não cadastrado em Clientes: a assinatura sai com o espaço em branco.');
  }
  if (!org?.accountantName?.trim() || !org?.accountantCrc?.trim()) {
    gaps.push('Contador responsável (nome e CRC) não cadastrado em Escritório: a carta sai endereçada ao profissional da contabilidade.');
  }
  if (!client.city?.trim()) gaps.push('Município/UF da empresa não cadastrado: a carta sai só com a data.');
  return gaps;
}
