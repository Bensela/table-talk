import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';

const modes = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'midnight', icon: Monitor, label: 'Midnight' },
];

export function ThemeToggle({ className = '' }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className={`inline-flex items-center rounded-full p-1 bg-bg-card border border-default ${className}`}
      role="group"
      aria-label="Theme selector"
    >
      {modes.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-label={`Switch to ${m.label} theme`}
            aria-pressed={isActive}
            title={m.label}
            className={`
              relative flex items-center justify-center w-9 h-9 rounded-full
              transition-all duration-200 ease-out
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-bg
              ${isActive
                ? 'bg-accent-primary text-white shadow-md shadow-accent-primary/30'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-bg'
              }
            `}
          >
            <Icon className="w-4 h-4" strokeWidth={isActive ? 2.25 : 2} />
            {isActive && (
              <span className="sr-only">Active theme: {m.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
