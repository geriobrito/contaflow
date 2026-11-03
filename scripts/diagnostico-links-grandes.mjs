#!/usr/bin/env node
/**
 * Diagnóstico (SOMENTE LEITURA): lista os links de pendência abertos e dentro da validade com
 * mais de 24 perguntas. Com o limite de 24 em firestore.rules (validAnswers), esses links deixam
 * de aceitar respostas: rode antes de publicar as regras e, se aparecer algum, encerre o link na
 * tela de Pendências e gere outros.
 *
 * Uso (produção — credencial de conta de serviço):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/diagnostico-links-grandes.mjs [--project <id>]
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/diagnostico-links-grandes.mjs --project demo-contaflow
 *
 * Não grava nada. Lê só os links com status OPEN (1 leitura por link). Não imprime o token
 * (ele é a credencial do link): só os 6 primeiros caracteres, empresa e contagens.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const MAX_REQUEST_ITEMS = 24;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
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
  return args;
}

async function main() {
  const { project } = parseArgs(process.argv.slice(2));
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();

  const snap = await db.collection('client_requests').where('status', '==', 'OPEN').select('clientId', 'clientName', 'items', 'expiresAtMs').get();
  const now = Date.now();
  const open = snap.docs.filter((d) => (d.get('expiresAtMs') ?? 0) > now);
  const large = open.filter((d) => (d.get('items') ?? []).length > MAX_REQUEST_ITEMS);

  console.log(`Projeto ${project}${emulator ? ' (emulador)' : ''}: ${open.length} link(s) aberto(s) e válido(s).`);
  if (!large.length) {
    console.log(`Nenhum com mais de ${MAX_REQUEST_ITEMS} perguntas: pode publicar as regras.`);
    return;
  }
  console.log(`${large.length} link(s) com mais de ${MAX_REQUEST_ITEMS} perguntas (deixarão de aceitar respostas):`);
  for (const d of large) {
    console.log(`  ${d.id.slice(0, 6)}…  ${d.get('clientName') ?? d.get('clientId')}  ·  ${d.get('items').length} perguntas`);
  }
  console.log('Encerre esses links na tela de Pendências e gere novos (até 24 perguntas cada) antes de publicar as regras.');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
