import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '../lib/api';
import type { LoginResponse, Me } from '../lib/types';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<Me | null>;
  clear: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const clear = useCallback(() => { setCsrfToken(null); setMe(null); }, []);
  const refresh = useCallback(async () => {
    try {
      const value = await api<Me>('/auth/me');
      setCsrfToken(value.csrfToken);
      setMe(value);
      return value;
    } catch {
      setCsrfToken(null);
      setMe(null);
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const unauthorized = () => clear();
    window.addEventListener('devrelay:unauthorized', unauthorized);
    return () => window.removeEventListener('devrelay:unauthorized', unauthorized);
  }, [refresh, clear]);
  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    const result = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password,
      ...(mfaCode ? { mfaCode } : {}) } });
    setCsrfToken(result.csrfToken);
    const value = await refresh();
    if (!value) throw new Error('Signed in, but the session could not be loaded. Try again.');
    return result;
  }, [refresh]);
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* the local session is cleared regardless */ }
    clear();
  }, [clear]);
  const value = useMemo(() => ({ me, loading, login, logout, refresh, clear }), [me, loading, login, logout, refresh, clear]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
