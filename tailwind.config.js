/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { tablet: '768px', desktop: '1200px' },
    extend: {
      colors: { canvas: '#f5f7f2', surface: '#ffffff', ink: '#18251b', muted: '#526055', brand: '#276338', line: '#d5ded4' },
      fontFamily: { sans: ['system-ui', 'sans-serif'] },
      spacing: { page: '1.5rem' },
      borderRadius: { panel: '1rem' },
    },
  },
};
