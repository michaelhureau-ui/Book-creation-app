/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1c1a17', soft: '#4a4640', faint: '#8b857c' },
        paper: { DEFAULT: '#fbf9f5', raised: '#ffffff', sunk: '#f3efe7' },
        rule: { DEFAULT: '#e6e0d4', strong: '#d3cabb' },
        accent: { DEFAULT: '#8a4b2a', soft: '#f0e3d9', deep: '#6d3a1f' },
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,26,23,.06), 0 8px 24px -12px rgba(28,26,23,.18)',
        book: '0 2px 4px rgba(28,26,23,.10), 0 18px 40px -18px rgba(28,26,23,.45)',
      },
    },
  },
  plugins: [],
}
