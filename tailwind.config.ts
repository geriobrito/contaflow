import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#F5F5F7',
          surface: 'rgba(255, 255, 255, 0.75)',
          border: 'rgba(0, 0, 0, 0.08)',
          subtext: '#86868B',
          label: '#1D1D1F',
          blue: '#0071E3',
        },
      },
    },
  },
  plugins: [],
};

export default config;
