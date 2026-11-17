# Tech Stack & Versões
- **Runtime & Framework**: Next.js 16.3.6 (App Router), React 19.2.8, React DOM 19.2.8
- **Linguagem**: TypeScript 5.x (target ES2022)
- **Pacotes**: npm
- **Estilização**: Tailwind CSS v4 (`@tailwindcss/postcss` 4.x), CSS Variables (`globals.css`)
- **Backend / BaaS**: Firebase 12.19.0 (Auth, Firestore), Firebase Admin 14.5.0
- **Testes**: Vitest 5.0.2 (unit + firestore rules), `@firebase/rules-unit-testing` 5.0.2
- **Gráficos**: Recharts 3.10 (Visão Executiva do Painel, `src/components/painel/ExecutiveCharts.tsx`); cores das séries nas variáveis `--viz-*` de `globals.css`, uma por entidade e conferidas como conjunto para daltonismo e contraste nos dois temas
- **Exportação & Utilitários**: ExcelJS 4.4.0, jsPDF 4.2.1, jsPDF-AutoTable 5.0.8, Lucide React 1.48.0
- **Monitoramento**: Sentry (`@sentry/nextjs` 11.10, `withSentryConfig` vem de `@sentry/nextjs/config`); erros sempre por `reportError` (`src/lib/monitoring`), nunca `console.error` direto
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
- **Testes Visuais**: `npm run test:visual` (compara capturas das telas principais, temas claro e escuro, com `e2e/visual.spec.ts-snapshots/`); após mudança visual desejada, `npm run test:visual:update`. Referências `*-win32.png` são locais; as `*-linux.png` são do job `visual` do CI (imagem `mcr.microsoft.com/playwright:v1.64.0-noble`), regravadas pela execução manual do workflow (artefato `visual-snapshots`)
- **Deploy Firestore**: `npx firebase-tools@15.31.0 deploy --only firestore:indexes,firestore:rules --project <projeto>`
- **Limpar Firestore Emulador**: `npm run clean:firestore`
- **Tabela cClassTrib do IBS/CBS**: `python -I scripts/update-cclasstrib.py <clone de github.com/ReceitaFederal/calculadora-rtc-regime-regular>` regenera `src/lib/nfe/cclasstrib-table.ts` (só lê os `.sql` do repositório); confira o diff e rode os testes

# Mapa de Arquitetura
- `src/app/`: Entrypoints e rotas Next.js App Router (`layout.tsx`, `page.tsx`, `painel/`, `dre/`, `balanco/`, `regras/`, etc.)
- `src/components/`: Componentes UI reutilizáveis por domínio (`conciliacao/`, `dre/`, `balanco/`, `lancamentos/`, `layout/`, `ui/`)
  - `src/components/layout/nav.ts`: fonte única do menu (ordem, seções, busca rápida e título da aba). A ordem segue o trabalho: Início, Rotina do mês (passos numerados, na sequência em que são feitos), Demonstrações e Cadastros (ordem de implantação). Tela nova entra aqui, na posição do fluxo
