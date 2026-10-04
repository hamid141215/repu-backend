import { useBranches } from '@/lib/queries';
import { CampaignsView } from '@/components/campaigns/campaigns-view';
import { PageSpinner } from '@/components/page-spinner';

export default function CampaignsPage() {
  const branchesQ = useBranches();
  if (branchesQ.isLoading) return <PageSpinner />;
  return (
    <CampaignsView
      initialBranches={branchesQ.data ?? { items: [] }}
    />
  );
}
