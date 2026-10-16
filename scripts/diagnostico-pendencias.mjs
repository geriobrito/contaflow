#!/usr/bin/env node
/**
 * Diagnóstico (SOMENTE LEITURA): distribui os lançamentos bancários por tipo de operação para
 * mostrar onde está o trabalho manual — o que ainda dependeria do contador no mês seguinte
 * (pendente, ou conciliado sem regra). Base para priorizar cadastro de pessoas, NF-e, cartão e IA.
 *
 * Uso (produção — credencial de conta de serviço):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/diagnostico-pendencias.mjs [--project <id>] [--max 30000]
 *
 * Uso (emulador):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/diagnostico-pendencias.mjs --project demo-contaflow
 *
 * Cuidados:
 * - Não grava nada: só contagem (`count()`) e leitura.
 * - Cada lançamento lido é 1 leitura do Firestore; no plano gratuito a cota é 50 mil/dia e,
 *   estourada, o próprio app para de carregar até a cota reiniciar. Por isso conta antes e
 *   aborta acima de `--max` (padrão 30 mil).
 * - Imprime só totais: nenhum histórico completo nem nome de pessoa sai no terminal.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseArgs(argv) {
  const args = { max: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
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

/* ---------- Classificação heurística da descrição ---------- */

const norm = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const CPF_MASKED = /[•*·x]{3}\.\d{3}\.\d{3}-[•*·x]{2}/i;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PJ_WORDS =
  /\b(ltda|s\/?a|s\.a|eireli|epp|me|mei|cia|comercio|comercial|servicos|industria|distribuidora|supermercados?|mercado|atacad\w*|farmacia|drogaria|posto|restaurante|lanchonete|padaria|transportes?|logistica|tecnologia|solucoes|pagamentos|banco|bank|instituicao|grupo|lojas?|clinica|hospital|construcao|construtora|materiais|engenharia|consultoria|contabil|contabilidade|digital|shop|store|hotel|auto ?pecas|telecom|energia|saneamento|seguros?|seguradora|editora|educacao|escola|academia|imobiliaria|cooperativa|associacao|igreja|fundacao)\b|\.com\b|www\./;

const OPERATION_WORDS = new Set([
  'pix', 'recebido', 'enviado', 'enviada', 'recebida', 'transferencia', 'transf', 'ted', 'doc', 'qr', 'code', 'pelo',
  'de', 'da', 'do', 'para', 'reembolso', 'estorno', 'pagamento', 'pagto', 'pag', 'tit', 'conta', 'agencia',
]);

/** Pessoa física ou jurídica do outro lado de um Pix/TED, pelos sinais da descrição. */
function partyKind(memoRaw) {
  const memo = norm(memoRaw);
  if (CNPJ.test(memo) || PJ_WORDS.test(memo)) return 'PJ';
  if (CPF_MASKED.test(memoRaw) || CPF.test(memo)) return 'PF';
  // Nome "de gente": 2 a 6 palavras alfabéticas depois de tirar as palavras da operação.
  const words = memo
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !OPERATION_WORDS.has(w));
  if (words.length >= 2 && words.length <= 6 && words.every((w) => w.length >= 2)) return 'PF?';
  return 'indefinido';
}

const RULES = [
  ['Tarifas e encargos bancários', /\b(tarifa|tar\b|pacote de servicos|cesta de servicos|iof|manutencao de conta|anuidade|juros|encargos|mora)\b/],
  ['Tributos e guias', /\b(darf|das|gps|fgts|grf|gru|dae|dare|simples nacional|receita federal|sefaz|icms|iss|issqn|ipva|iptu|inss|tributo|imposto|prefeitura|detran|parcelamento)\b/],
  ['Folha e pró-labore', /\b(salario|salarios|folha|pro ?labore|ferias|rescisao|adiantamento salarial)\b/],
  ['Aplicação, resgate e rendimento', /\b(aplicacao|aplic|resgate|rendimento|rend pago|cdb|rdb|poupanca|invest\w*|lci|lca|fundo)\b/],
  ['Empréstimo e financiamento', /\b(emprestimo|financiamento|consorcio|pronampe|capital de giro|credito pessoal|cred pessoal)\b/],
  ['Fatura de cartão (pagamento)', /\b(fatura|pagamento de cartao|pgto cartao|pag cartao)\b/],
  ['Compra no cartão de débito', /\b(compra no debito|compra deb\w*|debito visa|visa electron|maestro|elo debito|compra cartao)\b/],
  ['Recebimento de maquininha', /\b(cielo|stone|getnet|rede ?card|redecard|pagseguro|sumup|mercado ?pago|safrapay|vero|antecipacao|vendas? (credito|debito))\b/],
  ['Boleto', /\b(boleto|pagamento de titulo|pag\w* tit\w*|cobranca|titulo)\b/],
  ['Saque e depósito', /\b(saque|deposito|dep dinheiro)\b/],
];

const TRANSFER = /\b(pix|ted|doc|transf\w*|transferencia)\b/;

