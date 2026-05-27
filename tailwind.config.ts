import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          DEFAULT: '#222222',
          soft: '#4a4a4a',
          muted: '#717171',
        },
        surface: {
          DEFAULT: '#ffffff',
          soft: '#fafafa',
          muted: '#f7f7f7',
        },
        line: {
          DEFAULT: '#ebebeb',
          soft: '#f3f3f3',
        },
        brand: {
          DEFAULT: '#AA8CF5',
          soft: '#f3eeff',
          deep: '#7c5ce8',
          50:  '#fbfaff',
          100: '#f3eeff',
          200: '#e3d8ff',
          300: '#cdb8fc',
          400: '#b89df8',
          500: '#AA8CF5',
          600: '#9573ee',
          700: '#7c5ce8',
          800: '#5e44c2',
          900: '#3f2d8a',
        },
        ok: { DEFAULT: '#10b981', soft: '#d1fae5' },
        warn: { DEFAULT: '#f59e0b', soft: '#fef3c7' },
        danger: { DEFAULT: '#ef4444', soft: '#fee2e2' },
      },
      borderRadius: {
        'squircle-sm': '10px',
        'squircle': '14px',
        'squircle-md': '18px',
        'squircle-lg': '22px',
        'squircle-xl': '28px',
      },
      boxShadow: {
        'card': '0 2px 8px -3px rgba(20, 20, 30, 0.06)',
        'card-hover': '0 6px 16px -8px rgba(20, 20, 30, 0.10)',
        'lift': '0 24px 48px -20px rgba(20, 20, 30, 0.18)',
        'brand': '0 8px 20px -8px rgba(170, 140, 245, 0.45)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-up': 'slide-up 250ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
