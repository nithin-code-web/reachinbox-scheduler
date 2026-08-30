/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14221d',
        muted: '#708078',
        line: '#e7ece9',
        mint: '#20b26b',
        'mint-dark': '#168c53',
        'mint-soft': '#e9f8f0',
      },
      boxShadow: {
        panel: '0 18px 50px rgba(20, 34, 29, 0.08)',
      },
    },
  },
  plugins: [],
};
