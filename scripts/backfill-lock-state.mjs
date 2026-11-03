#!/usr/bin/env node
/**
 * Migração idempotente: cria ou atualiza `lock_state/{clientId}` para cada empresa existente.
 *
 * Para cada documento em `clients`:
 *   - `count`: total de competências atualmente fechadas em `period_locks` da empresa;
 *   - `seq`: maior valor entre o `seq` já gravado (se houver), `count` e o número de eventos
 *     de fechamento (`PERIOD_CLOSE` + `YEAR_CLOSE`) registrados em `audit_log` da empresa.
 *
 * Não carimba `lockSeq` nos documentos preexistentes de `opening_balances`, `bank_accounts`
 * ou `chart_of_accounts`: se a empresa já teve algum fechamento (`seq > 0`), esses cadastros
 * antigos permanecem congelados enquanto houver competência fechada (`count > 0`) e só podem
 * ter campos estruturais alterados quando todas as competências estiverem abertas (`count == 0`).
 *
 * Por padrão executa apenas simulação (dry-run). Passe `--apply` para gravar.
 *
 * Uso (produção — credencial de conta de serviço):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-lock-state.mjs --project <id-do-projeto>
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-lock-state.mjs --project <id-do-projeto> --apply
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/backfill-lock-state.mjs --project demo-contaflow --apply
 */
import { resolve } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BATCH_LIMIT = 450;
const CLOSE_ACTIONS = new Set(['PERIOD_CLOSE', 'YEAR_CLOSE']);

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--credentials') args.credentials = argv[++i];
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  if (!args.project) {
    throw new Error('Informe --project <id>. Veja o cabeçalho do script.');
  }
  return args;
}

async function main() {
  const { project, apply, credentials } = parseArgs(process.argv.slice(2));
  if (credentials) process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(credentials);
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();

  console.log(`${apply ? '[aplicando] ' : '[simulação] '}Projeto ${project}${emulator ? ' (emulador)' : ''}`);

  const clientsSnap = await db.collection('clients').get();
  const pendingWrites = [];
  let skippedNoOrg = 0;
  let unchanged = 0;

  for (const clientDoc of clientsSnap.docs) {
    const clientId = clientDoc.id;
    const orgId = clientDoc.get('orgId');
    if (!orgId || typeof orgId !== 'string') {
      console.warn(`  [aviso] clients/${clientId}: sem orgId — rode scripts/backfill-org-id.mjs antes.`);
      skippedNoOrg++;
      continue;
    }

    const [locksSnap, auditSnap, existingSnap] = await Promise.all([
      db.collection('period_locks').where('clientId', '==', clientId).get(),
      db.collection('audit_log').where('clientId', '==', clientId).get(),
      db.collection('lock_state').doc(clientId).get(),
    ]);

    const count = locksSnap.docs.filter((d) => d.get('orgId') === orgId).length;
    const closeEvents = auditSnap.docs.filter(
      (d) => d.get('orgId') === orgId && CLOSE_ACTIONS.has(d.get('action'))
    ).length;

    const existing = existingSnap.exists ? existingSnap.data() : null;
    const prevSeq = typeof existing?.seq === 'number' ? existing.seq : 0;
    const seq = Math.max(prevSeq, count, closeEvents);

    const needsWrite =
      !existing ||
      existing.id !== clientId ||
      existing.orgId !== orgId ||
      existing.clientId !== clientId ||
      existing.count !== count ||
      existing.seq !== seq;

    if (!needsWrite) {
      unchanged++;
      continue;
    }

    const payload = {
      id: clientId,
      orgId,
      clientId,
      count,
      seq,
      ...(existing?.lastEvent ? { lastEvent: existing.lastEvent } : {}),
    };

    console.log(
      `  lock_state/${clientId} (org ${orgId}): ${existing ? `count ${existing.count}→${count}, seq ${existing.seq}→${seq}` : `novo (count=${count}, seq=${seq})`
      }`
    );
    pendingWrites.push({ ref: db.collection('lock_state').doc(clientId), payload });
  }

  console.log(
    `Resumo: ${clientsSnap.size} empresa(s) lida(s), ${pendingWrites.length} a gravar, ${unchanged} já em dia` +
    (skippedNoOrg ? `, ${skippedNoOrg} ignorada(s) sem orgId` : '') +
    '.'
  );

  if (!apply) {
    console.log('Nada foi gravado (modo simulação; passe --apply para aplicar).');
    return;
  }

  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const item of pendingWrites.slice(i, i + BATCH_LIMIT)) {
      batch.set(item.ref, item.payload);
    }
    await batch.commit();
  }
  console.log(`Concluído: ${pendingWrites.length} documento(s) gravado(s) em lock_state.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

