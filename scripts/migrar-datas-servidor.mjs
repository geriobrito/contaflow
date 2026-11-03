#!/usr/bin/env node
/**
 * Migração (uma vez, idempotente): datas de auditoria e de fechamento passam de texto ISO
 * para Timestamp do Firestore, que é como o app grava agora (serverTimestamp, conferido pelas
 * regras com `request.time`).
 *
 * - `period_locks`: copia o `lockedAt` em texto para `auditKey` (se ainda não houver) e
 *   converte `lockedAt` em Timestamp. O id dos registros de auditoria do fechamento usa
 *   `auditKey`, então a reabertura de meses já fechados continua achando o registro.
 * - `audit_log`: converte `at` em Timestamp, no mesmo instante. Sem isso, `orderBy('at')`
 *   misturaria tipos (o Firestore ordena Timestamp antes de texto) e a trilha sairia fora de
 *   ordem. A trilha é imutável pelas regras; aqui só muda o tipo do campo, não o instante.
 * - `period_snapshots` não muda: o app compara `lockedAt` em texto, e a ida e volta
 *   (texto → Timestamp → toISOString) devolve o mesmo texto em milissegundos.
 *
 * Só lê os documentos ainda em texto (`where(campo, '>=', '')` só casa com texto). Rodar de
 * novo continua de onde parou. Por padrão só simula (dry-run); `--apply` grava.
 *
 * Ordem: 1) rodar sem `--apply` e conferir as contagens; 2) rodar com `--apply`;
 * 3) publicar regras e app juntos; 4) rodar de novo com `--apply` para pegar o que o app
 * antigo tenha gravado entre os passos 2 e 3.
 *
 * Plano gratuito: 50 mil leituras e 20 mil gravações por dia. `--max` (padrão 15000) limita
 * as gravações desta execução; acima disso, rode de novo no dia seguinte.
 *
 * Uso (produção — credencial de conta de serviço):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrar-datas-servidor.mjs [--project <id>] [--apply] [--max 15000]
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrar-datas-servidor.mjs --project demo-contaflow --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PAGE = 400;

function parseArgs(argv) {
  const args = { apply: false, max: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--max') args.max = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  if (!args.project) {
    try {
      const env = readFileSync('.env.local', 'utf8');
      args.project = env.match(/^NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.+)$/m)?.[1]?.trim();
    } catch {
      /* sem .env.local */
    }
  }
  if (!args.project) throw new Error('Informe --project <id> (ou defina NEXT_PUBLIC_FIREBASE_PROJECT_ID no .env.local).');
  if (!Number.isFinite(args.max) || args.max <= 0) throw new Error('--max deve ser um número positivo.');
  return args;
}

/** Converte o texto em Timestamp; null se não for uma data. `canonical`: a volta dá o mesmo texto. */
function parse(text) {
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return { ts: Timestamp.fromMillis(ms), canonical: new Date(ms).toISOString() === text };
}

/**
 * Percorre os documentos de `collection` com `field` em texto, em páginas, e (com --apply)
 * grava o que `patch` devolver. Devolve as contagens.
 */
async function migrate(db, { collection, field, patch, apply, budget }) {
  const stats = { found: 0, converted: 0, nonCanonical: 0, invalid: [] };
  let last = null;
  for (;;) {
    let q = db.collection(collection).where(field, '>=', '').orderBy(field).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];

    const batch = db.batch();
    let writes = 0;
    for (const d of snap.docs) {
      stats.found++;
      const parsed = parse(d.get(field));
      if (!parsed) {
        stats.invalid.push(d.id);
        continue;
      }
      if (!parsed.canonical) stats.nonCanonical++;
      if (writes >= budget.left) {
        budget.exhausted = true;
        continue;
      }
      batch.update(d.ref, patch(d, parsed.ts));
      stats.converted++;
      writes++;
    }
    if (apply && writes) await batch.commit();
    budget.left -= writes;
    if (budget.exhausted) break;
  }
  return stats;
}

function report(label, s, apply) {
  console.log(
    `${label}: ${s.found} em texto · ${s.converted} ${apply ? 'convertido(s)' : 'a converter'}` +
      (s.nonCanonical ? ` · ${s.nonCanonical} fora do formato ISO em ms (o instante é mantido; snapshots ligados a eles serão refeitos)` : '') +
      (s.invalid.length ? ` · ${s.invalid.length} com data inválida, não alterado(s): ${s.invalid.slice(0, 10).join(', ')}${s.invalid.length > 10 ? '…' : ''}` : '')
  );
}

async function main() {
  const { project, apply, max } = parseArgs(process.argv.slice(2));
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  console.log(`Projeto ${project}${emulator ? ' (emulador)' : ''} · ${apply ? 'GRAVANDO' : 'simulação (use --apply para gravar)'} · até ${max} gravações.`);

  const budget = { left: max, exhausted: false };
  // Fechamentos primeiro: são poucos, e sem eles a reabertura não acha o registro.
  const locks = await migrate(db, {
    collection: 'period_locks',
    field: 'lockedAt',
    apply,
    budget,
    patch: (d, ts) => ({ lockedAt: ts, ...(typeof d.get('auditKey') === 'string' ? {} : { auditKey: d.get('lockedAt') }) }),
  });
  report('period_locks.lockedAt', locks, apply);

  if (!budget.exhausted) {
    const audits = await migrate(db, { collection: 'audit_log', field: 'at', apply, budget, patch: (_d, ts) => ({ at: ts }) });
    report('audit_log.at', audits, apply);
  }

  if (budget.exhausted) console.log(`Limite de ${max} gravações atingido: rode de novo (amanhã, no plano gratuito) para continuar.`);
  else if (apply) console.log('Concluído.');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
