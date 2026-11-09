import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loading } from './ui';

export function RequireAuth({ role }: { role: 'developer' | 'admin' }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loading label="Checking your session…" /></div>;
  if (!me) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (role === 'admin') {
    if (me.user.role !== 'admin') return <Navigate to="/app" replace />;
    if (!me.user.mfaEnabled) return <Navigate to="/admin/mfa" replace />;
  }
  if (role === 'developer' && me.user.role !== 'developer') return <Navigate to="/admin" replace />;
  return <Outlet />;
}

export function RequireMfaSetup() {
  const { me, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loading label="Checking your session…" /></div>;
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.role !== 'admin') return <Navigate to="/app" replace />;
  if (me.user.mfaEnabled) return <Navigate to="/admin" replace />;
  return <Outlet />;
}
