import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Clean white-and-slate palette — no dark theme.
        brand: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5bdfb',
          400: '#8098f9',
          500: '#6172f3',  // primary
          600: '#444ce7',
          700: '#3538cd',
          800: '#2d31a6',
          900: '#2d3282',
        },
        success: {
          50:  '#ecfdf3',
          200: '#a9efc5',
          500: '#12b76a',
          600: '#039855',
        },
        warning: {
          50:  '#fffaeb',
          200: '#fedf89',
          500: '#f79009',
          600: '#dc6803',
        },
        danger: {
          50:  '#fef3f2',
          200: '#fecdca',
          500: '#f04438',
          600: '#d92d20',
        },
        slate: {
          25: '#fcfcfd',
          50: '#f8f9fc',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
      },
    },
  },
  plugins: [],
};

export default config;
