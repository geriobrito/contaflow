import type { BankAccount, ChartAccount, ClientCompany, OpeningBalances, OrgSettings } from '@/types/firestore';
import { plural } from '@/lib/dashboard';
import { openingStatus } from '@/lib/opening';
import { formatDateBR } from '@/lib/utils/formatters';

/**
 * Implantação de uma empresa: os Cadastros na ordem em que são feitos (a mesma do menu), com o
 * que falta em cada um. Função pura sobre dados já carregados; a faixa no topo das telas de
 * Cadastros a exibe.
 */

/**
 * - `done`: pronto;
 * - `todo`: falta, e trava o trabalho (sem plano não se classifica; sem abertura o balanço não fecha);
 * - `hint`: falta, mas só aparece nas demonstrações exportadas ou melhora com o uso.
 */
export type SetupStatus = 'done' | 'todo' | 'hint';

export interface SetupStep {
  key: 'client' | 'chart' | 'banks' | 'opening' | 'rules' | 'office';
  label: string;
  href: string;
  status: SetupStatus;
  detail: string;
}

export interface SetupInput {
  client: Pick<ClientCompany, 'activity' | 'legalRepresentativeName' | 'legalRepresentativeCpf'>;
  accounts: readonly ChartAccount[];
  banks: readonly BankAccount[];
  openings: OpeningBalances | null;
  /** Regras de aprendizado da empresa. */
  rules: number;
  org: Pick<OrgSettings, 'accountantName' | 'accountantCrc'> | null;
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const { client, accounts, banks, openings, rules, org } = input;
  const steps: SetupStep[] = [];

  /* 1. Cliente: o que assina e identifica as demonstrações */
  const missing = [
    !client.activity?.trim() && 'atividade principal',
    (!client.legalRepresentativeName || !client.legalRepresentativeCpf) && 'representante legal (nome e CPF)',
  ].filter((m): m is string => Boolean(m));
  steps.push({
    key: 'client',
    label: 'Clientes',
    href: '/clientes',
    status: missing.length ? 'hint' : 'done',
    detail: missing.length ? `Falta no cadastro: ${missing.join(' e ')}. As demonstrações exportadas saem sem isso.` : 'Cadastro completo para as demonstrações.',
  });

  /* 2. Plano de contas */
  const analytic = accounts.filter((a) => a.nature === 'ANALYTIC').length;
  steps.push({
    key: 'chart',
    label: 'Plano de Contas',
    href: '/plano-de-contas',
    status: analytic > 0 ? 'done' : 'todo',
    detail: analytic > 0 ? `${plural(analytic, 'conta analítica', 'contas analíticas')} para classificar.` : 'Plano de contas vazio: aplique o modelo do CFC para poder classificar.',
  });

  /* 3. Contas e extratos */
  const unlinked = banks.filter((b) => !b.ledgerAccountId).length;
  const noOpening = banks.filter((b) => b.openingBalance === undefined).length;
  steps.push({
    key: 'banks',
    label: 'Contas e Extratos',
    href: '/contas',
    ...(banks.length === 0
      ? { status: 'todo' as const, detail: 'Nenhuma conta bancária: importe o primeiro extrato na Conciliação ou cadastre a conta.' }
      : unlinked > 0
        ? { status: 'todo' as const, detail: `${plural(unlinked, 'conta bancária', 'contas bancárias')} sem conta contábil: o balanço mostra o saldo como “Bancos sem vínculo”.` }
        : noOpening > 0
          ? { status: 'todo' as const, detail: `${plural(noOpening, 'conta bancária', 'contas bancárias')} sem saldo inicial.` }
          : { status: 'done' as const, detail: `${plural(banks.length, 'conta ligada', 'contas ligadas')} ao plano, com saldo inicial.` }),
  });

  /* 4. Balanço de abertura */
  const opening = openingStatus(openings, accounts, banks);
  steps.push({
    key: 'opening',
    label: 'Balanço de Abertura',
    href: '/abertura',
    status: opening.problems.length ? 'todo' : 'done',
    detail: opening.problems[0] ?? (opening.date ? `Abertura conferida em ${formatDateBR(opening.date)}.` : 'Abertura conferida.'),
  });

  /* 5. Regras de aprendizado: nascem do uso */
  steps.push({
    key: 'rules',
    label: 'Regras de Aprendizado',
    href: '/regras',
    status: rules > 0 ? 'done' : 'hint',
    detail: rules > 0 ? `${plural(rules, 'regra classifica', 'regras classificam')} os próximos extratos sozinha${rules > 1 ? 's' : ''}.` : 'Nenhuma regra ainda: elas nascem ao classificar com “aprender regra” na Conciliação.',
  });

  /* 6. Escritório: quem assina */
  const signed = Boolean(org?.accountantName && org?.accountantCrc);
  steps.push({
    key: 'office',
    label: 'Escritório',
    href: '/escritorio',
    status: signed ? 'done' : 'hint',
    detail: signed ? 'Contador responsável e CRC cadastrados.' : 'Contador responsável ou CRC não cadastrado: as demonstrações saem sem a assinatura do profissional.',
  });

  return steps;
}

/** O que fazer agora: o primeiro passo que trava o trabalho; sem nenhum, o primeiro a completar. */
export const nextSetupStep = (steps: readonly SetupStep[]): SetupStep | null =>
  steps.find((s) => s.status === 'todo') ?? steps.find((s) => s.status === 'hint') ?? null;
