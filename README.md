# ContaFlow

Conciliação bancária por OFX com aprendizado contínuo, modelo de plano de contas do CFC (NBC TG 1002 / NBC TG 1001) e DRE com exportação em PDF/Excel. Next.js (App Router) + Firebase (Auth + Firestore).

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
| `npm test` | Testes unitários (Vitest): DRE, rateio, parser OFX, modelo de plano de contas, regras de casamento, repositório local |
| `npm run test:rules` | Regras do Firestore no emulador (requer Java 21+; baixa o `firebase-tools` via `npx`) |
| `npm run test:e2e` | Fluxo completo no navegador (Playwright), no modo local: login, empresa, modelo de plano de contas, importação de OFX, classificação, fechamento, DRE, Diário, Balanço, Razão, Contas, Regras e Lançamentos. Requer `npx playwright install chromium` (ou `PLAYWRIGHT_CHANNEL=chrome` para usar o Chrome instalado). Gera um build próprio com as variáveis do Firebase vazias: nunca toca num projeto real |
| `npm run build` | Build de produção |

O CI (`.github/workflows/ci.yml`) roda tudo isso em cada PR, mais um `npm audit` informativo das dependências de produção. O Dependabot (`.github/dependabot.yml`) abre PRs semanais de atualização.

### Organização do código

Cada tela compõe: a carga de dados e as gravações ficam num hook do domínio (`src/hooks/<domínio>/`, ex.: `useContasData`, `useRulesData`, `useJournalEntries`, `useDREData`; `useLedgerData` serve ao Razão e ao Diário) e os blocos da tela em `src/components/<domínio>/`. A conciliação segue o mesmo desenho com `useReconciliation` e os hooks de `src/hooks/reconciliation/`.

### Dados em formato antigo

`scripts/migrate-legacy.mjs` converteu, uma única vez, os dados em formato antigo do Firestore, e o código de compatibilidade saiu do app (tipos de conta e grupos da DRE em português, lançamentos sem `importBatchId`, a coleção `client_request_files`). O que ainda sobra é o campo `taxRegime` nas empresas, que o app não lê mais: rodar o script com `--apply` o remove. Sem `--apply` ele só relata o que encontraria.

## Arquitetura de dados

- `src/lib/data/repository.ts` — contrato único de persistência.
- `src/lib/data/firestore-repository.ts` / `local-repository.ts` — as duas implementações.
- `src/lib/services/data-service.ts` — fachada usada pelas telas; escolhe o repositório.
- `src/hooks/useReconciliation.ts` — orquestra importação, classificação, rateio e aprovação sobre o repositório (sem acesso direto ao Firestore).

### Isolamento por escritório (multi-tenant) e papéis

- Todo documento de dados (`clients`, `chart_of_accounts`, `classification_rules`, `transactions`, `import_batches`, `lock_state` e demais coleções da empresa) tem `orgId`.
- `users/{uid}.orgId` diz a qual escritório o usuário pertence. No primeiro login o perfil é criado com `orgId = uid` (escritório próprio).
- **Papéis (`users/{uid}.role`):** `admin` (padrão) ou `operator`. Operadores conciliam, importam extratos, criam cadastros e lançam/editam ajustes manuais e rotinas mensais, mas só administradores excluem empresas, extratos, lançamentos (bancários ou manuais do Diário), checklists do fechamento (`closing_checklists`), notas explicativas (`explanatory_notes`), contas do plano (`chart_of_accounts`), contas bancárias (`bank_accounts`) e saldos de abertura (`opening_balances`), ou reabrem competências. Em `classification_rules`, operadores só excluem regras criadas por eles mesmos (`createdByUid == auth.uid`; regras antigas sem autor ficam restritas a `admin`). Cadastros de documento único por empresa (`fixed_assets`, `prepaid_expenses`, `financing_contracts`, `investment_accounts`, `stock_controls` e `payroll_registers`) usam controle de concorrência otimista (`version`) dentro de transação para impedir sobrescrita silenciosa.
- **Colocar vários contadores no mesmo escritório:** defina `users/{uid}.orgId` igual ao do dono, pelo console do Firebase ou com o script de backfill (`--users`). O próprio usuário não consegue trocar de escritório nem de papel.
- `firestore.rules` garante: leitura/escrita só no próprio escritório, `orgId` imutável, `clientId` sempre de um cliente do mesmo escritório, consultas obrigatoriamente filtradas por `orgId`.

