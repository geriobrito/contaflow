/**
 * Texto para comparação: maiúsculas, sem acentos, pontuação trocada por espaço e espaços
 * colapsados. Usado para reconhecer rótulos e históricos (ex.: linhas do resumo da folha).
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\w\s*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
