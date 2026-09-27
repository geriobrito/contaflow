#!/usr/bin/env node
/**
 * Migração: carimba `orgId` nos documentos criados antes do isolamento por escritório
 * e cria/ajusta o perfil `users/{uid}` dos usuários que devem enxergá-los.
 *
 * Uso (produção — credencial de conta de serviço):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-org-id.mjs --project <id-do-projeto> --org <orgId> --users <uid1,uid2> [--dry-run]
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-org-id.mjs --project demo-contaflow --org org-a --users alice
 *
 * Regras:
 * - Só altera documentos SEM `orgId` (idempotente; nunca move dados entre escritórios).
 * - `--users` define `users/{uid}.orgId = --org` (útil também para pôr vários
 *   contadores no mesmo escritório). Dica: use o UID do dono como orgId.
 * - `--dry-run` apenas relata o que seria alterado.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTIONS = ['clients', 'chart_of_accounts', 'classification_rules', 'transactions', 'import_batches'];
const BATCH_LIMIT = 450;

function parseArgs(argv) {
  const args = { dryRun: false, users: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--org') args.org = argv[++i];
    else if (a === '--users') args.users = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  if (!args.project || !args.org) {
    throw new Error('Informe --project <id> e --org <orgId>. Veja o cabeçalho do script.');
  }
  return args;
}

async function main() {
  const { project, org, users, dryRun } = parseArgs(process.argv.slice(2));
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  const now = new Date().toISOString();

  console.log(`${dryRun ? '[simulação] ' : ''}Projeto ${project}${emulator ? ' (emulador)' : ''} → orgId "${org}"`);

  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    const missing = snap.docs.filter((d) => !d.get('orgId'));
    console.log(`  ${name}: ${missing.length} de ${snap.size} sem orgId`);
    if (dryRun) continue;
    for (let i = 0; i < missing.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      missing.slice(i, i + BATCH_LIMIT).forEach((d) => batch.update(d.ref, { orgId: org }));
      await batch.commit();
    }
  }

  for (const uid of users) {
    const ref = db.collection('users').doc(uid);
    const existing = await ref.get();
    const current = existing.exists ? existing.get('orgId') : null;
    console.log(`  users/${uid}: ${current ? `orgId atual "${current}"` : 'sem perfil'} → "${org}"`);
    if (!dryRun) {
      await ref.set({ uid, orgId: org, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
    }
  }
  console.log(dryRun ? 'Nada foi gravado (--dry-run).' : 'Concluído.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