### Auditoria, fechamento e escritório

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `audit_log` | Quem classificou, reclassificou, rateou, desfez, aprovou ou auto-classificou (com a classificação anterior e a nova), e quem fechou/reabriu competências (com motivo). | Somente inclusão, com `actorUid == auth.uid`; nunca alterada nem apagada — sobrevive até à exclusão do cliente. |
| `period_locks` | Competências fechadas (`{clientId}_{AAAA-MM}`). | Enquanto o documento existir, nenhum lançamento daquele mês pode ser alterado (`date` e `amount` são imutáveis). Reabrir = apagar o lock, registrando o motivo na auditoria (`admin`). Importar novos lançamentos num mês fechado continua permitido. |
| `lock_state` | Resumo por empresa dos fechamentos (`count` de competências fechadas e `seq` monotônico incrementado a cada fechamento mensal ou encerramento de exercício). | Atualizado no mesmo lote de `period_locks` e `YEAR_CLOSE`. Enquanto `count > 0`, `opening_balances`, saldo/data/vínculo contábil de `bank_accounts` e estrutura (`code`, `type`, `nature`, `parentId`, `level`, `dreGroup`, `isContra`) de `chart_of_accounts` gravados antes do último fechamento ficam congelados até todas as competências serem reabertas; nomes, apelidos e descrições continuam editáveis. |
| `orgs/{orgId}` | Nome/CNPJ do escritório, nome, CRC e CPF do contador. | Só o próprio escritório lê e grava. |

- O representante legal (nome e CPF) fica em cada cliente. Os dois preenchem as assinaturas da DRE em PDF e Excel.
- Regras de aprendizado respeitam `matchType` (contém, começa com, exato). Quando várias casam, vence a mais restritiva, depois o termo mais longo, depois a mais recente. Criar ou aplicar uma regra classifica também os pendentes já gravados, em todos os meses abertos.
- Cada importação de OFX guarda o saldo final (`LEDGERBAL`) em `import_batches` e o confere com o saldo do extrato anterior da mesma conta mais a movimentação gravada no intervalo. A tela de Conciliação alerta divergências e lacunas de datas entre extratos.
- **Descrição do lançamento**: usa `NAME` (favorecido) e `MEMO` juntos — `Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado` — porque bancos como o InfinitePay mandam só um rótulo genérico no `MEMO`. Se um texto contém o outro, vale o mais completo. Ao reimportar um extrato que já existe, o app oferece **atualizar as descrições** dos lançamentos já importados, sem perder classificações (competências fechadas ficam de fora).
- **Painel** (`/painel`, tela inicial após o login): por empresa, junta o que antes estava em telas separadas — pendentes e aguardando aprovação, estado de cada mês (fechado, pronto para fechar, em aberto, sem movimento), extratos por conta (divergência de saldo, lacunas, desatualizado), perguntas ao cliente (sem link, aguardando, respondidas) e cadastros incompletos. Cada alerta leva à tela certa; os de lançamentos abrem a Conciliação no mês e filtro corretos (`/?mes=AAAA-MM&filtro=PENDING`).
- **Saldos de abertura** (`/abertura`, coleção `opening_balances`, um documento por cliente): saldo das contas patrimoniais que não são bancos (clientes, estoque, imobilizado, fornecedores, capital…) numa data, no lado natural da conta (retificadoras reduzem o grupo). A contrapartida é a conta virtual "Saldos de abertura (a detalhar)", que zera quando ativo (com os bancos) = passivo + PL; a tela mostra a diferença e lança-a numa conta de PL à escolha. Alterações são auditadas (`OPENING_SAVE`).
- **Classificação por favorecido** (Conciliação → *Por favorecido*): os pendentes são agrupados por quem pagou/recebeu e sentido (entrada/saída), em `src/lib/payee.ts`, que reconhece os formatos do InfinitePay, Nubank e PagBank (ignora "Pix", "Transferência recebida pelo Pix", CPF mascarado, CNPJ, banco/agência e o sufixo "- Enviado"). Um clique classifica o grupo todo e cria uma única regra, que também classifica pendentes de outros períodos.
- **Termos de regra**: o termo sugerido é o favorecido, não a descrição inteira. Termos só com palavras da operação ("enviado", "pix", "recebido") ou curtos demais são *genéricos* e exigem "Criar mesmo assim"; termos que casam com 3 ou mais favorecidos diferentes (ou 40% dos lançamentos) são *amplos* e geram aviso. A tela de Regras marca as regras existentes que se enquadram.
- **Saldo posterior ao extrato**: quando o saldo (`LEDGERBAL`) é de uma data depois do fim do período (InfinitePay informa o do dia da geração), ele não é conferido nem usado para sugerir o saldo inicial, pois inclui lançamentos que não estão no arquivo.
- **Codificação do OFX**: o arquivo é lido como bytes e decodificado como UTF-8 estrito (Nubank, PagBank…) com fallback para Windows-1252 (bancos antigos), em `src/lib/ofx/encoding.ts`. Históricos que já chegam com texto quebrado (`transferÃªncia`) são reparados na leitura. Importações antigas, feitas quando UTF-8 era lido como Latin-1, são corrigidas em **Contas e Extratos → Corrigir acentuação** (históricos e termos das regras; competências fechadas ficam para depois da reabertura; a correção é registrada na auditoria).

