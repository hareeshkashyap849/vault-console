/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Figures are rendered in a tabular variant on purpose: this console shows numbers
       * that change while the reader watches them, and a proportional font makes them
       * jump horizontally on every update.
       */
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
