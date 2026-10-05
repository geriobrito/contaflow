# ContaFlow

Conciliação bancária por OFX com aprendizado contínuo, plano de contas ITG 1000 (2022) e DRE com exportação em PDF/Excel. Next.js (App Router) + Firebase (Auth + Firestore).

## Desenvolvimento

```bash
npm ci
npm run dev          # http://localhost:3000
```

Sem as variáveis `NEXT_PUBLIC_FIREBASE_*` no `.env.local`, o app roda em **modo local** (dados no `localStorage`, login de teste). Com elas, roda em **modo Firestore**. O modo é escolhido uma única vez por execução — não há escrita dupla nem fallback silencioso: se o Firestore recusar uma operação, o erro aparece na tela.

| Comando | O que faz |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Testes unitários (Vitest): DRE, rateio, parser OFX, plano ITG 1000, regras de casamento, repositório local |
| `npm run test:rules` | Regras do Firestore no emulador (requer Java 21+; baixa o `firebase-tools` via `npx`) |
| `npm run build` | Build de produção |

O CI (`.github/workflows/ci.yml`) roda tudo isso em cada PR.

## Arquitetura de dados

- `src/lib/data/repository.ts` — contrato único de persistência.
- `src/lib/data/firestore-repository.ts` / `local-repository.ts` — as duas implementações.
- `src/lib/services/data-service.ts` — fachada usada pelas telas; escolhe o repositório.
- `src/hooks/useReconciliation.ts` — orquestra importação, classificação, rateio e aprovação sobre o repositório (sem acesso direto ao Firestore).

### Isolamento por escritório (multi-tenant)

- Todo documento de dados (`clients`, `chart_of_accounts`, `classification_rules`, `transactions`, `import_batches`) tem `orgId`.
- `users/{uid}.orgId` diz a qual escritório o usuário pertence. No primeiro login o perfil é criado com `orgId = uid` (escritório próprio).
- **Colocar vários contadores no mesmo escritório:** defina `users/{uid}.orgId` igual ao do dono, pelo console do Firebase ou com o script de backfill (`--users`). O próprio usuário não consegue trocar de escritório.
- `firestore.rules` garante: leitura/escrita só no próprio escritório, `orgId` imutável, `clientId` sempre de um cliente do mesmo escritório, consultas obrigatoriamente filtradas por `orgId`.

### Auditoria, fechamento e escritório

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `audit_log` | Quem classificou, reclassificou, rateou, desfez, aprovou ou auto-classificou (com a classificação anterior e a nova), e quem fechou/reabriu competências (com motivo). | Somente inclusão, com `actorUid == auth.uid`; nunca alterada nem apagada — sobrevive até à exclusão do cliente. |
| `period_locks` | Competências fechadas (`{clientId}_{AAAA-MM}`). | Enquanto o documento existir, nenhum lançamento daquele mês pode ser alterado (`date` e `amount` são imutáveis). Reabrir = apagar o lock, registrando o motivo na auditoria. Importar novos lançamentos num mês fechado continua permitido. |
| `orgs/{orgId}` | Nome/CNPJ do escritório, nome, CRC e CPF do contador. | Só o próprio escritório lê e grava. |

- O representante legal (nome e CPF) fica em cada cliente. Os dois preenchem as assinaturas da DRE em PDF e Excel.
- Regras de aprendizado respeitam `matchType` (contém, começa com, exato). Quando várias casam, vence a mais restritiva, depois o termo mais longo, depois a mais recente. Criar ou aplicar uma regra classifica também os pendentes já gravados, em todos os meses abertos.
- Cada importação de OFX guarda o saldo final (`LEDGERBAL`) em `import_batches` e o confere com o saldo do extrato anterior da mesma conta mais a movimentação gravada no intervalo. A tela de Conciliação alerta divergências e lacunas de datas entre extratos.
- **Descrição do lançamento**: usa `NAME` (favorecido) e `MEMO` juntos — `Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado` — porque bancos como o InfinitePay mandam só um rótulo genérico no `MEMO`. Se um texto contém o outro, vale o mais completo. Ao reimportar um extrato que já existe, o app oferece **atualizar as descrições** dos lançamentos já importados, sem perder classificações (competências fechadas ficam de fora).
- **Saldo posterior ao extrato**: quando o saldo (`LEDGERBAL`) é de uma data depois do fim do período (InfinitePay informa o do dia da geração), ele não é conferido nem usado para sugerir o saldo inicial, pois inclui lançamentos que não estão no arquivo.
- **Codificação do OFX**: o arquivo é lido como bytes e decodificado como UTF-8 estrito (Nubank, PagBank…) com fallback para Windows-1252 (bancos antigos), em `src/lib/ofx/encoding.ts`. Históricos que já chegam com texto quebrado (`transferÃªncia`) são reparados na leitura. Importações antigas, feitas quando UTF-8 era lido como Latin-1, são corrigidas em **Contas e Extratos → Corrigir acentuação** (históricos e termos das regras; competências fechadas ficam para depois da reabertura; a correção é registrada na auditoria).

