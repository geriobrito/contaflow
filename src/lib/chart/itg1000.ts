import type { AccountType, ChartAccount, DREGroup } from '@/types/firestore';

/**
 * Modelo de Plano de Contas Simplificado para ME/EPP
 * ITG 1000 — Resolução CFC nº 1.418/2012.
 *
 * Níveis 1–3 são sintéticos (totalizadores); o nível 4 é analítico e recebe lançamentos.
 * `contra` marca contas redutoras; `dre` amarra a conta de resultado ao `buildDRE`.
 */
interface TemplateEntry {
  code: string;
  name: string;
  contra?: boolean;
  dre?: DREGroup;
}

const ENTRIES: readonly TemplateEntry[] = [
  { code: '1', name: 'ATIVO' },
  { code: '1.1', name: 'ATIVO CIRCULANTE' },
  { code: '1.1.1', name: 'Caixa e Equivalentes de Caixa' },
  { code: '1.1.1.01', name: 'Caixa' },
  { code: '1.1.1.02', name: 'Bancos Conta Movimento' },
  { code: '1.1.2', name: 'Contas a Receber' },
  { code: '1.1.2.01', name: 'Clientes' },
  { code: '1.1.2.02', name: '(-) Perdas Estimadas com Créditos de Liquidação Duvidosa', contra: true },
  { code: '1.1.3', name: 'Estoque' },
  { code: '1.1.3.01', name: 'Mercadorias' },
  { code: '1.1.3.02', name: 'Produtos Acabados' },
  { code: '1.1.3.03', name: 'Insumos' },
  { code: '1.1.4', name: 'Outros Créditos' },
  { code: '1.1.4.01', name: 'Títulos a Receber' },
  { code: '1.1.4.02', name: 'Impostos a Recuperar' },
  { code: '1.1.4.03', name: 'Outros Valores a Receber' },
  { code: '1.3', name: 'ATIVO NÃO CIRCULANTE' },
  { code: '1.3.1', name: 'Realizável a Longo Prazo' },
  { code: '1.3.1.01', name: 'Contas a Receber' },
  { code: '1.3.1.02', name: '(-) Perdas Estimadas com Créditos de Liquidação Duvidosa', contra: true },
  { code: '1.3.2', name: 'Investimentos' },
  { code: '1.3.2.01', name: 'Participações Societárias' },
  { code: '1.3.2.02', name: 'Outros Investimentos' },
  { code: '1.3.3', name: 'Imobilizado' },
  { code: '1.3.3.01', name: 'Terrenos' },
  { code: '1.3.3.02', name: 'Edificações' },
  { code: '1.3.3.03', name: 'Máquinas e Equipamentos' },
  { code: '1.3.3.04', name: 'Veículos' },
  { code: '1.3.3.05', name: 'Móveis e Utensílios' },
  { code: '1.3.3.06', name: '(-) Depreciação Acumulada', contra: true },
  { code: '1.3.4', name: 'Intangível' },
  { code: '1.3.4.01', name: 'Softwares' },
  { code: '1.3.4.02', name: '(-) Amortização Acumulada', contra: true },

  { code: '2', name: 'PASSIVO E PATRIMÔNIO LÍQUIDO' },
  { code: '2.1', name: 'PASSIVO CIRCULANTE' },
  { code: '2.1.1', name: 'Fornecedores Nacionais' },
  { code: '2.1.1.01', name: 'Fornecedor' },
  { code: '2.1.2', name: 'Empréstimos e Financiamentos' },
  { code: '2.1.2.01', name: 'Empréstimos Bancários' },
  { code: '2.1.2.02', name: 'Financiamentos' },
  { code: '2.1.3', name: 'Obrigações Fiscais' },
  { code: '2.1.3.01', name: 'SIMPLES NACIONAL' },
  { code: '2.1.3.02', name: 'ICMS a Recolher' },
  { code: '2.1.3.03', name: 'ISSQN a Recolher' },
  { code: '2.1.4', name: 'Obrigações Trabalhistas e Sociais' },
  { code: '2.1.4.01', name: 'Salários a Pagar' },
  { code: '2.1.4.02', name: 'FGTS a Recolher' },
  { code: '2.1.4.03', name: 'INSS dos Segurados a Recolher' },
  { code: '2.1.5', name: 'Contas a Pagar' },
  { code: '2.1.5.01', name: 'Telefone a Pagar' },
  { code: '2.1.5.02', name: 'Energia a Pagar' },
  { code: '2.1.5.03', name: 'Aluguel a Pagar' },
  { code: '2.1.6', name: 'Provisões' },
  { code: '2.1.6.01', name: 'Provisão de Férias' },
  { code: '2.1.6.02', name: 'Provisão de 13° Salário' },
  { code: '2.1.6.03', name: 'Provisão de Encargos Sociais sobre Férias e 13° Salário' },
  { code: '2.2', name: 'PASSIVO NÃO CIRCULANTE' },
  { code: '2.2.1', name: 'Financiamentos' },
  { code: '2.2.1.01', name: 'Financiamentos Banco A' },
  { code: '2.2.2', name: 'Outras Contas a Pagar' },
  { code: '2.2.2.01', name: 'Empréstimos de Sócios' },
  { code: '2.3', name: 'PATRIMÔNIO LÍQUIDO' },
  { code: '2.3.1', name: 'Capital Social' },
  { code: '2.3.1.01', name: 'Capital Subscrito' },
  { code: '2.3.1.02', name: '(-) Capital a Integralizar', contra: true },
  { code: '2.3.2', name: 'Reservas' },
  { code: '2.3.2.01', name: 'Reservas de Capital' },
  { code: '2.3.2.02', name: 'Reservas de Lucros' },
  { code: '2.3.3', name: 'Lucros/Prejuízos Acumulados' },
  { code: '2.3.3.01', name: 'Lucros Acumulados' },
  { code: '2.3.3.02', name: '(-) Prejuízos Acumulados', contra: true },

  { code: '3', name: 'RECEITAS, CUSTOS E DESPESAS (CONTAS DE RESULTADO)' },
  { code: '3.1', name: 'RECEITAS' },
  { code: '3.1.1', name: 'Receitas de Venda' },
  { code: '3.1.1.01', name: 'Venda de Produtos', dre: 'GROSS_REVENUE' },
  { code: '3.1.1.02', name: 'Venda de Mercadorias', dre: 'GROSS_REVENUE' },
  { code: '3.1.1.03', name: 'Venda de Serviços', dre: 'GROSS_REVENUE' },
  { code: '3.1.1.04', name: '(-) Deduções de Tributos, Abatimentos e Devoluções', contra: true, dre: 'DEDUCTIONS' },
  { code: '3.1.2', name: 'Receitas Financeiras' },
  { code: '3.1.2.01', name: 'Receitas de Aplicações Financeiras', dre: 'FINANCIAL_INCOME' },
  { code: '3.1.2.02', name: 'Juros Ativos', dre: 'FINANCIAL_INCOME' },
  { code: '3.1.3', name: 'Outras Receitas Operacionais' },
  { code: '3.1.3.01', name: 'Receitas de Venda de Imobilizado', dre: 'OTHER_INCOME' },
  { code: '3.1.3.02', name: 'Receitas de Venda de Investimentos', dre: 'OTHER_INCOME' },
  { code: '3.1.3.03', name: 'Outras Receitas', dre: 'OTHER_INCOME' },
  { code: '3.2', name: 'CUSTOS E DESPESAS' },
  { code: '3.2.1', name: 'Custos dos Produtos, Mercadorias e Serviços Vendidos' },
  { code: '3.2.1.01', name: 'Custos dos Insumos', dre: 'COSTS' },
  { code: '3.2.1.02', name: 'Custos da Mão de Obra', dre: 'COSTS' },
  { code: '3.2.1.03', name: 'Outros Custos', dre: 'COSTS' },
  { code: '3.2.2', name: 'Despesas Operacionais' },
  { code: '3.2.2.01', name: 'Despesas Administrativas', dre: 'OPERATING_EXPENSES' },
  { code: '3.2.2.02', name: 'Despesas com Vendas', dre: 'OPERATING_EXPENSES' },
  { code: '3.2.2.03', name: 'Outras Despesas Gerais', dre: 'OPERATING_EXPENSES' },
  { code: '3.2.3', name: 'Despesas Financeiras' },
  { code: '3.2.3.01', name: 'Juros Passivos', dre: 'FINANCIAL_EXPENSES' },
  { code: '3.2.3.02', name: 'Outras Despesas Financeiras', dre: 'FINANCIAL_EXPENSES' },
  { code: '3.2.4', name: 'Outras Despesas Operacionais' },
  { code: '3.2.4.01', name: 'Despesas com Baixa de Imobilizado', dre: 'OTHER_EXPENSES' },
  { code: '3.2.4.02', name: 'Despesas com Baixa de Investimentos', dre: 'OTHER_EXPENSES' },
  { code: '3.2.4.03', name: 'Outras Despesas', dre: 'OTHER_EXPENSES' },
];

