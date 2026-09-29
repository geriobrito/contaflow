import type { AccountType, ChartAccount, DREGroup } from '@/types/firestore';

/**
 * Modelo de Plano de Contas para Microentidades — ITG 1000 (CFC, 15/12/2022),
 * NBC TG 1002, Anexo 11 (receita bruta anual até R$ 4,8 milhões).
 *
 * Regras do modelo:
 * - Contas com subcontas são SINTÉTICAS: apenas agrupam e totalizam.
 * - Contas-folha são ANALÍTICAS: as únicas que recebem lançamentos (conciliação/OFX).
 *   A maioria está no nível 4; o Resultado Financeiro desce ao nível 5
 *   (3.4.1.01.xxx despesas / 3.4.1.02.xxx receitas).
 * - `contra` marca contas redutoras; `dre` amarra a conta ao `buildDRE` e é
 *   herdado pelas subcontas do ramo.
 */
interface TemplateEntry {
  code: string;
  name: string;
  contra?: boolean;
  dre?: DREGroup;
  /** Natureza explícita quando difere da regra por código (ex.: receitas em 3.3.9). */
  type?: AccountType;
}

const ENTRIES: readonly TemplateEntry[] = [
  /* ───────────────────────────── 1 ATIVO ───────────────────────────── */
  { code: '1', name: 'ATIVO' },
  { code: '1.1', name: 'ATIVO CIRCULANTE' },
  { code: '1.1.1', name: 'Disponibilidades' },
  { code: '1.1.1.01', name: 'Caixa' },
  { code: '1.1.1.02', name: 'Bancos Conta Movimento' },
  { code: '1.1.1.03', name: 'Aplicações Financeiras de Liquidez Imediata' },
  // Conta transitória: as duas pernas de uma transferência entre contas próprias se anulam aqui.
  { code: '1.1.1.04', name: 'Transferências entre Contas (Numerário em Trânsito)' },
  { code: '1.1.2', name: 'Créditos' },
  { code: '1.1.2.01', name: 'Clientes' },
  { code: '1.1.2.02', name: '(-) Perdas Estimadas com Créditos de Liquidação Duvidosa', contra: true },
  { code: '1.1.2.03', name: 'Adiantamentos a Fornecedores' },
  { code: '1.1.2.04', name: 'Adiantamentos a Empregados' },
  { code: '1.1.2.05', name: 'Tributos a Recuperar' },
  { code: '1.1.2.06', name: 'Outros Créditos' },
  { code: '1.1.3', name: 'Estoques' },
  { code: '1.1.3.01', name: 'Mercadorias para Revenda' },
  { code: '1.1.3.02', name: 'Produtos Acabados' },
  { code: '1.1.3.03', name: 'Matérias-Primas e Insumos' },
  { code: '1.1.3.04', name: 'Materiais de Consumo' },
  { code: '1.1.4', name: 'Despesas Antecipadas' },
  { code: '1.1.4.01', name: 'Seguros a Apropriar' },
  { code: '1.1.4.02', name: 'Outras Despesas Antecipadas' },

  { code: '1.2', name: 'ATIVO NÃO CIRCULANTE' },
  { code: '1.2.1', name: 'Realizável a Longo Prazo' },
  { code: '1.2.1.01', name: 'Créditos com Sócios' },
  { code: '1.2.1.02', name: 'Depósitos Judiciais' },
  { code: '1.2.1.03', name: 'Outros Créditos de Longo Prazo' },
  { code: '1.2.2', name: 'Investimentos' },
  { code: '1.2.2.01', name: 'Participações Societárias' },
  { code: '1.2.2.02', name: 'Outros Investimentos' },
  { code: '1.2.3', name: 'Imobilizado' },
  { code: '1.2.3.01', name: 'Terrenos' },
  { code: '1.2.3.02', name: 'Edificações' },
  { code: '1.2.3.03', name: 'Máquinas e Equipamentos' },
  { code: '1.2.3.04', name: 'Veículos' },
  { code: '1.2.3.05', name: 'Móveis e Utensílios' },
  { code: '1.2.3.06', name: 'Equipamentos de Informática' },
  { code: '1.2.3.07', name: '(-) Depreciação Acumulada', contra: true },
  { code: '1.2.4', name: 'Intangível' },
  { code: '1.2.4.01', name: 'Softwares' },
  { code: '1.2.4.02', name: 'Marcas e Patentes' },
  { code: '1.2.4.03', name: '(-) Amortização Acumulada', contra: true },

  /* ──────────────────── 2 PASSIVO E PATRIMÔNIO LÍQUIDO ──────────────────── */
  { code: '2', name: 'PASSIVO E PATRIMÔNIO LÍQUIDO' },
  { code: '2.1', name: 'PASSIVO CIRCULANTE' },
  { code: '2.1.1', name: 'Obrigações Trabalhistas' },
  { code: '2.1.1.01', name: 'Salários a Pagar' },
  { code: '2.1.1.02', name: 'Pró-Labore a Pagar' },
  { code: '2.1.1.03', name: 'INSS a Recolher' },
  { code: '2.1.1.04', name: 'FGTS a Recolher' },
  { code: '2.1.1.05', name: 'Provisão de Férias e Encargos' },
  { code: '2.1.1.06', name: 'Provisão de 13º Salário e Encargos' },
  { code: '2.1.2', name: 'Fornecedores' },
  { code: '2.1.2.01', name: 'Fornecedores Nacionais' },
  { code: '2.1.3', name: 'Contas a Pagar' },
  { code: '2.1.3.01', name: 'Aluguéis a Pagar' },
  { code: '2.1.3.02', name: 'Energia Elétrica a Pagar' },
  { code: '2.1.3.03', name: 'Telefone e Internet a Pagar' },
  { code: '2.1.3.04', name: 'Outras Contas a Pagar' },
  { code: '2.1.4', name: 'Empréstimos e Financiamentos' },
  { code: '2.1.4.01', name: 'Empréstimos Bancários' },
  { code: '2.1.4.02', name: 'Financiamentos' },
  { code: '2.1.5', name: 'Obrigações Fiscais' },
  { code: '2.1.5.01', name: 'Simples Nacional a Recolher' },
  { code: '2.1.5.02', name: 'ICMS a Recolher' },
  { code: '2.1.5.03', name: 'ISS a Recolher' },
  { code: '2.1.5.04', name: 'IRRF a Recolher' },
  { code: '2.1.5.05', name: 'Parcelamentos Tributários' },

  { code: '2.2', name: 'PASSIVO NÃO CIRCULANTE' },
  { code: '2.2.1', name: 'Empréstimos e Financiamentos de Longo Prazo' },
  { code: '2.2.1.01', name: 'Empréstimos e Financiamentos' },
  { code: '2.2.2', name: 'Obrigações de Longo Prazo' },
  { code: '2.2.2.01', name: 'Parcelamentos Tributários de Longo Prazo' },
  { code: '2.2.2.02', name: 'Empréstimos de Sócios' },

  { code: '2.3', name: 'PATRIMÔNIO LÍQUIDO' },
  { code: '2.3.1', name: 'Capital Social' },
  { code: '2.3.1.01', name: 'Capital Subscrito' },
  { code: '2.3.1.02', name: '(-) Capital a Integralizar', contra: true },
  { code: '2.3.2', name: 'Reservas' },
  { code: '2.3.2.01', name: 'Reservas de Capital' },
  { code: '2.3.2.02', name: 'Reservas de Lucros' },
  { code: '2.3.3', name: 'Lucros ou Prejuízos Acumulados' },
  { code: '2.3.3.01', name: 'Lucros Acumulados' },
  { code: '2.3.3.02', name: '(-) Prejuízos Acumulados', contra: true },
  { code: '2.3.3.03', name: '(-) Lucros Distribuídos', contra: true },

  /* ───────────────────────────── 3 RESULTADO ───────────────────────────── */
  { code: '3', name: 'CONTAS DE RESULTADO' },
  { code: '3.1', name: 'RECEITAS' },
  { code: '3.1.1', name: 'Receita Bruta', dre: 'GROSS_REVENUE' },
  { code: '3.1.1.01', name: 'Receita de Prestação de Serviços' },
  { code: '3.1.1.02', name: 'Receita de Venda de Mercadorias' },
  { code: '3.1.1.03', name: 'Receita de Venda de Produtos' },
  { code: '3.1.2', name: '(-) Deduções da Receita Bruta', dre: 'DEDUCTIONS', contra: true },
  { code: '3.1.2.01', name: '(-) Simples Nacional' },
  { code: '3.1.2.02', name: '(-) ICMS sobre Vendas' },
  { code: '3.1.2.03', name: '(-) ISS sobre Serviços' },
  { code: '3.1.2.04', name: '(-) Descontos Incondicionais Concedidos' },
  { code: '3.1.2.05', name: '(-) Devoluções de Vendas' },

  { code: '3.2', name: 'CUSTOS', dre: 'COSTS' },
  { code: '3.2.1', name: 'Custos dos Bens e Serviços Vendidos' },
  { code: '3.2.1.01', name: 'Custo das Mercadorias Vendidas' },
  { code: '3.2.1.02', name: 'Custo dos Produtos Vendidos' },
  { code: '3.2.1.03', name: 'Custo dos Serviços Prestados' },

  { code: '3.3', name: 'DESPESAS OPERACIONAIS' },
  { code: '3.3.1', name: 'Despesas com Vendas', dre: 'OPERATING_EXPENSES' },
  { code: '3.3.1.01', name: 'Comissões sobre Vendas' },
  { code: '3.3.1.02', name: 'Propaganda e Publicidade' },
  { code: '3.3.1.03', name: 'Fretes e Entregas' },
  { code: '3.3.2', name: 'Despesas Administrativas', dre: 'OPERATING_EXPENSES' },
  { code: '3.3.2.01', name: 'Salários e Ordenados' },
  { code: '3.3.2.02', name: 'Pró-Labore' },
  { code: '3.3.2.03', name: 'Encargos Sociais (INSS/FGTS)' },
  { code: '3.3.2.04', name: 'Férias e 13º Salário' },
  { code: '3.3.2.05', name: 'Benefícios a Empregados' },
  { code: '3.3.2.06', name: 'Energia Elétrica' },
  { code: '3.3.2.07', name: 'Aluguéis e Condomínios' },
  { code: '3.3.2.08', name: 'Telefone e Internet' },
  { code: '3.3.2.09', name: 'Água e Esgoto' },
  { code: '3.3.2.10', name: 'Material de Escritório e Consumo' },
  { code: '3.3.2.11', name: 'Honorários Contábeis e Profissionais' },
  { code: '3.3.2.12', name: 'Softwares e Assinaturas' },
  { code: '3.3.2.13', name: 'Viagens, Transporte e Locomoção' },
  { code: '3.3.2.14', name: 'Manutenção e Conservação' },
  { code: '3.3.2.15', name: 'Depreciação e Amortização' },
  { code: '3.3.2.16', name: 'Taxas e Contribuições Diversas' },
  { code: '3.3.2.17', name: 'Outras Despesas Gerais' },
  { code: '3.3.9', name: 'Outros Resultados Operacionais' },
  { code: '3.3.9.01', name: 'Outras Receitas Operacionais', dre: 'OTHER_INCOME', type: 'REVENUE' },
  { code: '3.3.9.02', name: 'Ganho na Venda de Imobilizado', dre: 'OTHER_INCOME', type: 'REVENUE' },
  { code: '3.3.9.03', name: 'Outras Despesas Operacionais', dre: 'OTHER_EXPENSES' },
  { code: '3.3.9.04', name: 'Perda na Baixa de Imobilizado', dre: 'OTHER_EXPENSES' },

  { code: '3.4', name: 'RESULTADO FINANCEIRO' },
  { code: '3.4.1', name: 'Resultado Financeiro Líquido' },
  { code: '3.4.1.01', name: 'Despesas Financeiras', dre: 'FINANCIAL_EXPENSES' },
  { code: '3.4.1.01.001', name: 'Juros Passivos' },
  { code: '3.4.1.01.002', name: 'Despesas Bancárias' },
  { code: '3.4.1.01.003', name: 'IOF' },
  { code: '3.4.1.01.004', name: 'Multas e Encargos de Mora' },
  { code: '3.4.1.02', name: 'Receitas Financeiras', dre: 'FINANCIAL_INCOME', type: 'REVENUE' },
  { code: '3.4.1.02.001', name: 'Rendimentos de Aplicações Financeiras' },
  { code: '3.4.1.02.002', name: 'Juros Ativos' },
  { code: '3.4.1.02.003', name: 'Descontos Obtidos' },
];

