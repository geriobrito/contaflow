/**
 * ContaFlow - Tipos e Schema Oficial das Coleções do Firestore
 *
 * Isolamento: todo documento de dados carrega `orgId` (escritório). O vínculo
 * usuário → escritório fica em `users/{uid}.orgId`. Ver `firestore.rules`.
 * 
 * Coleções:
 * 1. clients (auto-id): name, cnpj, regime
 * 2. chart_of_accounts (auto-id): clientId, code, name, type
 * 3. classification_rules (auto-id): clientId, pattern, accountId
 * 4. transactions (clientId_fitid): clientId, fitid, date, amount, type, memo, accountId, status
 */

/*
 * Os tipos ficam divididos por domínio em src/types/firestore/; este arquivo reexporta todos,
 * para que `@/types/firestore` continue sendo o único ponto de importação.
 */

export type * from './firestore/core';
export type * from './firestore/reconciliation';
export type * from './firestore/invoices';
export type * from './firestore/audit';
export type * from './firestore/journal';
export type * from './firestore/controls';
