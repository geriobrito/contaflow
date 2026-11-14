/**
 * Restauração de uma empresa a partir do backup (src/lib/export/client-backup.ts), dividida em:
 *   - restore/parse.ts  leitura, validação e resumo do arquivo;
 *   - restore/remap.ts  remapeamento de IDs para importar como nova empresa;
 *   - restore/apply.ts  gravação (fiel no modo local, ou nova empresa pelo repositório).
 */
export * from './restore/parse';
export * from './restore/remap';
export * from './restore/apply';
