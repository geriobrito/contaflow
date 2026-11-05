import type { ClientCompany, CompanyPorte } from '@/types/firestore';

/**
 * Norma contábil das demonstrações pelo porte da empresa (CFC, vigência 01/01/2023, que
 * revogou a ITG 1000):
 * - NBC TG 1002: microentidades (receita bruta anual até R$ 4,8 milhões).
 * - NBC TG 1001: pequenas empresas (acima disso, até R$ 78 milhões).
 */

/** Porte assumido quando o cadastro não informa (clientes anteriores ao campo). */
export const DEFAULT_PORTE: CompanyPorte = 'MICROENTIDADE';

export const PORTE_LABEL: Record<CompanyPorte, string> = {
  MICROENTIDADE: 'Microentidade',
  PEQUENA_EMPRESA: 'Pequena empresa',
};

export const PORTE_HINT: Record<CompanyPorte, string> = {
  MICROENTIDADE: 'NBC TG 1002 — receita bruta anual até R$ 4,8 milhões.',
  PEQUENA_EMPRESA: 'NBC TG 1001 — receita bruta anual acima de R$ 4,8 milhões, até R$ 78 milhões.',
};

const STANDARD: Record<CompanyPorte, { code: string; scope: string }> = {
  MICROENTIDADE: { code: 'NBC TG 1002', scope: 'Microentidades' },
  PEQUENA_EMPRESA: { code: 'NBC TG 1001', scope: 'Pequenas Empresas' },
};

export function porteOf(client?: Pick<ClientCompany, 'porte'> | null): CompanyPorte {
  const porte = client?.porte;
  return porte && porte in STANDARD ? porte : DEFAULT_PORTE;
}

/** Só o código da norma ("NBC TG 1002"), para textos corridos das telas. */
export function accountingStandardCode(client?: Pick<ClientCompany, 'porte'> | null): string {
  return STANDARD[porteOf(client)].code;
}

/**
 * Norma citada no cabeçalho do Balanço, Balancete, DRE e Razão ("NBC TG 1002 - Microentidades"),
 * com hífen entre espaços.
 */
export function accountingStandard(client?: Pick<ClientCompany, 'porte'> | null): string {
  const { code, scope } = STANDARD[porteOf(client)];
  return `${code} - ${scope}`;
}

/**
 * Declaração de conformidade no fim das demonstrações (Balanço, DRE, DLPA e DFC). Obrigatória
 * nas três normas; na NBC TG 1002, com a descrição da atividade operacional, porque as notas
 * explicativas são facultativas. Sem a atividade no cadastro, sai só a declaração (a tela avisa).
 */
export function conformityStatement(client?: Pick<ClientCompany, 'porte' | 'activity'> | null): string {
  const { code, scope } = STANDARD[porteOf(client)];
  const activity = client?.activity?.replace(/\s+/g, ' ').trim().replace(/[.;\s]+$/, '');
  return [
    `Declaração de conformidade: estas demonstrações contábeis foram elaboradas de acordo com a ${code} - Contabilidade para ${scope}, aprovada pelo Conselho Federal de Contabilidade (CFC).`,
    ...(activity ? [`Atividade operacional da entidade: ${activity}.`] : []),
  ].join(' ');
}
