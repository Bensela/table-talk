import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const THEME_KEY = 'sa-theme';
const DEFAULT_THEME = 'midnight';

const themeColors = {
  light: {
    '--color-bg-bg': '255 255 255',
    '--color-bg-card': '248 250 252',
    '--color-border-default': '226 232 240',
    '--color-text-primary': '15 23 42',
    '--color-text-secondary': '51 65 85',
    '--color-text-muted': '100 116 139',
    '--color-accent-primary': '79 70 229',
    '--color-accent-secondary': '14 165 233',
    '--color-accent-success': '34 197 94',
    '--color-accent-warning': '234 179 8',
    '--color-accent-danger': '239 68 68',
  },
  dark: {
    '--color-bg-bg': '2 6 23',
    '--color-bg-card': '15 23 42',
    '--color-border-default': '30 41 59',
    '--color-text-primary': '241 245 249',
    '--color-text-secondary': '203 213 225',
    '--color-text-muted': '148 163 184',
    '--color-accent-primary': '99 102 241',
    '--color-accent-secondary': '56 189 248',
    '--color-accent-success': '74 222 128',
    '--color-accent-warning': '250 204 21',
    '--color-accent-danger': '248 113 113',
  },
  midnight: {
    '--color-bg-bg': '9 9 17',
    '--color-bg-card': '24 24 40',
    '--color-border-default': '49 46 129',
    '--color-text-primary': '241 245 249',
    '--color-text-secondary': '203 213 225',
    '--color-text-muted': '148 163 184',
    '--color-accent-primary': '129 140 248',
    '--color-accent-secondary': '125 211 252',
    '--color-accent-success': '74 222 128',
    '--color-accent-warning': '250 204 21',
    '--color-accent-danger': '252 165 165',
  },
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved || DEFAULT_THEME;
    } catch (_err) {
      void _err;
      return DEFAULT_THEME;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (_err) {
      void _err;
    }

    const root = document.documentElement;
    const colors = themeColors[mode] || themeColors[DEFAULT_THEME];
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.classList.remove('theme-light', 'theme-dark', 'theme-midnight');
    root.classList.add(`theme-${mode}`);

    if (mode === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [mode]);

  const value = {
    mode,
    setMode,
    toggleMode: () => {
      const modes = ['light', 'dark', 'midnight'];
      const idx = modes.indexOf(mode);
      setMode(modes[(idx + 1) % modes.length]);
    },
  };

  return (
    <ThemeContext.Provider value={value}>
      <div className={`theme-${mode} transition-colors duration-300 ease-in-out min-h-screen`}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
