'use client';
import { useEffect, useState } from 'react';
type Version = { version: number; renders: { jobId: string; status: string; outputFile: string | null }[] };
export function VersionHistory({ sessionId, refresh, lang }: { sessionId: string; refresh: string; lang: 'en' | 'uk' }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/sessions/${encodeURIComponent(sessionId)}/versions`, { cache: 'no-store', signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (!controller.signal.aborted) { setVersions(data); setError(false); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [sessionId, refresh, attempt]);
  return <section aria-label={lang === 'uk' ? 'Історія версій' : 'Version history'}><h2>{lang === 'uk' ? 'Історія версій' : 'Version history'}</h2>
    {error && <button onClick={() => setAttempt(n => n + 1)}>{lang === 'uk' ? 'Повторити завантаження історії' : 'Retry loading history'}</button>}
    <ul>{versions.map(version => <li key={version.version}>#{version.version}: <a href={`/sessions/${encodeURIComponent(sessionId)}/versions/${version.version}`} download={`subtitles-v${version.version}.srt`}>SRT</a>
      {version.renders.filter(render => render.status === 'done' && render.outputFile).map(render => <span key={render.jobId}> · <a href={`/outputs/${encodeURIComponent(render.outputFile!)}`} download>{lang === 'uk' ? 'Відео' : 'Video'}</a></span>)}
    </li>)}</ul>
  </section>;
}
