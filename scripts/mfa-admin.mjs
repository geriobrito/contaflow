#!/usr/bin/env node
/**
 * Verificação em duas etapas (TOTP) do Firebase Auth: ativação no projeto e recuperação de acesso.
 *
 * O TOTP não tem botão no console: é ligado pela configuração do projeto, e exige o
 * Identity Platform (Console → Authentication → Settings → "Upgrade").
 *
 * Uso (credencial de conta de serviço com o papel "Firebase Authentication Admin"):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/mfa-admin.mjs --project <id> --enable
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/mfa-admin.mjs --project <id> --reset-user <uid>
 *
 * --enable            liga o TOTP no projeto (cada usuário ativa o seu em Escritório).
 * --reset-user <uid>  remove os segundos fatores do usuário: para quem perdeu o aplicativo
 *                     autenticador. O login volta a pedir só a senha.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function parseArgs(argv) {
  const args = { enable: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--enable') args.enable = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--reset-user') args.resetUser = argv[++i];
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  if (!args.project || (!args.enable && !args.resetUser)) {
    throw new Error('Informe --project <id> e --enable ou --reset-user <uid>. Veja o cabeçalho do script.');
  }
  return args;
}

async function main() {
  const { project, enable, resetUser } = parseArgs(process.argv.slice(2));
  initializeApp({ projectId: project, credential: applicationDefault() });
  const auth = getAuth();

  if (enable) {
    await auth.projectConfigManager().updateProjectConfig({
      multiFactorConfig: {
        // Aceita o código do intervalo atual e dos 5 vizinhos (relógio do celular fora de hora).
        providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 5 } }],
      },
    });
    console.log(`TOTP ativado no projeto ${project}.`);
  }

  if (resetUser) {
    const before = await auth.getUser(resetUser);
    const count = before.multiFactor?.enrolledFactors.length ?? 0;
    await auth.updateUser(resetUser, { multiFactor: { enrolledFactors: null } });
    console.log(`${before.email ?? resetUser}: ${count} segundo(s) fator(es) removido(s).`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
