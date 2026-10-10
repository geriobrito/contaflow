#!/usr/bin/env node
/**
 * ContaFlow — Limpeza do Firestore preservando o Plano de Contas.
 *
 * Este script apaga movimentações, extratos, fechamentos e pendências do Firestore,
 * mas PRESERVA intocados:
 *   - chart_of_accounts (Plano de contas)
 *   - clients (Empresas cadastradas)
 *   - users (Usuários e credenciais de acesso)
 *   - orgs (Escritórios e configurações da organização)
 *
 * Coleções apagadas por padrão:
 *   - transactions (Lançamentos bancários / extratos)
 *   - import_batches (Lotes de importação OFX/Excel)
 *   - classification_rules (Regras de classificação — preservável com --keep-rules)
 *   - bank_accounts (Contas bancárias vinculadas às empresas)
 *   - opening_balances (Saldos de abertura)
 *   - period_locks (Travas de fechamento de competência)
 *   - client_requests (Pendências enviadas a clientes)
 *   - client_request_files (Comprovantes enviados por clientes)
 *   - audit_log (Histórico de auditoria)
 *
 * Exemplos de uso:
 *
 * 1. Simulação (Dry Run — recomendado antes de apagar):
 *    node scripts/clean-firestore.mjs --key ./service-account.json --dry-run
 *
 * 2. Executar limpeza real com confirmação automática:
 *    node scripts/clean-firestore.mjs --key ./service-account.json --yes
 *
 * 3. Preservar também as regras de classificação existentes:
 *    node scripts/clean-firestore.mjs --key ./service-account.json --keep-rules --yes
 *
 * 4. Filtrar para limpar apenas um escritório específico:
 *    node scripts/clean-firestore.mjs --key ./service-account.json --org <orgId> --yes
 *
 * 5. Usando o emulador local:
 *    $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *    node scripts/clean-firestore.mjs --project demo-contaflow --yes
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PRESERVED_COLLECTIONS = ['chart_of_accounts', 'clients', 'users', 'orgs'];

const ALL_CLEAN_COLLECTIONS = [
  'transactions',
  'import_batches',
  'classification_rules',
  'bank_accounts',
  'opening_balances',
  'period_locks',
  'client_requests',
  'client_request_files',
  'audit_log',
];

const BATCH_LIMIT = 400;

function printHelp() {
  console.log(`
ContaFlow — Script de Limpeza do Firestore

Uso:
  node scripts/clean-firestore.mjs [opções]

Opções:
  --key <caminho>          Caminho para o JSON da Conta de Serviço (Firebase Admin).
  --project <id>           ID do projeto Firebase (opcional se contido no JSON ou env).
  --org <orgId>            Limpa apenas documentos do escritório especificado.
  --keep-rules             Preserva também a coleção de regras de conciliação.
  --dry-run                Apenas relata quais documentos seriam apagados, sem alterar nada.
  --yes, -y                Pula a solicitação interativa de confirmação.
  --help, -h               Mostra esta mensagem de ajuda.
`);
}

function parseArgs(argv) {
  const args = {
    key: null,
    project: null,
    org: null,
    keepRules: false,
    dryRun: false,
    yes: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--yes' || a === '-y') {
      args.yes = true;
    } else if (a === '--keep-rules') {
      args.keepRules = true;
    } else if (a === '--key') {
      args.key = argv[++i];
    } else if (a === '--project') {
      args.project = argv[++i];
    } else if (a === '--org') {
      args.org = argv[++i];
    } else {
      throw new Error(`Argumento desconhecido: ${a}. Use --help para ver as opções.`);
    }
  }

  return args;
}

async function initFirebase(args) {
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (emulator) {
    const projectId = args.project || process.env.FIREBASE_PROJECT_ID || 'demo-contaflow';
    initializeApp({ projectId });
    console.log(`[Firebase] Conectado ao Emulador Firestore (${process.env.FIRESTORE_EMULATOR_HOST}) [Projeto: ${projectId}]`);
    return getFirestore();
  }

  // Chave explicitamente fornecida via argumento
  if (args.key) {
    const keyPath = resolve(process.cwd(), args.key);
    if (!existsSync(keyPath)) {
      throw new Error(`Arquivo de chave de serviço não encontrado em: ${keyPath}`);
    }
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    const projectId = args.project || serviceAccount.project_id;
    initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });
    console.log(`[Firebase] Conectado via Service Account (${serviceAccount.client_email}) [Projeto: ${projectId}]`);
    return getFirestore();
  }

  // Verifica se existe service-account.json no diretório raiz
  const defaultKeyPath = resolve(process.cwd(), 'service-account.json');
  if (existsSync(defaultKeyPath)) {
    const serviceAccount = JSON.parse(readFileSync(defaultKeyPath, 'utf8'));
    const projectId = args.project || serviceAccount.project_id;
    initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });
    console.log(`[Firebase] Conectado via service-account.json padrão (${serviceAccount.client_email}) [Projeto: ${projectId}]`);
    return getFirestore();
  }

  // Verifica GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const projectId = args.project || process.env.FIREBASE_PROJECT_ID;
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
    console.log(`[Firebase] Conectado via GOOGLE_APPLICATION_CREDENTIALS [Projeto: ${projectId || 'default'}]`);
    return getFirestore();
  }

  throw new Error(
    'Credenciais do Firebase não encontradas!\n' +
    'Por favor, forneça o arquivo JSON da conta de serviço:\n' +
    '  node scripts/clean-firestore.mjs --key ./service-account.json\n' +
    'ou configure a variável de ambiente GOOGLE_APPLICATION_CREDENTIALS.'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('='.repeat(65));
  console.log(' ContaFlow — Limpeza do Firestore');
  console.log('='.repeat(65));

  const collectionsToClean = ALL_CLEAN_COLLECTIONS.filter(
    (col) => !(col === 'classification_rules' && args.keepRules)
  );

  console.log('\nColeções que SERÃO PRESERVADAS:');
  PRESERVED_COLLECTIONS.forEach((c) => console.log(`  [OK] ${c}`));
  if (args.keepRules) {
    console.log('  [OK] classification_rules (--keep-rules ativado)');
  }

  console.log('\nColeções que serão LIMPAS:');
  collectionsToClean.forEach((c) => console.log(`  [XX] ${c}`));

  if (args.org) {
    console.log(`\nFiltro por escritório: orgId == "${args.org}"`);
  } else {
    console.log('\nFiltro por escritório: NENHUM (afetará todos os registros das coleções acima)');
  }

  const db = await initFirebase(args);

  console.log('\nVerificando documentos existentes...');
  const collectionsData = [];
  let totalDocsToDelete = 0;

  for (const colName of collectionsToClean) {
    const colRef = db.collection(colName);
    const query = args.org ? colRef.where('orgId', '==', args.org) : colRef;
    const snap = await query.get();
    collectionsData.push({ name: colName, docs: snap.docs, count: snap.size });
    totalDocsToDelete += snap.size;
    console.log(`  • ${colName.padEnd(24)}: ${snap.size} documento(s) encontrado(s)`);
  }

  // Verifica documentos preservados para segurança do usuário
  console.log('\nContagem das coleções preservadas:');
  for (const colName of PRESERVED_COLLECTIONS) {
    const colRef = db.collection(colName);
    const query = args.org ? colRef.where('orgId', '==', args.org) : colRef;
    const snap = await query.get();
    console.log(`  • ${colName.padEnd(24)}: ${snap.size} documento(s) (INTOCADOS)`);
  }

  if (totalDocsToDelete === 0) {
    console.log('\nNenhum documento encontrado para exclusão nas coleções selecionadas.');
    console.log('O banco de dados já está limpo!');
    return;
  }

  console.log(`\nTotal de documentos para apagar: ${totalDocsToDelete}`);

  if (args.dryRun) {
    console.log('\n[SIMULAÇÃO / DRY-RUN]');
    console.log('Nenhum documento foi apagado. Para executar de fato, rode sem a flag --dry-run.');
    return;
  }

  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      '\nATENÇÃO: Deseja realmente excluir permanentemente os documentos listados acima? (digite "sim" ou "yes" para continuar): '
    );
    rl.close();

    if (answer.trim().toLowerCase() !== 'sim' && answer.trim().toLowerCase() !== 'yes') {
      console.log('Operação cancelada pelo usuário. Nenhum documento foi apagado.');
      return;
    }
  }

  console.log('\nIniciando exclusão dos documentos...');

  for (const { name, docs } of collectionsData) {
    if (docs.length === 0) continue;

    process.stdout.write(`  Apagando ${name} (${docs.length} docs)... `);

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    console.log('concluído!');
  }

  console.log('\n' + '='.repeat(65));
  console.log(' Limpeza concluída com sucesso!');
  console.log(` Foram excluídos ${totalDocsToDelete} documentos.`);
  console.log(' Os dados do Plano de Contas e das Empresas permanecem intactos.');
  console.log('='.repeat(65) + '\n');
}

main().catch((err) => {
  console.error('\n[ERRO]', err instanceof Error ? err.message : err);
  process.exit(1);
});