/** Natureza econômica da conta a partir da posição no plano. */
function typeFor(code: string): AccountType {
  if (code.startsWith('1')) return 'ASSET';
  if (code.startsWith('2.3')) return 'EQUITY';
  if (code.startsWith('2')) return 'LIABILITY';
  if (code.startsWith('3.1')) return 'REVENUE';
  if (code.startsWith('3.2.1')) return 'COST';
  if (code.startsWith('3.2')) return 'EXPENSE';
  return 'REVENUE'; // grupo 3 (totalizador de resultado)
}

const parentCode = (code: string): string | null => {
  const i = code.lastIndexOf('.');
  return i < 0 ? null : code.slice(0, i);
};

/**
 * Gera o plano ITG 1000 para um cliente. IDs são determinísticos (`${clientId}_itg_${code}`),
 * o que torna a aplicação do modelo idempotente.
 */
export function buildITG1000Chart(clientId: string, now: string = new Date().toISOString()): ChartAccount[] {
  const idFor = (code: string) => `${clientId}_itg_${code}`;
  return ENTRIES.map((e) => {
    const level = e.code.split('.').length;
    const parent = parentCode(e.code);
    const account: ChartAccount = {
      id: idFor(e.code),
      clientId,
      code: e.code,
      name: e.name,
      type: typeFor(e.code),
      nature: level === 4 ? 'ANALYTIC' : 'SYNTHETIC',
      level,
      createdAt: now,
      updatedAt: now,
    };
    if (parent) account.parentId = idFor(parent);
    if (e.dre) account.dreGroup = e.dre;
    if (e.contra) account.isContra = true;
    return account;
  });
}

export const ITG1000_ACCOUNT_COUNT = ENTRIES.length;
