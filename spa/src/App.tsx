import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import { Protected } from './routes/_protected';
import { AppLayout } from './routes/_app-layout';
import LoginPage          from './routes/login';
import ForgotPasswordPage from './routes/forgot-password';
import ResetPasswordPage  from './routes/reset-password';
import OverviewPage       from './routes/overview';
import SignalsPage        from './routes/signals';
import BranchesPage       from './routes/branches';
import AnalyticsPage      from './routes/analytics';
import ReportsPage        from './routes/reports';
import NfcPage            from './routes/nfc';
import CampaignsPage      from './routes/campaigns';
import CustomerPreviewPage from './routes/customer-preview';
import SettingsPage       from './routes/settings';
import TeamPage           from './routes/team';

export function App() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }
    }
  }));

  return (
    <QueryClientProvider client={client}>
      <HashRouter>
        <Routes>
          <Route path="/login"            element={<LoginPage />} />
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route path="/"                  element={<OverviewPage />} />
            <Route path="/signals"            element={<SignalsPage />} />
            <Route path="/reviews"            element={<LegacySignalsRedirect type="reviews" />} />
            <Route path="/complaints"         element={<LegacySignalsRedirect type="complaints" />} />
            <Route path="/branches"          element={<BranchesPage />} />
            <Route path="/analytics"         element={<AnalyticsPage />} />
            <Route path="/reports"           element={<ReportsPage />} />
            <Route path="/nfc"               element={<NfcPage />} />
            <Route path="/campaigns"         element={<CampaignsPage />} />
            <Route path="/customer-preview"  element={<CustomerPreviewPage />} />
            <Route path="/settings"          element={<SettingsPage />} />
            <Route path="/team"              element={<TeamPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}

function LegacySignalsRedirect({ type }: { type: 'reviews' | 'complaints' }) {
  const { search } = useLocation();
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  target.set('type', type);
  for (const key of ['q', 'branch', 'source', 'status', 'page']) {
    const value = source.get(key);
    if (value) target.set(key, value);
  }
  if (type === 'reviews') {
    const tab = source.get('tab');
    if (tab === '5') target.set('rating', '5');
    if (tab === 'low') target.set('rating', 'low');
    if (tab === 'nfc') target.set('source', 'nfc');
    if (tab === 'internal') target.set('source', 'dashboard');
  }
  return <Navigate to={`/signals?${target.toString()}`} replace />;
}
