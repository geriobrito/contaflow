/**
 * Limpeza dos eventos de erro antes de saírem para o Sentry (LGPD). Só seguem o tipo do erro,
 * a mensagem higienizada, a pilha, a rota sem consulta nem fragmento, as etiquetas que o app
 * define (`area`, `op`, `kind`) e o uid do usuário — nunca e-mail, IP, cabeçalhos, corpo de
 * requisição, textos de lançamento ou o token do link de pendências (que vai no `#t=` da URL e
 * é a credencial do cliente).
 */

/** Tamanho máximo de uma mensagem enviada. */
export const MAX_MESSAGE = 300;

/** Endereço sem consulta (`?`) nem fragmento (`#`): o token do link fica no fragmento. */
export function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/s, '');
}

/**
 * Texto livre (mensagem do erro): tira tokens e identificadores longos, e-mails, CPF e CNPJ,
 * e endereços com consulta/fragmento; corta no tamanho máximo.
 */
export function scrubText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/g, (u) => scrubUrl(u))
    .replace(/#t=[^\s"'&]*/g, '#t=[removido]')
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, '[e-mail]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[id]')
    .slice(0, MAX_MESSAGE);
}

interface Crumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Só a navegação entre telas (com o endereço limpo); console, rede e cliques ficam de fora. */
export function keepBreadcrumb<B extends Crumb>(crumb: B): B | null {
  if (crumb.category !== 'navigation') return null;
  const data: Record<string, unknown> = {};
  for (const key of ['from', 'to'] as const) {
    const value = crumb.data?.[key];
    if (typeof value === 'string') data[key] = scrubUrl(value);
  }
  return { category: 'navigation', data } as B;
}

interface MinimalEvent {
  message?: string;
  exception?: { values?: { type?: string; value?: string }[] };
  request?: { url?: string; query_string?: unknown; headers?: unknown; cookies?: unknown; data?: unknown; env?: unknown };
  user?: { id?: string | number } & Record<string, unknown>;
  breadcrumbs?: Crumb[];
  extra?: unknown;
  transaction?: string;
  tags?: Record<string, unknown>;
}

/** Evento pronto para envio: o mesmo objeto, sem nada além do que o comentário do módulo lista. */
export function scrubEvent<E extends MinimalEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  if (event.request) {
    event.request = event.request.url ? { url: scrubUrl(event.request.url) } : {};
  }
  if (event.user) {
    event.user = event.user.id !== undefined ? { id: String(event.user.id) } : {};
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => keepBreadcrumb(b)).filter((b): b is Crumb => b !== null);
  }
  delete event.extra;
  return event;
}
