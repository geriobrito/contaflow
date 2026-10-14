/** Mensagem de um erro qualquer, para compor o aviso ao usuário. */
export const describeError = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
