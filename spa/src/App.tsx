import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import { Protected } from './routes/_protected';
import { AppLayout } from './routes/_app-layout';
import LoginPage          from './routes/login';
import OverviewPage       from './routes/overview';
import ReviewsPage        from './routes/reviews';
import ComplaintsPage     from './routes/complaints';
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
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route path="/"                  element={<OverviewPage />} />
            <Route path="/reviews"           element={<ReviewsPage />} />
            <Route path="/complaints"        element={<ComplaintsPage />} />
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
