'use client';
import { useEffect, useRef, useState } from 'react';
export type JobSnapshot = { status: string; stage?: string; position?: number; sessionId?: string; outputFile?: string; message?: string };
export function PersistentJob({ jobId, lang, onTerminal }: { jobId: string; lang: 'en' | 'uk'; onTerminal: (job: JobSnapshot) => void }) {
  const callback = useRef(onTerminal);
  useEffect(() => { callback.current = onTerminal; }, [onTerminal]);
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const uk = lang === 'uk';
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let terminal = false;
      try {
        const response = await fetch(`/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) { terminal = true; callback.current({ status: 'error', message: uk ? 'Завдання не знайдено або термін зберігання минув.' : 'Job not found or expired.' }); return; }
        if (!response.ok) throw new Error();
        const data: JobSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(data); setError('');
        terminal = ['transcribed', 'done', 'error', 'cancelled'].includes(data.status);
        if (terminal) callback.current(data);
      } catch { if (!controller.signal.aborted) setError(uk ? 'Немає зв’язку. Повторюємо запит…' : 'Connection unavailable. Retrying…'); }
      finally { if (!terminal && !controller.signal.aborted) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, uk]);
  async function cancel() {
    setCancelling(true);
    try {
      const response = await fetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error();
    } catch { setError(uk ? 'Не вдалося скасувати. Спробуйте ще раз.' : 'Could not cancel. Please try again.'); setCancelling(false); }
  }
  const label = snapshot?.status === 'queued' ? `${uk ? 'Позиція в черзі' : 'Position in queue'}: ${snapshot.position}` : snapshot?.stage === 'burn' ? (uk ? 'Вшиваємо субтитри…' : 'Burning subtitles…') : (uk ? 'Обробка відео…' : 'Processing video…');
  return <section className="upload-status"><p role="status">{error || label}</p><p>{uk ? 'Можна оновити або закрити сторінку — завдання збережено.' : 'You can refresh or close this page — the job is saved.'}</p><button disabled={cancelling} onClick={() => void cancel()}>{cancelling ? (uk ? 'Скасовуємо…' : 'Cancelling…') : (uk ? 'Скасувати завдання' : 'Cancel job')}</button></section>;
}