### Contas bancárias, balanço e pendências com o cliente

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `bank_accounts` | Conta do extrato (banco-agência-conta) ligada a uma conta analítica do ativo, com saldo inicial. Criada na importação; a primeira é ligada a 1.1.1.02. | Como os demais dados do cliente; a chave do extrato é imutável. |
| `client_requests` | Link de perguntas ao cliente. O id é um token aleatório de 128 bits. | Sem login, quem tem o link lê aquele documento e grava só as respostas em texto (campo `answers`, uma por pergunta; as perguntas em `items` não mudam), enquanto estiver aberto e dentro da validade (30 dias). Ninguém lista a coleção sem ser do escritório. |
| `period_snapshots` | Saldos consolidados por conta contábil e movimentação por conta bancária até o fim de uma competência fechada (id `{clientId}_{AAAA-MM}`). Cache de leitura: balanço, razão, painel e Contas e extratos partem dele e leem só os lançamentos posteriores, em vez do histórico inteiro. | O app confere cada snapshot antes de usar (competências ainda fechadas, mesma configuração de bancos/plano, mesma contagem de lançamentos) e o regrava quando não confere. Isolado por escritório. |

- **Transferências entre contas próprias**: saída e entrada de mesmo valor em contas diferentes, até 3 dias de distância, são conciliadas juntas na conta transitória 1.1.1.04 (criada se faltar). Reclassificar, ratear, desfazer ou excluir uma perna volta a outra para pendente.
- **Balanço e balancete** são calculados por partidas dobradas a partir do extrato: conta do banco × conta classificada (ou rateio). Lançamentos não conciliados ficam em "Lançamentos a classificar"; saldos iniciais dos bancos entram no PL como "Saldos de abertura (a detalhar)".
- **Retenções da NFS-e** (`src/lib/nfe/parser.ts`, `src/lib/nfe/retentions.ts`, `invoiceRetentionSplit` em `src/lib/splits.ts`): a importação lê da NFS-e do padrão nacional o IRRF, o PIS, a COFINS, a CSLL, o INSS e o ISS retidos (conferidos com a diferença entre serviço e líquido; o que a nota não discrimina fica como "não discriminado"). Quando a nota casa com o extrato pelo líquido, a Conciliação oferece o bruto × líquido pronto: no recebimento, a receita pelo bruto e o retido em 1.1.2.09 IRRF a Recuperar e 1.1.2.10 PIS/COFINS/CSLL Retidos a Recuperar (plano sem elas: 1.1.2.05); no pagamento, a despesa pelo bruto e o retido em 2.1.5.04 IRRF a Recolher e 2.1.5.08 PIS/COFINS/CSLL Retidos a Recolher. Prestadora do Simples Nacional com IRRF/CSRF retidos recebe aviso (retenção dispensada para optante: IN SRF 765/2007 e Lei 10.833/2003, art. 32). Notas importadas antes desta leitura não têm o detalhe: importe o XML de novo.
- **Excluir extrato**: remove os lançamentos do lote (`importBatchId`) e registra `BATCH_DELETE` na auditoria. As regras recusam excluir lançamento de competência fechada.
- **DRE comparativa**: mês a mês (com variação sobre o mês anterior) ou contra o mesmo período do ano anterior.
- **Livro Diário** (`/diario`, `src/lib/daybook.ts`): todos os lançamentos do período em ordem cronológica — extrato (banco × conta classificada ou rateio), lançamentos manuais e saldos de abertura — com as partidas a débito e a crédito e número de ordem contado desde 1º de janeiro. Os totais são os do balancete do mesmo período. O PDF (`src/lib/export/daybook-pdf.ts`) sai com termo de abertura, lançamentos e termo de encerramento, com total de páginas e assinaturas; número do livro, sede e registro são informados na tela e ficam guardados no navegador. Enquanto houver lançamento a classificar ou competência aberta no período, a tela e os termos avisam que a emissão é provisória.
- **Repetir do mês anterior** (Lançamentos Manuais): copia para a competência selecionada os lançamentos manuais do mês anterior ainda não repetidos, com as mesmas contas e valores, a data no mesmo dia do mês e a competência citada no histórico e no documento atualizada (`repeatCandidates`/`repeatDraft` em `src/lib/journal.ts`). Folha, depreciação, tributos e provisões vêm marcados; a cópia guarda a origem em `repeatedFromId`, para não ser oferecida duas vezes.
- **Comprovante do lançamento manual**: é um link (http/https) para o documento na nuvem, validado ao salvar (`parseAttachmentUrl`); caminho do computador e nome de arquivo são recusados com explicação. O sistema não armazena arquivos.