function category(t) {
  const memo = norm(t.memo);
  if (t.transferPairId) return 'Transferência entre contas próprias';
  for (const [name, re] of RULES) if (re.test(memo)) return name;
  if (TRANSFER.test(memo)) {
    const dir = (t.amount ?? 0) < 0 ? 'enviado' : 'recebido';
    const kind = partyKind(t.memo);
    const label = kind === 'PJ' ? 'pessoa jurídica' : kind === 'PF' ? 'pessoa física (CPF)' : kind === 'PF?' ? 'pessoa física (pelo nome)' : 'favorecido indefinido';
    return `Pix/TED ${dir} — ${label}`;
  }
  return 'Outros';
}

/** Prefixo da operação (2 primeiras palavras, sem dígitos): mostra o que caiu em "Outros" sem expor nomes. */
const opPrefix = (memo) =>
  norm(memo)
    .split(/\s+-\s+/)[0]
    .replace(/\d/g, '#')
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');

/* ---------- Saída ---------- */

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

async function main() {
  const { project, max } = parseArgs(process.argv.slice(2));
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(emulator ? { projectId: project } : { projectId: project, credential: applicationDefault() });
  const db = getFirestore();
  const col = db.collection('transactions');

  const total = (await col.count().get()).data().count;
  console.log(`Projeto ${project}${emulator ? ' (emulador)' : ''}: ${total} lançamentos bancários.`);
  if (total > max) {
    console.log(`Acima do limite de ${max} leituras (cota gratuita: 50 mil/dia). Nada foi lido. Rode com --max maior conscientemente.`);
    return;
  }

  const snap = await col
    .select('memo', 'amount', 'status', 'matchedRuleId', 'transferPairId', 'isSplit', 'clientId', 'orgId', 'clientQuery', 'date')
    .get();
  const txs = snap.docs.map((d) => d.data());

  // Trabalho manual: o que voltaria a exigir o contador no mês seguinte.
  const isManual = (t) => !t.transferPairId && (t.status === 'PENDING' || !t.matchedRuleId);

  const byStatus = {};
  const cats = new Map();
  const others = new Map();
  const clients = new Map();
  let manualTotal = 0;
  let manualValue = 0;
  let asked = 0;
  let pjWithCnpj = 0;
  let pjManual = 0;
  const dates = [];

  for (const t of txs) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.date) dates.push(t.date);
    if (t.clientQuery) asked++;
    const c = category(t);
    const row = cats.get(c) ?? { n: 0, manual: 0, value: 0, manualValue: 0 };
    const v = Math.abs(t.amount ?? 0);
    row.n++;
    row.value += v;
    if (isManual(t)) {
      row.manual++;
      row.manualValue += v;
      manualTotal++;
      manualValue += v;
      clients.set(t.clientId, (clients.get(t.clientId) ?? 0) + 1);
      if (c === 'Outros') others.set(opPrefix(t.memo), (others.get(opPrefix(t.memo)) ?? 0) + 1);
      if (c.endsWith('pessoa jurídica')) {
        pjManual++;
        if (CNPJ.test(norm(t.memo))) pjWithCnpj++;
      }
    }
    cats.set(c, row);
  }

  dates.sort();
  const orgs = new Set(txs.map((t) => t.orgId ?? '(sem orgId)'));
  console.log(`Período: ${dates[0] ?? '—'} a ${dates.at(-1) ?? '—'} · escritórios: ${orgs.size} · empresas: ${new Set(txs.map((t) => t.clientId)).size}`);
  console.log(
    `Status: ${Object.entries(byStatus)
      .map(([s, n]) => `${s} ${n}`)
      .join(' · ')} · com pergunta ao cliente: ${asked}`
  );
  console.log(`\nTrabalho manual (pendente, ou conciliado sem regra; transferências próprias fora): ${manualTotal} de ${txs.length} (${pct(manualTotal, txs.length)}) · ${brl(manualValue)}\n`);

  const rows = [...cats.entries()].sort((a, b) => b[1].manual - a[1].manual);
  console.log(`${pad('Tipo de operação', 48)}${lpad('Total', 8)}${lpad('Manual', 8)}${lpad('% do manual', 13)}${lpad('Valor manual', 16)}`);
  console.log('-'.repeat(93));
  for (const [name, r] of rows) {
    console.log(`${pad(name, 48)}${lpad(r.n, 8)}${lpad(r.manual, 8)}${lpad(pct(r.manual, manualTotal), 13)}${lpad(brl(r.manualValue), 16)}`);
  }

  console.log(`\nPix/TED a pessoa jurídica manuais com CNPJ no histórico (casáveis com NF-e pelo emitente): ${pjWithCnpj} de ${pjManual}`);

  const perClient = [...clients.values()].sort((a, b) => b - a);
  const top3 = perClient.slice(0, 3).reduce((s, n) => s + n, 0);
  console.log(`Concentração: ${clients.size} empresas com trabalho manual; as 3 maiores somam ${pct(top3, manualTotal)} (${perClient.slice(0, 3).join(', ')})`);

  const topOthers = [...others.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (topOthers.length) {
    console.log('\n"Outros" manuais por início da descrição (2 palavras, dígitos como #):');
    for (const [p, n] of topOthers) console.log(`  ${lpad(n, 6)}  ${p || '(vazio)'}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
