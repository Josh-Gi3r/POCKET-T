/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0c0d0f',
          raised:  '#13151a',
          overlay: '#1a1d24',
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono', 'Fira Code',
          'SF Mono', 'Consolas', 'monospace',
        ],
      },
    },
  },
  plugins: [],
};
