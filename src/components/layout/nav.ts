import {
  ArrowLeftRight,
  BookMarked,
  BookOpen,
  BookText,
  Building2,
  ClipboardList,
  FilePenLine,
  History,
  Landmark,
  LayoutDashboard,
  LineChart,
  MessageCircleQuestion,
  NotebookPen,
  Scale,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Outros nomes pelos quais a tela é procurada na busca rápida (Ctrl+K). */
  keywords?: string;
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
      { href: '/lancamentos', label: 'Lançamentos Manuais', icon: FilePenLine, keywords: 'partidas dobradas provisao folha depreciacao' },
    ],
  },
  {
    title: 'Demonstrações',
    items: [
      { href: '/dre', label: 'DRE', icon: LineChart, keywords: 'demonstracao do resultado lucro prejuizo' },
      { href: '/balanco', label: 'Balanço e Balancete', icon: Scale, keywords: 'balanco patrimonial balancete dlpa encerramento exercicio' },
      { href: '/diario', label: 'Livro Diário', icon: BookText },
      { href: '/razao', label: 'Livro Razão', icon: BookMarked },
      { href: '/notas', label: 'Notas Explicativas', icon: NotebookPen },
      { href: '/abertura', label: 'Balanço de Abertura', icon: ClipboardList, keywords: 'saldos de abertura implantacao' },
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
  NAV_ITEMS.find(({ href }) => (href === '/' ? pathname === '/' : pathname.startsWith(href)))?.href ?? null;
