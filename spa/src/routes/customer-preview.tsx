import { useClientInfo, useBranches } from '@/lib/queries';
import { CustomerPreviewView } from '@/components/customer-preview/customer-preview-view';
import { PageSpinner } from '@/components/page-spinner';

export default function CustomerPreviewPage() {
  const clientQ = useClientInfo();
  const branchesQ = useBranches();
  if (clientQ.isLoading || branchesQ.isLoading) return <PageSpinner />;
  return (
    <CustomerPreviewView
      client={clientQ.data ?? null}
      branches={branchesQ.data ?? { items: [] }}
    />
  );
}
