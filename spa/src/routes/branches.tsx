import { useBranches } from '@/lib/queries';
import { BranchesView } from '@/components/branches/branches-view';
import { PageSpinner } from '@/components/page-spinner';

export default function BranchesPage() {
  const { data, isLoading } = useBranches();
  if (isLoading) return <PageSpinner />;
  return <BranchesView initialBranches={data ?? { items: [] }} />;
}
