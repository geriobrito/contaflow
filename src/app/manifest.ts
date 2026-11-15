import type { MetadataRoute } from 'next';

/** Manifesto do aplicativo: permite instalar o ContaFlow como janela própria (Chrome/Edge › Instalar). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ContaFlow',
    short_name: 'ContaFlow',
    description: 'Conciliação de extratos, partidas dobradas e demonstrações contábeis do escritório.',
    lang: 'pt-BR',
    start_url: '/painel',
    display: 'standalone',
    background_color: '#F6F4EE',
    theme_color: '#F6F4EE',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
