import {
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  sendEmailVerification,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

/**
 * Verificação em duas etapas por aplicativo autenticador (TOTP) do Firebase Auth.
 *
 * Depende de o projeto ter o Identity Platform com TOTP ativado (scripts/mfa-admin.mjs); sem
 * isso o cadastro falha com `auth/operation-not-allowed`. Quem perder o aplicativo recupera o
 * acesso pelo mesmo script (`--reset-user`).
 */

const TOTP = TotpMultiFactorGenerator.FACTOR_ID;

export function authErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code } = err as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** O login com senha deu certo, mas a conta exige o código do autenticador. */
export const needsSecondFactor = (err: unknown): err is MultiFactorError => authErrorCode(err) === 'auth/multi-factor-auth-required';

export const secondFactorResolver = (err: MultiFactorError): MultiFactorResolver => getMultiFactorResolver(auth, err);

/** Conclui o login com o código de 6 dígitos do aplicativo. */
export async function resolveSecondFactor(resolver: MultiFactorResolver, code: string): Promise<void> {
  const hint = resolver.hints.find((h) => h.factorId === TOTP);
  if (!hint) throw Object.assign(new Error('Esta conta usa um segundo fator que o ContaFlow não suporta.'), { code: 'contaflow/unsupported-second-factor' });
  await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
}

/** Autenticadores cadastrados na conta. */
export const enrolledAuthenticators = (user: User): MultiFactorInfo[] => multiFactor(user).enrolledFactors.filter((f) => f.factorId === TOTP);

/** Gera o segredo a cadastrar no aplicativo. Exige e-mail verificado e login recente. */
export async function startAuthenticatorEnrollment(user: User): Promise<TotpSecret> {
  const session = await multiFactor(user).getSession();
  return TotpMultiFactorGenerator.generateSecret(session);
}

/** Confirma o cadastro com o primeiro código gerado pelo aplicativo. */
export async function finishAuthenticatorEnrollment(user: User, secret: TotpSecret, code: string): Promise<void> {
  await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), 'Aplicativo autenticador');
}

export async function removeAuthenticators(user: User): Promise<void> {
  for (const factor of enrolledAuthenticators(user)) await multiFactor(user).unenroll(factor);
}

export const sendVerificationEmail = (user: User): Promise<void> => sendEmailVerification(user);

/** Mensagem para o usuário a partir do código de erro do Firebase Auth. */
export function secondFactorMessage(err: unknown): string {
  switch (authErrorCode(err)) {
    case 'auth/invalid-verification-code':
      return 'Código incorreto ou expirado. Confira o aplicativo e tente de novo.';
    case 'auth/unverified-email':
      return 'Confirme seu e-mail antes de ativar: envie o e-mail de verificação e abra o link recebido.';
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
      return 'Por segurança, saia e entre de novo no sistema antes de repetir esta operação.';
    case 'auth/operation-not-allowed':
      return 'A verificação em duas etapas ainda não está ativada no projeto Firebase (veja o README, seção Segurança).';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos.';
    case 'auth/network-request-failed':
      return 'Sem conexão com o servidor. Verifique sua internet.';
    case 'contaflow/unsupported-second-factor':
      return 'Esta conta usa um segundo fator que o ContaFlow não suporta.';
    default:
      return `Não foi possível concluir (${err instanceof Error && err.message ? err.message : 'erro desconhecido'}).`;
  }
}
