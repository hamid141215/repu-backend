import { useBranches, useActivity } from '@/lib/queries';
import { CampaignsView } from '@/components/campaigns/campaigns-view';
import { PageSpinner } from '@/components/page-spinner';

export default function CampaignsPage() {
  const branchesQ = useBranches();
  const activityQ = useActivity(undefined, 8);
  if (branchesQ.isLoading) return <PageSpinner />;
  return (
    <CampaignsView
      initialBranches={branchesQ.data ?? { items: [] }}
      initialActivity={activityQ.data ?? { items: [] }}
    />
  );
}
