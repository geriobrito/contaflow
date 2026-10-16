/**
 * Entrada suave de cada página: o Next monta o template de novo a cada navegação, então a
 * animação (opacidade e 4 px de deslocamento, ~220 ms) roda na troca de tela sem tocar nas páginas.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
