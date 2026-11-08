import {
  ArrowLeftRight,
  BookMarked,
  BookOpen,
  BookText,
  Building2,
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

/** Menu em três seções: a rotina do mês, as demonstrações e os cadastros. Usado também pela busca rápida. */
export const NAV_SECTIONS: readonly { title: string; items: readonly NavItem[] }[] = [
  {
    title: 'Rotina',
    items: [
      { href: '/painel', label: 'Painel', icon: LayoutDashboard, keywords: 'inicio dashboard carteira resumo' },
      { href: '/', label: 'Conciliação', icon: ArrowLeftRight, keywords: 'extrato ofx classificar lancamentos bancarios' },
      { href: '/pendencias', label: 'Pendências do Cliente', icon: MessageCircleQuestion, keywords: 'perguntas link respostas' },
      { href: '/contas', label: 'Contas e Extratos', icon: Wallet, keywords: 'bancos saldo inicial importacoes' },
      { href: '/nfe', label: 'Notas Fiscais', icon: ReceiptText, keywords: 'nfe nf-e xml compras vendas fornecedor cfop' },
      {
        href: '/folha',
        label: 'Folha de Pagamento',
        icon: Users,
        keywords: 'folha de pagamento pro labore salarios inss fgts irrf ferias decimo terceiro holerite esocial dctfweb gps',
      },
      { href: '/lancamentos', label: 'Lançamentos Manuais', icon: FilePenLine, keywords: 'partidas dobradas provisao folha depreciacao' },
      {
        href: '/imobilizado',
        label: 'Bens e Contratos',
        icon: Car,
        keywords: 'imobilizado bens ativo depreciacao amortizacao intangivel baixa patrimonio seguro apolice despesas antecipadas emprestimo financiamento parcelamento juros aplicacao financeira rendimento resgate caixinha cdb estoque cmv custo mercadoria inventario',
        also: ['/despesas-antecipadas', '/financiamentos', '/aplicacoes', '/estoque'],
      },
    ],
  },
  {
    title: 'Demonstrações',
    items: [
      { href: '/dre', label: 'DRE', icon: LineChart, keywords: 'demonstracao do resultado lucro prejuizo' },
      { href: '/balanco', label: 'Balanço e Balancete', icon: Scale, keywords: 'balanco patrimonial balancete dlpa dmpl mutacoes patrimonio liquido dfc encerramento exercicio' },
      { href: '/diario', label: 'Livro Diário', icon: BookText },
      { href: '/razao', label: 'Livro Razão', icon: BookMarked },
      { href: '/notas', label: 'Notas Explicativas', icon: NotebookPen },
      { href: '/abertura', label: 'Balanço de Abertura', icon: ClipboardList, keywords: 'saldos de abertura implantacao' },
      { href: '/fechamento', label: 'Fechamento do Exercício', icon: ListChecks, keywords: 'checklist encerramento anual ecd junta registro livros saldo virado' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { href: '/clientes', label: 'Clientes', icon: Building2, keywords: 'empresas cadastro cnpj' },
      { href: '/plano-de-contas', label: 'Plano de Contas', icon: BookOpen, keywords: 'contas contabeis modelo cfc' },
      { href: '/regras', label: 'Regras de Aprendizado', icon: Sparkles, keywords: 'automacao classificacao automatica' },
      { href: '/escritorio', label: 'Escritório', icon: Landmark, keywords: 'contador crc assinatura dois fatores' },
      { href: '/auditoria', label: 'Auditoria', icon: History, keywords: 'historico alteracoes log' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Item do menu da página atual (a Conciliação é a raiz "/": só ela mesma). */
export const activeNavHref = (pathname: string): string | null =>
  NAV_ITEMS.find(({ href, also }) => (href === '/' ? pathname === '/' : [href, ...(also ?? [])].some((h) => pathname.startsWith(h))))?.href ?? null;
