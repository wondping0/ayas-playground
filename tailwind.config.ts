import type { Config } from 'tailwindcss'

/**
 * Tokens follow the design direction: a cool-paper page with the *goods*
 * rendered as sealed ink blocks, and brass reserved for the seal and the price.
 * Every colour is a CSS variable so the dark theme swaps values, not classes.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        seal: 'rgb(var(--seal) / <alpha-value>)',
        verify: 'rgb(var(--verify) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-source-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.18em' }],
        plate: ['0.6875rem', { lineHeight: '1.35', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        // Near-square: this is instrumentation, not a consumer app.
        DEFAULT: '2px',
        sm: '1px',
        md: '3px',
      },
      maxWidth: {
        shelf: '76rem',
        prose: '38rem',
      },
      keyframes: {
        settle: {
          '0%': { opacity: '0.25', filter: 'blur(1.5px)' },
          '100%': { opacity: '1', filter: 'blur(0)' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        settle: 'settle 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        rise: 'rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      },
    },
  },
  plugins: [],
}

export default config
