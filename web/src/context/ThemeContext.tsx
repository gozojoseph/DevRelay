import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeValue { theme: Theme; setTheme: (theme: Theme) => void; toggle: () => void }
const ThemeContext = createContext<ThemeValue | null>(null);

function initialTheme(): Theme {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark';
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('devrelay-theme', theme); } catch { /* storage may be unavailable */ }
  }, [theme]);
  const value = useMemo<ThemeValue>(() => ({ theme, setTheme,
    toggle: () => setTheme(current => current === 'dark' ? 'light' : 'dark') }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
