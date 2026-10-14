# Tech Stack & Versões
- **Runtime & Framework**: Next.js 16.3.6 (App Router), React 19.2.8, React DOM 19.2.8
- **Linguagem**: TypeScript 5.x (target ES2022)
- **Pacotes**: npm
- **Estilização**: Tailwind CSS v4 (`@tailwindcss/postcss` 4.x), CSS Variables (`globals.css`)
- **Backend / BaaS**: Firebase 12.19.0 (Auth, Firestore), Firebase Admin 14.5.0
- **Testes**: Vitest 5.0.2 (unit + firestore rules), `@firebase/rules-unit-testing` 5.0.2
- **Exportação & Utilitários**: ExcelJS 4.4.0, jsPDF 4.2.1, jsPDF-AutoTable 5.0.8, Lucide React 1.48.0
- **Lint**: ESLint 9 (`eslint-config-next` 16.3.6)

# Comandos Essenciais
- **Dev**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Start**: `npm run start`
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **Lint**: `npm run lint` (`eslint`)
- **Testes Unitários**: `npm test` | Watch: `npm run test:watch`
- **Teste de Arquivo Único**: `npx vitest run <caminho-do-arquivo>` (ex: `npx vitest run src/lib/ledger.test.ts`)
- **Testes de Regras Firestore**: `npm run test:rules` (emulador Firestore, requer Java 21+)
- **Testes E2E**: `npm run test:e2e` (Playwright, modo local; `PLAYWRIGHT_CHANNEL=chrome` usa o Chrome instalado)
- **Deploy Firestore**: `npx firebase-tools@15.31.0 deploy --only firestore:indexes,firestore:rules --project <projeto>`
- **Limpar Firestore Emulador**: `npm run clean:firestore`

# Mapa de Arquitetura
- `src/app/`: Entrypoints e rotas Next.js App Router (`layout.tsx`, `page.tsx`, `painel/`, `dre/`, `balanco/`, `regras/`, etc.)
- `src/components/`: Componentes UI reutilizáveis por domínio (`conciliacao/`, `dre/`, `balanco/`, `lancamentos/`, `layout/`, `ui/`)
- `src/contexts/`: Estado global de autenticação e seleção de cliente (`AuthContext.tsx`, `ClientContext.tsx`)
- `src/hooks/`: Hooks de negócio e orquestração sem acoplamento direto de DB: carga e gravações de cada tela por domínio (`reconciliation/`, `contas/`, `regras/`, `lancamentos/`, `dre/`, `useLedgerData.ts`), `useReconciliation.ts`, `useTableKeyboard.ts`
- `src/lib/`: Core de domínio e infraestrutura:
  - `src/lib/data/`: Abstração de persistência (`repository.ts`, `firestore-repository.ts`, `local-repository.ts`)
  - `src/lib/services/`: Fachada de dados (`data-service.ts`) alternando Firestore vs Local Storage
  - `src/lib/ofx/`: Parser e decodificação UTF-8/Windows-1252 de arquivos OFX
  - `src/lib/chart/`: Plano de contas padrão ITG 1000 (2022)
  - `src/lib/dre/` & `src/lib/export/`: Cálculos contábeis de DRE e exportação PDF/Excel
  - `src/lib/rules/`, `payee.ts`, `ledger.ts`: Regras de conciliação, favorecidos e partidas dobradas
- `src/types/`: Definições centrais de tipos TypeScript (`firestore.ts`)
- `tests/rules/`: Testes unitários para regras de segurança `firestore.rules`

# Padrões de Código & Convenções
- **Repository Pattern**: Telas e hooks consomem `data-service.ts` / `repository.ts`; sem chamadas diretas ao Firestore na camada de UI.
- **Dual Mode (Firestore / Local)**: Se `NEXT_PUBLIC_FIREBASE_*` presentes, usa Firestore; caso contrário, `localStorage`. Sem fallback silencioso.
- **Multi-tenant**: Isolamento estrito por `orgId` em todas as coleções. `orgId` derivado de `users/{uid}.orgId` e imutável.
- **Auditoria & Travamento**: Coleção `audit_log` append-only; períodos fechados via `period_locks` tornam lançamentos imutáveis.
- **Contábil**: Partidas dobradas estritas (banco x conta contrapartida/rateio), plano de contas ITG 1000.
- **Nomenclatura**: Componentes em PascalCase (`*.tsx`), utilitários/serviços em kebab-case (`*.ts`), hooks em camelCase (`use*.ts`).
- **Tratamento de Erros**: Falha explícita na UI em operações negadas pelo backend/regras de validação.

# Diretrizes de Economia de Tokens (Regras de Comportamento)
- Não explique conceitos básicos; entregue apenas o código ou a solução direta.
- Ao editar arquivos, mostre apenas os blocos alterados ou aplique o diff diretamente sem reescrever arquivos inteiros no chat.
- Não leia diretórios fora do escopo da tarefa atual.
- Ignore completamente a leitura de: `node_modules/`, `dist/`, `build/`, `.next/`, `venv/`, `__pycache__/`, arquivos `.lock` e `.log`.
