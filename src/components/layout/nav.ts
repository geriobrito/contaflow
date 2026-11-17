import {
  ArrowLeftRight,
  BookMarked,
  BookOpen,
  BookText,
  Building2,
  CalendarClock,
  Car,
  ClipboardList,
  FilePenLine,
  History,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageCircleQuestion,
  NotebookPen,
  ReceiptText,
  Scale,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Outros nomes pelos quais a tela é procurada na busca rápida (Ctrl+K). */
  keywords?: string;
  /** Outras telas do mesmo item (abas), que também o deixam marcado no menu. */
  also?: readonly string[];
}

export interface NavSection {
  title: string;
  /** Grupo de entrada, sem cabeçalho no menu (o título segue valendo para leitores de tela e para a busca). */
  hideTitle?: boolean;
  /** Os itens são passos em sequência: o menu numera cada um. */
  ordered?: boolean;
  items: readonly NavItem[];
}

/**
 * Menu na ordem do trabalho: o ponto de partida do dia, os passos da rotina do mês (do extrato aos
 * ajustes, na sequência em que são feitos), as demonstrações que saem dela e os cadastros, na ordem
 * de implantação de uma empresa. Usado também pela busca rápida.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Início',
    hideTitle: true,
    items: [
      { href: '/painel', label: 'Painel', icon: LayoutDashboard, keywords: 'inicio dashboard carteira resumo' },
      {
        href: '/agenda',
        label: 'Agenda e Honorários',
        icon: CalendarClock,
        keywords: 'obrigacoes prazos vencimentos calendario das pgdas dctfweb esocial reinf fgts defis dasn ecd ecf honorarios mensalidade reajuste cobranca recebimento',
      },
    ],
  },
  {
    title: 'Rotina do mês',
    ordered: true,
    items: [
      { href: '/', label: 'Conciliação', icon: ArrowLeftRight, keywords: 'extrato ofx csv importar classificar lancamentos bancarios fechar mes competencia' },
      { href: '/nfe', label: 'Notas Fiscais', icon: ReceiptText, keywords: 'nfe nf-e xml compras vendas fornecedor cfop' },
      { href: '/pendencias', label: 'Pendências do Cliente', icon: MessageCircleQuestion, keywords: 'perguntas link respostas' },
      {
        href: '/folha',
        label: 'Folha de Pagamento',
        icon: Users,
        keywords: 'folha de pagamento pro labore salarios inss fgts irrf ferias decimo terceiro holerite esocial dctfweb gps',
      },
      {
        href: '/bens-e-contratos',
        label: 'Bens e Contratos',
        icon: Car,
        keywords: 'resumo vencimentos parcelas imobilizado bens ativo depreciacao amortizacao intangivel baixa patrimonio seguro apolice despesas antecipadas emprestimo financiamento parcelamento juros aplicacao financeira rendimento resgate caixinha cdb estoque cmv custo mercadoria inventario',
        also: ['/imobilizado', '/despesas-antecipadas', '/financiamentos', '/aplicacoes', '/estoque'],
      },
      { href: '/lancamentos', label: 'Lançamentos Manuais', icon: FilePenLine, keywords: 'partidas dobradas provisao ajuste depreciacao' },
    ],
  },
  {
    title: 'Demonstrações',
    items: [
      { href: '/balanco', label: 'Balanço e Balancete', icon: Scale, keywords: 'balanco patrimonial balancete dlpa dmpl mutacoes patrimonio liquido dfc encerramento exercicio' },
      { href: '/dre', label: 'DRE', icon: LineChart, keywords: 'demonstracao do resultado lucro prejuizo' },
      { href: '/diario', label: 'Livro Diário', icon: BookText, keywords: 'livro diario termo de abertura encerramento' },
      { href: '/razao', label: 'Livro Razão', icon: BookMarked, keywords: 'livro razao extrato da conta contabil' },
      { href: '/notas', label: 'Notas Explicativas', icon: NotebookPen },
      { href: '/fechamento', label: 'Fechamento do Exercício', icon: ListChecks, keywords: 'checklist encerramento anual ecd junta registro livros saldo virado' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { href: '/clientes', label: 'Clientes', icon: Building2, keywords: 'empresas cadastro cnpj' },
      { href: '/plano-de-contas', label: 'Plano de Contas', icon: BookOpen, keywords: 'contas contabeis modelo cfc' },
      { href: '/contas', label: 'Contas e Extratos', icon: Wallet, keywords: 'bancos contas bancarias cartao saldo inicial importacoes historico' },
      { href: '/abertura', label: 'Balanço de Abertura', icon: ClipboardList, keywords: 'saldos de abertura implantacao' },
      { href: '/regras', label: 'Regras de Aprendizado', icon: Sparkles, keywords: 'automacao classificacao automatica' },
      { href: '/escritorio', label: 'Escritório', icon: Landmark, keywords: 'contador crc assinatura dois fatores' },
      { href: '/auditoria', label: 'Auditoria', icon: History, keywords: 'historico alteracoes log' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

const matches = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/** Item do menu da página atual (a Conciliação é a raiz "/": só ela mesma). */
export const activeNavHref = (pathname: string): string | null =>
  NAV_ITEMS.find(({ href, also }) => [href, ...(also ?? [])].some((h) => matches(pathname, h)))?.href ?? null;

/** Telas fora do menu (públicas), para o título da aba. */
const BARE_TITLES: Readonly<Record<string, string>> = { '/login': 'Entrar', '/responder': 'Pendências' };

/** Título da aba do navegador para a rota: "Tela · ContaFlow". */
export function pageTitle(pathname: string): string {
  const active = activeNavHref(pathname);
  const label = BARE_TITLES[pathname] ?? NAV_ITEMS.find(({ href }) => href === active)?.label;
  return label ? `${label} · ContaFlow` : 'ContaFlow';
}