### Seguros e despesas antecipadas

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `prepaid_expenses` | Apólices e contratos pagos antes de consumidos (um documento por cliente): valor, data, vigência em meses, uso (custo/despesa), bem segurado, contas do ativo, da obrigação e do resultado. | Isolado por escritório; até 300 itens. Gravações auditadas (`PREPAID_SAVE`). |

- **Tela** Bens e Contratos › Seguros e despesas antecipadas (`/despesas-antecipadas`, `src/lib/prepaid-expenses.ts`).
- **Na data da apólice**: D 1.1.4.01 Seguros a Apropriar / C 2.1.3.05 Seguros a Pagar pelo prêmio total, gravado junto com o cadastro (`prepaidId`). Os pagamentos das parcelas vêm pelo extrato, classificados em Seguros a Pagar.
- **Apropriação mensal** pela vigência (nunca pelas parcelas): valor ÷ meses, a partir do mês da apólice, no último dia (`prepaidMonth`), em 3.3.2.18 Seguros ou, com o bem usado na atividade-fim, em 3.2.1.05 Seguros Aplicados aos Custos.
- **Rotinas do mês**: o fechamento da competência exige a depreciação e a apropriação lançadas (`src/lib/services/month-routines.ts`); a barra de fechamento lança as duas de uma vez.
- O Balanço avisa quando o saldo a apropriar diverge do cadastro.

### Empréstimos, financiamentos e parcelamentos

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `financing_contracts` | Contratos da empresa (um documento por cliente): tipo (empréstimo, financiamento, parcelamento de impostos), valor, encargos da contratação, parcelas, 1º vencimento, juros prefixados (taxa a.m.) ou pós-fixados (Selic) e as contas. | Isolado por escritório; até 100 contratos. Gravações auditadas (`FINANCING_SAVE`). |

