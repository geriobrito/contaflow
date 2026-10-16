/**
 * Busca da paleta de comandos (Ctrl+K): telas, empresas e ações. Sem acento e sem diferenciar
 * maiúsculas; cada palavra digitada precisa aparecer no nome, na dica ou nas palavras-chave, em
 * qualquer ordem. Números também casam com o CNPJ sem pontuação.
 */

export type CommandGroup = 'Empresas' | 'Telas' | 'Ações';

export interface CommandEntry {
  id: string;
  group: CommandGroup;
  label: string;
  /** Texto secundário mostrado ao lado (seção do menu, razão social, CNPJ). */
  hint?: string;
  /** Termos extras que também encontram o item. */
  keywords?: string;
}

export const GROUP_ORDER: readonly CommandGroup[] = ['Empresas', 'Telas', 'Ações'];

export const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const digits = (text: string) => text.replace(/\D/g, '');

/**
 * Relevância do item para a busca (menor é melhor) ou null se não casa: nome que começa com o
 * texto; alguma palavra do nome que começa com ele; o nome que o contém; só a dica ou as palavras-chave.
 */
export function matchScore(query: string, entry: CommandEntry): number | null {
  const q = normalize(query);
  if (!q) return 0;
  const label = normalize(entry.label);
  const rest = normalize(`${entry.hint ?? ''} ${entry.keywords ?? ''}`);
  const all = `${label} ${rest}`;
  const allDigits = digits(`${entry.label} ${entry.hint ?? ''}`);
  const tokens = q.split(' ');
  const found = tokens.every((t) => all.includes(t) || (/^\d+$/.test(digits(t)) && digits(t).length >= 2 && allDigits.includes(digits(t))));
  if (!found) return null;
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s/–-]+/).some((w) => w.startsWith(tokens[0]))) return 1;
  if (label.includes(q)) return 2;
  return 3;
}

/**
 * Itens que casam com a busca, agrupados na ordem de GROUP_ORDER e, dentro do grupo, por
 * relevância (empate: a ordem original). Sem texto, tudo na ordem original.
 */
export function searchCommands<T extends CommandEntry>(query: string, entries: readonly T[]): T[] {
  const scored = entries
    .map((entry, index) => ({ entry, index, score: matchScore(query, entry) }))
    .filter((x): x is { entry: T; index: number; score: number } => x.score !== null);
  const group = (g: CommandGroup) => GROUP_ORDER.indexOf(g);
  return scored.sort((a, b) => group(a.entry.group) - group(b.entry.group) || a.score - b.score || a.index - b.index).map((x) => x.entry);
}
