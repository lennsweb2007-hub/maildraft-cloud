/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * Warme Neutraltoene statt kuehlem Grau. Die Skala folgt der
         * Tailwind-Konvention: 50 ist am hellsten, 950 am dunkelsten.
         *
         * Vier Werte sind gesetzt und sollten nicht wandern, weil das
         * Erscheinungsbild an ihnen haengt:
         *   50  Seitenhintergrund
         *   100 Seitenleiste, ruhige Flaechen
         *   200 saemtliche Linien und Rahmen
         *   950 Fliesstext
         */
        ink: {
          50: '#faf8f6',
          100: '#f4f1ed',
          200: '#e8e4e0',
          300: '#d8d2cc',
          400: '#b3aba3',
          500: '#8f8781',
          600: '#6f6862',
          700: '#574f4a',
          800: '#423b37',
          900: '#332d2a',
          950: '#2a2622',
        },

        /*
         * Terrakotta - die einzige Farbe, die im Layout laut werden darf.
         * 500 traegt Knoepfe und Hervorhebungen, 600 ist deren Hover-Zustand.
         * Ab 700 dunkel genug fuer Text auf hellem Grund.
         */
        brand: {
          50: '#fdf5f2',
          100: '#fae8e1',
          200: '#f4cdbf',
          300: '#ecab95',
          400: '#e28f73',
          500: '#d97757',
          600: '#c85f44',
          700: '#a84a34',
          800: '#8a3d2c',
          900: '#723427',
        },

        /*
         * Salbei - die zweite Stimme. Traegt Beschriftungen und Symbole, also
         * alles, was da sein muss, ohne sich vorzudraengen. 400 ist der
         * gesetzte Wert; fuer Text auf Weiss reicht sein Kontrast nur bei
         * Grossbuchstaben mit Sperrung, sonst 600 nehmen.
         */
        sage: {
          50: '#f2f6f4',
          100: '#e2ebe7',
          200: '#c6d8d0',
          300: '#a5c0b5',
          400: '#8ba89e',
          500: '#6f8f84',
          600: '#58736a',
          700: '#485d56',
          800: '#3c4c47',
          900: '#333f3b',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        /* Bewusst flach: Tiefe entsteht hier ueber Flaeche und Linie, nicht
           ueber harte Schatten. */
        panel: '0 2px 8px rgba(42, 38, 34, 0.04)',
        'panel-hover': '0 4px 14px rgba(42, 38, 34, 0.07)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(1rem)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