- `src/contexts/`: Estado global de autenticação e seleção de cliente (`AuthContext.tsx`, `ClientContext.tsx`)
- `src/hooks/`: Hooks de negócio e orquestração sem acoplamento direto de DB: carga e gravações de cada tela por domínio (`reconciliation/`, `contas/`, `regras/`, `lancamentos/`, `dre/`, `useLedgerData.ts`), `useReconciliation.ts`, `useTableKeyboard.ts`
- `src/lib/`: Core de domínio e infraestrutura:
  - `src/lib/data/`: Abstração de persistência (`repository.ts`, `firestore-repository.ts`, `local-repository.ts`); as duas implementações são montadas por domínio em `data/firestore/` e `data/local/` (mesmos nomes de arquivo nos dois). Mudou um, mude o outro: `tests/rules/repository-contract.test.ts` roda a mesma bateria contra ambos
  - `src/lib/dre/summaries.ts` + `src/lib/services/result-loader.ts`: resumos da DRE de competências fechadas (`result_summaries`), lidos no lugar dos lançamentos desses meses
  - `src/lib/financial-indicators.ts`, `src/lib/obligations.ts` (+ `business-days.ts`), `src/lib/fees.ts`: análise das demonstrações, agenda de obrigações e honorários (`/agenda`)
  - `src/lib/services/`: Fachada de dados (`data-service.ts`) alternando Firestore vs Local Storage
  - `src/lib/ofx/`: Parser e decodificação UTF-8/Windows-1252 de arquivos OFX
  - `src/lib/chart/`: Modelo de plano de contas do CFC (NBC TG 1002, Anexo 11; arquivo `itg1000.ts` por legado)
  - `src/lib/dre/` & `src/lib/export/`: Cálculos contábeis de DRE e exportação PDF/Excel
  - `src/lib/reconciliation.ts` (motor das regras: termo, condições e precedência), `rule-suggestions.ts`, `rule-copy.ts`, `payee.ts`, `ledger.ts`: Regras de conciliação, favorecidos e partidas dobradas
- `src/types/`: Definições centrais de tipos TypeScript (`firestore.ts`)
- `tests/rules/`: Testes unitários para regras de segurança `firestore.rules`

# Padrões de Código & Convenções
- **Repository Pattern**: Telas e hooks consomem `data-service.ts` / `repository.ts`; sem chamadas diretas ao Firestore na camada de UI.
- **Dual Mode (Firestore / Local)**: Se `NEXT_PUBLIC_FIREBASE_*` presentes, usa Firestore; caso contrário, `localStorage`. Sem fallback silencioso.
- **Multi-tenant**: Isolamento estrito por `orgId` em todas as coleções. `orgId` derivado de `users/{uid}.orgId` e imutável.
- **Auditoria & Travamento**: Coleção `audit_log` append-only; períodos fechados via `period_locks` tornam lançamentos imutáveis.
- **Contábil**: Partidas dobradas estritas (banco x conta contrapartida/rateio), modelo de plano de contas do CFC; norma das demonstrações pelo porte do cliente (NBC TG 1002 microentidade / NBC TG 1001 pequena empresa).
- **Nomenclatura**: Componentes em PascalCase (`*.tsx`), utilitários/serviços em kebab-case (`*.ts`), hooks em camelCase (`use*.ts`).
- **Tratamento de Erros**: Falha explícita na UI em operações negadas pelo backend/regras de validação.
- **Datas**: "hoje" e "mês atual" sempre por `todayISO()` (`src/lib/business-days.ts`, data local); nunca `new Date().toISOString()`, que é UTC e vira o dia às 21h de Brasília.
- **Campo de valor**: `MoneyInput` (`src/components/ui/MoneyInput.tsx`) em telas novas: digita-se o valor como ele é ("1500" ou "1.500,00") e ele aparece formatado ao sair do campo; nenhum campo trata os dígitos como centavos entrando pela direita.
- **Avisos (toast)**: `useToast` + `<Toast />` de `src/components/ui/Toast.tsx`; sem marcação própria por tela.
- **Tema escuro**: fio ou realce em preto translúcido (`border-black/N`, `hover:bg-black/N`) sempre com o par `dark:` (ou os tokens `border-line` / `border-line-strong`).

# Diretrizes de Economia de Tokens (Regras de Comportamento)
- Não explique conceitos básicos; entregue apenas o código ou a solução direta.
- Ao editar arquivos, mostre apenas os blocos alterados ou aplique o diff diretamente sem reescrever arquivos inteiros no chat.
- Não leia diretórios fora do escopo da tarefa atual.
- Ignore completamente a leitura de: `node_modules/`, `dist/`, `build/`, `.next/`, `venv/`, `__pycache__/`, arquivos `.lock` e `.log`.
