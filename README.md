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

   O índice composto `transactions (orgId, clientId, date desc)` é necessário para as consultas por período; aguarde o status *Enabled* no console antes de usar o app.

3. **Deploy do app** (Vercel) normalmente.