- **Tela** Bens e Contratos › Empréstimos e financiamentos (`/financiamentos`, `src/lib/financing.ts`), com a tabela de parcelas de cada contrato.
- **Lançamento inicial** na data do contrato (`financingId`): D contrapartida (fornecedor do bem, imposto parcelado ou 1.1.1.04, que recebe o depósito do empréstimo), D 3.4.1.01.006 pelos encargos da contratação (IOF, cadastro, registro), D (−) Encargos Financeiros a Transcorrer (2.1.4.03 e 2.2.1.02) pelos juros prefixados, C obrigação — curto prazo para as parcelas que vencem até 31/12 do ano seguinte, longo prazo para as demais.
- **Tabela Price**: juros = saldo × taxa (a do contrato ou a calculada pela parcela); a última parcela acerta o total para dar exatamente parcelas − valor financiado.
- **Rotina mensal** (`financingMonth`): os juros da parcela que vence no mês saem dos encargos a transcorrer para 3.4.1.01.005; em dezembro, as parcelas do ano seguinte passam do longo para o curto prazo (obrigação e encargos). Entra nas rotinas do mês que travam o fechamento.
- **Pós-fixado** (parcelamento pela Selic): sem encargos a transcorrer; ao classificar o pagamento na conta de curto prazo, a Conciliação sugere o rateio parcela-base + juros (3.4.1.01.007).
- **Pagamentos** vêm pelo extrato, classificados na conta de curto prazo. O Balanço avisa quando obrigações e encargos divergem dos contratos (parcelas vencidas supostas pagas).

### Aplicações financeiras

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `investment_accounts` | Aplicações da empresa (um documento por cliente): nome, conta do plano (padrão 1.1.1.03), primeira competência, encerramento e o saldo bruto do extrato da aplicação em cada competência. | Isolado por escritório; até 50 aplicações. Gravações auditadas (`INVESTMENT_SAVE`). |

- **Tela** Bens e Contratos › Aplicações financeiras (`/aplicacoes`, `src/lib/investments.ts`): o saldo de cada aplicação na competência e a conferência com o razão.
- **Aplicar e resgatar** pelo extrato da conta corrente: a saída vai para a conta da aplicação; a entrada nela é resgate, e a Conciliação oferece o bruto × líquido com o IR (3.3.2.19 IR sobre Aplicações Financeiras no Simples Nacional e no MEI, onde não se recupera; 1.1.2.12 IRRF sobre Aplicações a Recuperar no Presumido e no Real) e o IOF (3.4.1.01.003).
- **Rendimento mensal** (`investmentMonth`), por competência: no último dia, D aplicação / C 3.4.1.02.001 pela diferença entre o saldo informado e o saldo contábil da conta sem o rendimento do próprio mês. Saldo contábil acima do extrato bloqueia (resgate, IR ou IOF não lançados; perda da aplicação vai à mão).
- **Rotinas do mês**: com aplicação cadastrada, a competência só fecha com o saldo informado e o rendimento lançado; a barra de fechamento leva à tela para informar o saldo.

### Estoque e CMV

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `stock_controls` | Controle do estoque da empresa (um documento por cliente): contas do estoque e do custo, primeira competência, frequência do relatório (mensal ou trimestral) e o estoque final informado em cada competência, com a origem. | Isolado por escritório. Gravações auditadas (`STOCK_SAVE`). |

- **Tela** Bens e Contratos › Estoque e CMV (`/estoque`, `src/lib/stock.ts`). O controle do estoque é do cliente (sistema de vendas ou planilha); a tela copia um pedido pronto do estoque final para mandar ao cliente.
- **CMV mensal** (`stockMonth`), no último dia: o lançamento leva o saldo contábil do estoque (sem o CMV do próprio mês) ao estoque final informado — D custo / C estoque quando o contábil é maior (compras lançadas no estoque) ou D estoque / C custo quando é menor (compras lançadas direto no custo). Nos dois casos, CMV = estoque inicial + compras − estoque final.
- **Rotinas do mês**: estoque final informado e não lançado trava o fechamento; estoque não informado só avisa (há cliente que manda por trimestre), assim como lucros distribuídos (2.3.3.03) num mês sem CMV.

