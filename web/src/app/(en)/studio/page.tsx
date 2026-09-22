import { redirect } from 'next/navigation';
import { UploadStudio } from '@/components/upload-studio';
export const metadata = { title: 'Create English subtitles — SUBTITLED', robots: { index: false, follow: true } };
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  if ((await searchParams).lang === 'uk') redirect('/uk/studio');
  return <UploadStudio lang="en" />;
}
