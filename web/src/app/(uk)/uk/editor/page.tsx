import { SubtitleEditor } from '@/components/subtitle-editor';
export const metadata = { title: 'Редагування субтитрів — SUBTITLED', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ sessionId?: string }> }) {
  const params = await searchParams;
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  return <SubtitleEditor key={sessionId} sessionId={sessionId} lang="uk" />;
}
