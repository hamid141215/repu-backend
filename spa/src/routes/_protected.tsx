import { Navigate, useLocation } from 'react-router';
import { isAuthenticated } from '@/lib/auth';

/** Wraps protected routes. Without auth (api_key or session) → /login. */
export function Protected({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
