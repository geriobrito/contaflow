import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono, Newsreader } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ClientProvider } from '@/contexts/ClientContext';
import { AppShell } from '@/components/layout/AppShell';
import { PageTitle } from '@/components/layout/PageTitle';
import { SessionTimeout } from '@/components/layout/SessionTimeout';
import { THEME_SCRIPT } from '@/lib/theme';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
});

// Sem `title` aqui: o título da aba vem do <PageTitle />, com o nome de cada tela.
export const metadata: Metadata = {
  applicationName: 'ContaFlow',
  description:
    'Software contábil interno com leitura automática de extratos bancários OFX, conciliação contábil com aprendizado contínuo e geração de DRE.',
  // Ferramenta interna do escritório: nenhuma tela entra em buscadores.
  robots: { index: false, follow: false },
};

/** Cor da moldura do navegador (e da janela do aplicativo instalado) acompanhando o tema. */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F4EE' },
    { media: '(prefers-color-scheme: dark)', color: '#131211' },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nonce da CSP desta requisição (src/proxy.ts). Ler os cabeçalhos torna todas as páginas
  // dinâmicas, o que o nonce exige: o Next aplica o mesmo nonce nos scripts dele.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
      // O script do tema grava `data-theme` antes da hidratação; a diferença no <html> é esperada.
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <PageTitle />
      </head>
      <body className="min-h-full bg-canvas text-stone-900 dark:text-stone-100">
        <AuthProvider>
          <SessionTimeout />
          <ProtectedRoute>
            <ClientProvider>
              <AppShell>{children}</AppShell>
            </ClientProvider>
          </ProtectedRoute>
        </AuthProvider>
      </body>
    </html>
  );
}
