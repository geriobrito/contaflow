#!/usr/bin/env node
/**
 * Migração única dos dados em formato antigo, para o código de compatibilidade poder sair:
 *
 *   1. chart_of_accounts: tipos em português (RECEITA, DESPESA, ATIVO, PASSIVO, CUSTO) e grupos
 *      antigos da DRE (RECEITA_BRUTA, DESPESAS_ADMINISTRATIVAS…) passam aos valores atuais,
 *      pela mesma tabela que o app usa hoje ao ler (resolveDREGroup em src/lib/dre/build.ts).
 *   2. clients: `taxRegime` (nome antigo) vira `regime` onde este faltar, e é removido.
 *   3. transactions: lançamentos de extratos antigos, ligados ao lote só pela data de gravação,
 *      recebem `importBatchId`.
 *   4. client_request_files (comprovantes de quando o cliente anexava arquivos; nenhuma tela os
 *      mostra mais): apagados, só com `--drop-request-files`.
 *
 * Por padrão só relata o que encontraria (simulação). Com `--apply`, grava. É idempotente:
 * rodar de novo depois de aplicado deve relatar zero em tudo — é esse o sinal para remover o
 * código de compatibilidade do app.
 *
 * Uso (credencial de conta de serviço com acesso de escrita ao Firestore):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrate-legacy.mjs --project <id>
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrate-legacy.mjs --project <id> --apply [--drop-request-files]
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-legacy.mjs --project demo-contaflow --apply
 *
 * Faça um backup antes de aplicar (README > Backup).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const BATCH_LIMIT = 450;

const ACCOUNT_TYPE = { RECEITA: 'REVENUE', DESPESA: 'EXPENSE', ATIVO: 'ASSET', PASSIVO: 'LIABILITY', CUSTO: 'COST' };
const CURRENT_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE']);

const DRE_GROUP = {
  RECEITA_BRUTA: 'GROSS_REVENUE',
  DEDUCOES_RECEITA: 'DEDUCTIONS',
  CUSTOS: 'COSTS',
  DESPESAS_OPERACIONAIS: 'OPERATING_EXPENSES',
  DESPESAS_ADMINISTRATIVAS: 'OPERATING_EXPENSES',
  DESPESAS_COMERCIAIS: 'OPERATING_EXPENSES',
  DESPESAS_FINANCEIRAS: 'FINANCIAL_EXPENSES',
  RECEITAS_FINANCEIRAS: 'FINANCIAL_INCOME',
  IMPOSTOS_LUCRO: 'INCOME_TAXES',
};
const CURRENT_GROUPS = new Set(['GROSS_REVENUE', 'DEDUCTIONS', 'COSTS', 'OPERATING_EXPENSES', 'FINANCIAL_INCOME', 'FINANCIAL_EXPENSES', 'OTHER_INCOME', 'OTHER_EXPENSES', 'INCOME_TAXES']);

function parseArgs(argv) {
  const args = { apply: false, dropRequestFiles: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--drop-request-files') args.dropRequestFiles = true;
    else if (a === '--project') args.project = argv[++i];
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  if (!args.project) throw new Error('Informe --project <id>. Veja o cabeçalho do script.');
  return args;
}

/** Alteração da conta do plano, ou null se ela já está no formato atual. */
function accountFix(data) {
  const fix = {};
  const type = ACCOUNT_TYPE[data.type] ?? data.type;
  if (type !== data.type) fix.type = type;
  const group = data.dreGroup;
  if (group !== undefined && group !== null && !CURRENT_GROUPS.has(group)) {
    if (DRE_GROUP[group]) fix.dreGroup = DRE_GROUP[group];
    else if (group === 'OUTRAS_RECEITAS_DESPESAS') fix.dreGroup = type === 'REVENUE' ? 'OTHER_INCOME' : 'OTHER_EXPENSES';
    // Subtotais (RECEITA_LIQUIDA, LUCRO_BRUTO) e valores desconhecidos nunca agruparam nada:
    // sem o campo, a conta cai no grupo da sua natureza, como já acontece hoje.
    else fix.dreGroup = FieldValue.delete();
  }
  return Object.keys(fix).length ? fix : null;
}

async function main() {
  const { project, apply, dropRequestFiles } = parseArgs(process.argv.slice(2));
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  console.log(`${apply ? '' : '[simulação] '}Projeto ${project}${emulator ? ' (emulador)' : ''}`);

  /** Grava as alterações em lotes; na simulação, só conta. */
  const commit = async (changes) => {
    if (!apply) return;
    for (let i = 0; i < changes.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const c of changes.slice(i, i + BATCH_LIMIT)) {
        if (c.delete) batch.delete(c.ref);
        else batch.update(c.ref, c.data);
      }
      await batch.commit();
    }
  };

  // 1. Plano de contas
  const accounts = await db.collection('chart_of_accounts').get();
  const accountChanges = [];
  const unknownTypes = new Set();
  for (const d of accounts.docs) {
    const data = d.data();
    const fix = accountFix(data);
    if (fix) accountChanges.push({ ref: d.ref, data: fix });
    if (!CURRENT_TYPES.has(fix?.type ?? data.type)) unknownTypes.add(String(data.type));
  }
  await commit(accountChanges);
  console.log(`  chart_of_accounts: ${accountChanges.length} de ${accounts.size} conta(s) com tipo ou grupo da DRE em formato antigo`);
  if (unknownTypes.size) console.log(`    ! tipos desconhecidos, não alterados: ${[...unknownTypes].join(', ')}`);

  // 2. Regime tributário das empresas
  const clients = await db.collection('clients').get();
  const clientChanges = [];
  for (const d of clients.docs) {
    const data = d.data();
    if (data.taxRegime === undefined) continue;
    clientChanges.push({ ref: d.ref, data: { ...(data.regime ? {} : { regime: data.taxRegime }), taxRegime: FieldValue.delete() } });
  }
  await commit(clientChanges);
  console.log(`  clients: ${clientChanges.length} de ${clients.size} empresa(s) com o campo antigo taxRegime`);

  // 3. Vínculo dos lançamentos com o extrato de origem
  const batches = await db.collection('import_batches').get();
  const txChanges = [];
  for (const b of batches.docs) {
    const batch = b.data();
    if (!batch.clientId || !batch.importedAt) continue;
    const snap = await db.collection('transactions').where('clientId', '==', batch.clientId).where('createdAt', '==', batch.importedAt).get();
    for (const t of snap.docs) {
      if (!t.get('importBatchId')) txChanges.push({ ref: t.ref, data: { importBatchId: b.id } });
    }
  }
  await commit(txChanges);
  console.log(`  transactions: ${txChanges.length} lançamento(s) de ${batches.size} extrato(s) sem importBatchId`);

  // 4. Comprovantes antigos enviados pelo cliente
  const files = await db.collection('client_request_files').get();
  if (dropRequestFiles) await commit(files.docs.map((d) => ({ ref: d.ref, delete: true })));
  console.log(
    `  client_request_files: ${files.size} documento(s)${files.size && !dropRequestFiles ? ' — mantidos (use --drop-request-files com --apply para apagar)' : ''}`
  );

  const pending = accountChanges.length + clientChanges.length + txChanges.length + files.size;
  console.log(
    apply
      ? 'Concluído. Rode de novo sem --apply para conferir que tudo está zerado.'
      : pending
        ? 'Nada foi gravado. Rode com --apply para migrar.'
        : 'Nada a migrar: o código de compatibilidade pode ser removido do app.'
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