### Fechamento do exercício (checklist)

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `closing_checklists` | Itens conferidos à mão no fechamento de um exercício (`${clientId}_${AAAA}`) e a comprovação da escrituração (ECD, Junta Comercial ou cartório, com data e recibo). | Isolado por escritório; até 30 itens. |

- **Tela Fechamento do Exercício** (`/fechamento`, `src/lib/closing-checklist.ts`): conferências automáticas sobre o balancete do ano — competências fechadas, exercício encerrado, declaração de conformidade, porte informado, **receita sem custo na DRE** (prestadora sem custo dos serviços, comércio sem CMV), **saldo virado** em qualquer conta (caixa credor, obrigação devedora, despesa credora), **terminologia** ("provisão" em férias e 13º, com botão para renomear; lucro antecipado no ativo; multa, juros, tarifa e IOF fora do resultado financeiro; contas genéricas com saldo), depreciação ausente ou maior que o custo e contas do grupo 2.3.3 com saldo depois do encerramento. Mais os itens conferidos com os documentos do cliente (caixa, impostos, folha, capital, receita, estoque, norma).
- **Ajustes de Exercícios Anteriores** (2.3.3.05): zerada no encerramento como a 2.3.3.04 (credora contra Lucros Acumulados, devedora contra Prejuízos Acumulados); a DLPA a mostra na linha de ajustes.
- **Comparabilidade**: o balanço (tela e PDF) traz a coluna de 31/12 do exercício anterior, e o PDF da DRE, a do mesmo período do ano anterior, quando há movimento nele.

### Imobilizado e depreciação

| Coleção | Conteúdo | Regras |
| --- | --- | --- |
| `fixed_assets` | Cadastro dos bens da empresa (um documento por cliente, id = clientId): conta do bem (1.2.3.x ou 1.2.4.x), uso (atividade-fim → custo; administrativo/comercial → despesa), data da nota, data de início de uso, composição do custo (nota + frete/instalação + tributos não recuperáveis − descontos), taxa anual, residual, depreciação já lançada fora da rotina e baixa. | Isolado por escritório; até 300 bens. Gravações auditadas (`ASSET_SAVE`). |

- **Cálculo** (`src/lib/fixed-assets.ts`): linha reta, cota mensal = (custo − residual) × taxa ÷ 12, em centavos. O primeiro mês é proporcional aos dias desde o início de uso (dia 1º = mês cheio); a última cota é o que falta para a base. Na baixa, a depreciação vai até a data, também proporcional. Taxas sugeridas pela conta (IN RFB 1700/2017, Anexo III): edificações 4%, máquinas e móveis 10%, veículos, informática, softwares e marcas 20%, terrenos 0%.
- **Lançamento mensal**: um por competência, no último dia (`depreciationMonth`), com D 3.2.1.04 (custo) e/ou D 3.3.2.15 (despesa) e C 1.2.3.07 / 1.2.4.03 por classe de bem. Se o cadastro muda com o mês aberto, o lançamento é atualizado. Contas do modelo que faltam (ex.: 3.2.1.04) entram no plano ao lançar.
- **Fechamento**: com bens cadastrados, a competência só fecha com a depreciação do mês lançada e conferida com o cadastro (a norma pede o lançamento mensal). A barra de fechamento da Conciliação mostra o aviso e o botão de lançar; a tela Imobilizado lança os meses abertos que ficaram para trás.
- **Competências fechadas**: bem com cota em mês fechado não muda custo, taxa, conta, uso nem datas (dá para editar a descrição, ou dar baixa e recadastrar). Bem novo cujas cotas cairiam em meses fechados pede a "depreciação já contabilizada" até o último deles (a da abertura ou a lançada à mão antes do cadastro).
- **Baixa**: D acumulada até a data, D 3.3.9.04 Custo do Imobilizado e Intangível Baixado (valor contábil) e C conta do bem, gravados junto com o cadastro (`fixedAssetId`). Na venda, o mesmo lançamento traz D 1.1.2.11 Créditos pela Venda / C 3.3.9.02 Receita na Venda, pelo valor da nota: receita e custo separados, sem conta de "ganho" ou "perda" (o resultado da venda sai na DRE pela diferença). O recebimento vem pelo extrato em 1.1.2.11, que a DFC trata como atividade de investimento; a NF-e de venda de imobilizado (CFOP x551) sugere essa conta. O checklist do fechamento oferece renomear as contas 3.3.9.02/3.3.9.04 que ainda têm os nomes antigos.
- **Intangível**: amortização na 1.2.4.03, com o mesmo motor. Na microentidade, prazo máximo de 5 anos (taxa de 20% ao ano ou maior; NBC TG 1002, seção 18), exigido no cadastro novo e na troca de taxa; na pequena empresa, só aviso.
- **Conferência**: o Balanço avisa quando custo por conta ou acumulada diferem do cadastro; a tela Imobilizado confere com o balancete sob demanda e exporta o relatório analítico (PDF/Excel). As notas explicativas trazem as taxas por classe e o quadro custo × acumulada × líquido.

