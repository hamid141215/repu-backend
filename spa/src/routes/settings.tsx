import { useSearchParams } from 'react-router';
import { useClientInfo } from '@/lib/queries';
import { SettingsView } from '@/components/settings/settings-view';
import { PageSpinner } from '@/components/page-spinner';

export default function SettingsPage() {
  const [sp] = useSearchParams();
  const { data, isLoading } = useClientInfo();
  if (isLoading) return <PageSpinner />;
  return <SettingsView initialClient={data ?? null} initialSection={sp.get('section') || 'organization'} />;
}
