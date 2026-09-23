import { redirect } from 'next/navigation';
import { SubtitleEditor } from '@/components/subtitle-editor';
export const metadata = { title: 'Edit subtitles — SUBTITLED', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ sessionId?: string; lang?: string }> }) {
  const params = await searchParams;
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  if (params.lang === 'uk') redirect(`/uk/editor?sessionId=${encodeURIComponent(sessionId)}`);
  return <SubtitleEditor key={sessionId} sessionId={sessionId} lang="en" />;
}
