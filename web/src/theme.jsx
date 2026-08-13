import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Persisted in a cookie, never localStorage — localStorage is unavailable in some
// embedding contexts and throws on access rather than returning null.
const COOKIE = 'pulse-theme';
const YEAR_SECONDS = 31536000;

function readCookie() {
  const match = document.cookie.match(/(?:^|;\s*)pulse-theme=(light|dark)(?:;|$)/);
  return match ? match[1] : null;
}

function writeCookie(theme) {
  document.cookie = `${COOKIE}=${theme}; path=/; max-age=${YEAR_SECONDS}; SameSite=Lax`;
}

const systemTheme = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const ThemeContext = createContext({ theme: 'light', toggle: () => {}, chosen: false });

export function ThemeProvider({ children }) {
  const [state, setState] = useState(() => {
    const stored = readCookie();
    return { theme: stored ?? systemTheme(), chosen: stored !== null };
  });

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // Until the reader picks one, follow the system. After they pick, stop following.
  useEffect(() => {
    if (state.chosen || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setState({ theme: event.matches ? 'dark' : 'light', chosen: false });
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [state.chosen]);

  const toggle = useCallback(() => {
    setState((prev) => {
      const theme = prev.theme === 'dark' ? 'light' : 'dark';
      writeCookie(theme);
      return { theme, chosen: true };
    });
  }, []);

  return <ThemeContext.Provider value={{ ...state, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