const parentCode = (code: string): string | null => {
  const i = code.lastIndexOf('.');
  return i < 0 ? null : code.slice(0, i);
};

/** Natureza econômica pela posição no plano (pode ser sobrescrita no ramo). */
function typeByCode(code: string): AccountType {
  if (code.startsWith('1')) return 'ASSET';
  if (code.startsWith('2.3')) return 'EQUITY';
  if (code.startsWith('2')) return 'LIABILITY';
  if (code.startsWith('3.1')) return 'REVENUE';
  if (code.startsWith('3.2')) return 'COST';
  if (code.startsWith('3.3') || code.startsWith('3.4')) return 'EXPENSE';
  return 'REVENUE'; // grupo 3 (totalizador)
}

const byCode = new Map(ENTRIES.map((e) => [e.code, e] as const));
const parentCodes = new Set(ENTRIES.map((e) => parentCode(e.code)).filter((c): c is string => c !== null));

/** Primeiro valor definido subindo do ramo até a raiz. */
function inherited<K extends 'dre' | 'type' | 'contra'>(code: string, key: K): TemplateEntry[K] | undefined {
  for (let c: string | null = code; c; c = parentCode(c)) {
    const value = byCode.get(c)?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Gera o plano para um cliente. IDs determinísticos (`${clientId}_itg22_${code}`)
 * tornam a aplicação idempotente.
 */
export function buildITG1000Chart(clientId: string, now: string = new Date().toISOString()): ChartAccount[] {
  const idFor = (code: string) => `${clientId}_itg22_${code}`;
  return ENTRIES.map((e) => {
    const parent = parentCode(e.code);
    const analytic = !parentCodes.has(e.code);
    const account: ChartAccount = {
      id: idFor(e.code),
      clientId,
      code: e.code,
      name: e.name,
      type: inherited(e.code, 'type') ?? typeByCode(e.code),
      nature: analytic ? 'ANALYTIC' : 'SYNTHETIC',
      level: e.code.split('.').length,
      createdAt: now,
      updatedAt: now,
    };
    if (parent) account.parentId = idFor(parent);
    const dre = inherited(e.code, 'dre');
    if (dre) account.dreGroup = dre;
    if (inherited(e.code, 'contra')) account.isContra = true;
    return account;
  });
}

export const ITG1000_ACCOUNT_COUNT = ENTRIES.length;
