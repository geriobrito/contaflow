import type { Metadata } from 'next';
import { Geist, Geist_Mono, Newsreader } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ClientProvider } from '@/contexts/ClientContext';
import { AppShell } from '@/components/layout/AppShell';

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

export const metadata: Metadata = {
  title: 'ContaFlow - Automação Contábil & Conciliação Inteligente de OFX',
  description:
    'Software contábil interno com leitura automática de extratos bancários OFX, conciliação contábil com aprendizado contínuo e geração de DRE.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#F9F9F8] dark:bg-stone-950 text-stone-900 dark:text-stone-100">
        <AuthProvider>
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
