import { useBranches } from '@/lib/queries';
import { NfcView } from '@/components/nfc/nfc-view';
import { PageSpinner } from '@/components/page-spinner';

export default function NfcPage() {
  const { data, isLoading } = useBranches();
  if (isLoading) return <PageSpinner />;
  return <NfcView initialBranches={data ?? { items: [] }} />;
}
