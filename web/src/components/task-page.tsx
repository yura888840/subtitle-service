'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PersistentJob } from './persistent-job';
export function TaskPage({ jobId, lang }: { jobId: string; lang: 'en' | 'uk' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const prefix = lang === 'uk' ? '/uk' : '';
  return <main id="content" className="upload-studio"><h1>{lang === 'uk' ? 'Обробка відео' : 'Video processing'}</h1>
    {error ? <p role="alert">{error}</p> : <PersistentJob jobId={jobId} lang={lang} onTerminal={job => {
      if (job.status === 'transcribed' && job.sessionId === jobId) router.replace(`${prefix}/editor?sessionId=${encodeURIComponent(jobId)}`);
      else setError(job.message || (lang === 'uk' ? 'Завдання скасовано.' : 'Job cancelled.'));
    }} />}
    <Link href={`${prefix}/studio`}>{lang === 'uk' ? 'Завантажити відео' : 'Upload a video'}</Link>
  </main>;
}