### Leituras

- **Cache em memória** (`src/lib/data/cached-repository.ts`): plano de contas, contas bancárias e fechamentos ficam guardados por cliente e são relidos só depois de uma gravação que os altere, ou após 5 minutos (limite da defasagem em relação a outra aba ou aparelho). Recarregar a página zera o cache.
- **Regras**: a tela avalia as regras contra os pendentes de qualquer período e os lançamentos dos últimos 12 meses (`loadRuleSample`), não contra o histórico inteiro.

### Backup

- **Por empresa (JSON)**: em *Clientes*, o botão de download do cartão gera um arquivo `contaflow-backup` v2 (`src/lib/export/client-backup.ts`) com tudo o que pertence à empresa — cadastro, plano de contas, regras, contas bancárias, saldos de abertura, extratos, lançamentos, lançamentos manuais e contador, fechamentos (`period_locks` e `lock_state`), cadastros auxiliares (imobilizado, despesas antecipadas, contratos, aplicações, estoque e folha), checklists de fechamento, notas explicativas, notas fiscais resumidas, pendências e trilha de auditoria (limitada a 20.000 eventos, com aviso `auditTruncated` na interface caso atinja o teto). A confirmação de exclusão oferece o mesmo backup antes de apagar. Também em *Clientes*, **Restaurar backup** (`src/lib/export/client-restore.ts`) reimporta JSONs v1/v2 — restaurando literalmente no modo local ou criando uma nova empresa com remapeamento de IDs e recriação de lotes/fechamentos no modo Firestore.
- **Do banco inteiro (Firestore)**: ative a recuperação pontual (7 dias) e um backup diário no projeto. São configurações do projeto, feitas uma vez, fora do app:

  ```bash
  gcloud firestore databases update --database='(default)' --enable-pitr --project <projeto>
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d --project <projeto>
  ```

## Segurança

- **Cabeçalhos HTTP** (`next.config.ts`): `Content-Security-Policy` (scripts e estilos só da própria origem, conexões só para as APIs do Google, reCAPTCHA do App Check), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer` em todas as páginas; `X-Robots-Tag: noindex` em `/responder`. Ao integrar um serviço externo novo, inclua o domínio dele na CSP — o navegador bloqueia o que não estiver listado.
- **Link de pendências**: o token vai no fragmento do endereço (`/responder#t=…`), que o navegador não envia ao servidor — não aparece em registros de acesso. Links antigos (`?t=`) continuam abrindo. As regras limitam cada resposta a texto de até 2000 caracteres; como elas não têm laços e cada avaliação tem um teto de expressões, a conferência cobre links de até 24 perguntas (os maiores seguem aceitando respostas, limitados pelo tamanho do documento).
- **Recuperação de senha**: "Esqueci minha senha" na tela de login envia o e-mail de redefinição do Firebase Auth.
- **Verificação em duas etapas** (aplicativo autenticador, TOTP). Ativação, uma vez por projeto:
  1. No console do Firebase, *Authentication → Settings*, faça o upgrade para o **Identity Platform**.
  2. Ligue o TOTP (não há botão no console):

     ```bash
     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/mfa-admin.mjs --project <projeto> --enable
     ```

  3. Cada usuário ativa o seu em *Escritório → Verificação em duas etapas* (exige e-mail confirmado e login recente).

  Quem perder o aplicativo autenticador recupera o acesso com `node scripts/mfa-admin.mjs --project <projeto> --reset-user <uid>` — guarde a chave da conta de serviço num lugar que não dependa do celular.