### Contas bancárias, balanço e pendências com o cliente

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `bank_accounts` | Conta do extrato (banco-agência-conta) ligada a uma conta analítica do ativo, com saldo inicial. Criada na importação; a primeira é ligada a 1.1.1.02. | Como os demais dados do cliente; a chave do extrato é imutável. |
| `client_requests` | Link de perguntas ao cliente. O id é um token aleatório de 128 bits. | Sem login, quem tem o link lê aquele documento e grava só as respostas, enquanto estiver aberto e dentro da validade (30 dias). Ninguém lista a coleção sem ser do escritório. |
| `client_request_files` | Comprovantes enviados pelo cliente (base64, até 700 kB por arquivo; fotos são reduzidas no navegador). | Criados apenas para um link aberto do mesmo escritório/cliente; só o escritório lê. |

- **Transferências entre contas próprias**: saída e entrada de mesmo valor em contas diferentes, até 3 dias de distância, são conciliadas juntas na conta transitória 1.1.1.04 (criada se faltar). Reclassificar, ratear, desfazer ou excluir uma perna volta a outra para pendente.
- **Balanço e balancete** são calculados por partidas dobradas a partir do extrato: conta do banco × conta classificada (ou rateio). Lançamentos não conciliados ficam em "Lançamentos a classificar"; saldos iniciais dos bancos entram no PL como "Saldos de abertura (a detalhar)".
- **Excluir extrato**: remove os lançamentos do lote (`importBatchId`; nos extratos antigos, a data/hora de gravação) e registra `BATCH_DELETE` na auditoria. As regras recusam excluir lançamento de competência fechada.
- **DRE comparativa**: mês a mês (com variação sobre o mês anterior) ou contra o mesmo período do ano anterior.

## Implantação (Firestore)

> ⚠️ **Ordem importa.** Documentos gravados antes do isolamento não têm `orgId` e ficam **inacessíveis** assim que as novas regras são publicadas. Rode o backfill antes.

1. **Backfill do `orgId`** nos dados existentes (idempotente; só altera documentos sem `orgId`). Use o UID do dono do escritório como `--org` e liste quem deve acessar em `--users`:

   ```bash
   # simulação
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/backfill-org-id.mjs --project <projeto> --org <uid-do-dono> --users <uid-do-dono>,<uid-colega> --dry-run
   # execução
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/backfill-org-id.mjs --project <projeto> --org <uid-do-dono> --users <uid-do-dono>,<uid-colega>
   ```

   A chave da conta de serviço é gerada em *Configurações do projeto → Contas de serviço* e **não** deve ser versionada.

2. **Índice e regras:**

   ```bash
   npx firebase-tools@15.31.0 deploy --only firestore:indexes,firestore:rules --project <projeto>
   ```

   Índices compostos necessários: `transactions (orgId, clientId, date desc)` para as consultas por período e `audit_log (orgId, clientId, at desc)` / `audit_log (orgId, clientId, transactionId, at desc)` para a auditoria. Aguarde o status *Enabled* no console antes de usar o app. As regras precisam estar publicadas antes do app novo, pois ele grava em `audit_log`, `period_locks`, `orgs`, `bank_accounts`, `client_requests` e `client_request_files`.

3. **Deploy do app** (Vercel) normalmente.
