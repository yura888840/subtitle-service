import { TaskPage } from '@/components/task-page';
export const metadata = { title: 'Processing — SUBTITLED', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  const { jobId } = await searchParams;
  return <TaskPage jobId={typeof jobId === 'string' ? jobId : ''} lang="en" />;
}