- **App Check** (opcional): atesta que as chamadas ao Firebase partem deste app, inclusive a leitura pública dos links de pendências.
  1. Crie uma chave do **reCAPTCHA Enterprise** (tipo site) para o domínio do app, no console do Google Cloud.
  2. No console do Firebase, *App Check → Apps*, registre o app web com essa chave.
  3. Defina `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` no ambiente de produção e publique.
  4. Acompanhe as métricas do App Check por alguns dias e só então ative a exigência (*Enforce*) para o Firestore. Com a exigência ligada, rodar o app em `localhost` contra o projeto real pede um token de depuração do App Check.
- **Cadastro de usuários**: as regras deixam qualquer usuário autenticado criar o próprio escritório (é assim que o primeiro login funciona). Para ninguém de fora criar conta, desligue o cadastro em *Authentication → Settings → User actions → Enable create (sign-up)* e crie os usuários pelo console.
- **Ordem de deploy**: o app novo depende das regras novas, e o CI só publica regras e índices depois dos testes. Se a Vercel publica o app direto no push, ele pode entrar no ar alguns minutos antes. Para amarrar a ordem:
  1. Na Vercel, crie um *Deploy Hook* para a `main` (*Settings → Git → Deploy Hooks*) e cadastre a URL no repositório como o segredo `VERCEL_DEPLOY_HOOK_URL`: o job `deploy-app` do CI passa a acionar o deploy depois das regras.
  2. Desligue o deploy automático da `main` com um `vercel.json` na raiz:

     ```json
     { "git": { "deploymentEnabled": { "main": false } } }
     ```

  Faça os dois passos juntos e confira no primeiro push se o deploy saiu pelo hook: com o passo 2 e sem o segredo, a produção deixa de ser atualizada.

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

2. **Backfill do `lock_state`** para empresas já cadastradas (idempotente; calcula `count` de `period_locks` e `seq` monotônico a partir de `audit_log`, exigido pelas regras de congelamento de cadastros):

   ```bash
   # simulação
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/backfill-lock-state.mjs --project <projeto>
   # execução
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/backfill-lock-state.mjs --project <projeto> --apply
   ```

3. **Índice e regras:**

   ```bash
   npx firebase-tools@15.31.0 deploy --only firestore:indexes,firestore:rules --project <projeto>
   ```

   Índices compostos necessários: `transactions (orgId, clientId, date desc)` para as consultas por período e `audit_log (orgId, clientId, at desc)` / `audit_log (orgId, clientId, transactionId, at desc)` para a auditoria. Aguarde o status *Enabled* no console antes de usar o app. As regras precisam estar publicadas antes do app novo, pois ele grava em `audit_log`, `period_locks`, `lock_state`, `orgs`, `bank_accounts`, `opening_balances`, `client_requests`, `journal_entries`, `journal_counters` (sequência dos lançamentos manuais) e `period_snapshots` (saldos consolidados).

   **Publicação automática:** a cada merge na `main`, depois de todos os testes passarem, o CI (`.github/workflows/ci.yml`, job `deploy-firestore`) publica as regras e os índices no projeto do `.firebaserc`. Para ativar, cadastre no repositório (*Settings → Secrets and variables → Actions*) o segredo `FIREBASE_SERVICE_ACCOUNT` com o JSON de uma conta de serviço que tenha os papéis *Firebase Rules Admin* e *Cloud Datastore Index Admin*. Sem o segredo, o job só emite um aviso e nada é publicado.

4. **Deploy do app** (Vercel) normalmente.
