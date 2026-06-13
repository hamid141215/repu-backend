import { Navigate, useLocation } from 'react-router';
import { getApiKey } from '@/lib/auth';

/** Wraps protected routes. Without an api key in localStorage → /login. */
export function Protected({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!getApiKey()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
