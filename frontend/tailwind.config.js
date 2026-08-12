/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-bg': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'bg-card': 'rgb(var(--color-bg-card) / <alpha-value>)',
        'bg-muted': 'rgb(var(--color-bg-muted) / <alpha-value>)',
        'bg-input': 'rgb(var(--color-bg-input) / <alpha-value>)',
        'border-default': 'rgb(var(--color-border-default) / <alpha-value>)',
        'border-strong': 'rgb(var(--color-border-strong) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
        'text-code': 'rgb(var(--color-text-code) / <alpha-value>)',
        'surface-code': 'rgb(var(--color-surface-code) / <alpha-value>)',
        'accent-primary': 'rgb(var(--color-accent-primary) / <alpha-value>)',
        'accent-secondary': 'rgb(var(--color-accent-secondary) / <alpha-value>)',
        'accent-success': 'rgb(var(--color-accent-success) / <alpha-value>)',
        'accent-warning': 'rgb(var(--color-accent-warning) / <alpha-value>)',
        'accent-danger': 'rgb(var(--color-accent-danger) / <alpha-value>)',
        'background': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'foreground': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'card': 'rgb(var(--color-bg-card) / <alpha-value>)',
        'card-foreground': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'border': 'rgb(var(--color-border-default) / <alpha-value>)',
        'input': 'rgb(var(--color-bg-input) / <alpha-value>)',
        'input-foreground': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'muted': 'rgb(var(--color-bg-muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--color-text-muted) / <alpha-value>)',
        'accent': 'rgb(var(--color-accent-primary) / <alpha-value>)',
        'accent-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'primary': 'rgb(var(--color-accent-primary) / <alpha-value>)',
        'primary-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'secondary': 'rgb(var(--color-accent-secondary) / <alpha-value>)',
        'secondary-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'success': 'rgb(var(--color-accent-success) / <alpha-value>)',
        'success-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'warning': 'rgb(var(--color-accent-warning) / <alpha-value>)',
        'warning-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
        'destructive': 'rgb(var(--color-accent-danger) / <alpha-value>)',
        'destructive-foreground': 'rgb(var(--color-bg-bg) / <alpha-value>)',
      },
      keyframes: {
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translate(-50%, -10px)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0)' },
        }
      },
      animation: {
        'fade-in-down': 'fade-in-down 0.3s ease-out',
      }
    },
  },
  plugins: [],
}