'use client';

import Link from 'next/link';
import { VersionHistory } from './version-history';
import { PersistentJob } from './persistent-job';
import { useEffect, useRef, useState } from 'react';
import { editorCopy } from '@/lib/editor-copy';
import { parseSrt, serializeSrt, type Cue } from '@/lib/srt';

type Status = { kind: 'idle' | 'connecting' | 'queued' | 'burn' | 'done' | 'error'; message?: string; position?: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const basename = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\\/]/.test(value) && value !== '.' && value !== '..';

export function SubtitleEditor({ sessionId, lang }: { sessionId: string; lang: 'en' | 'uk' }) {
  const c = editorCopy[lang];
  const [durable, setDurable] = useState(false);
  const [versioned, setVersioned] = useState(false);
  const [renderJob, setRenderJob] = useState('');
  const [cues, setCues] = useState<Cue[]>([]);
  const [video, setVideo] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [output, setOutput] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [activeCue, setActiveCue] = useState(-1);
  const [support, setSupport] = useState<{ url: string; name: string } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const running = useRef(false);
  const busy = !!renderJob || ['connecting', 'queued', 'burn'].includes(status.kind);
  let srt = '';
  try { srt = serializeSrt(cues); } catch { /* Validation is displayed beside the controls. */ }

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    async function load() {
      try {
        if (!uuid.test(sessionId)) throw new Error('Invalid session');
        const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Session unavailable');
        const data = await response.json();
        if (data.sessionId !== sessionId || !basename(data.videoFile)) throw new Error('Invalid session response');
        const subtitles = await fetch(`/srt/${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: controller.signal });
        if (!subtitles.ok) throw new Error('Subtitles unavailable');
        const parsed = parseSrt(await subtitles.text());
        if (controller.signal.aborted) return;
        setDurable(!!data.durable); setVersioned(!!data.versioned);
        if (data.renderJobId) { setRenderJob(data.renderJobId); running.current = true; }
        setCues(parsed); setVideo(data.videoFile); setLoadError(false);
      } catch { if (!controller.signal.aborted) setLoadError(true); }
    }
    void load();
    fetch('/options', { signal: controller.signal }).then(r => r.json()).then(data => {
      if (!controller.signal.aborted && typeof data.support?.url === 'string' && /^https?:\/\//i.test(data.support.url)) {
        setSupport({ url: data.support.url, name: typeof data.support.name === 'string' ? data.support.name : c.support });
      }
    }).catch(() => {});
    return () => { alive.current = false; controller.abort(); request.current?.abort(); socket.current?.close(); running.current = false; };
  }, [sessionId, attempt, c.support]);

  useEffect(() => {
    // Follow playback inside the cue list, without moving the whole page or an active text field.
    const row = rows.current[activeCue];
    const list = row?.parentElement;
    if (!row || !list || list.contains(document.activeElement)) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top;
  }, [activeCue]);

  async function apply() {
    if (running.current || !srt) return;
    running.current = true; setOutput(''); setStatus({ kind: 'connecting' });
    const controller = new AbortController(); request.current = controller;
    const fail = (message: string) => {
      if (!alive.current) return;
      running.current = false; setStatus({ kind: 'error', message });
    };
    try {
      const response = await fetch('/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: sessionId, srt }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : c.failed);
      if (!uuid.test(data.jobId)) throw new Error(c.failed);
      if (!alive.current || controller.signal.aborted) return;
      if (data.durable) { setRenderJob(data.jobId); return; }
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?jobId=${encodeURIComponent(data.jobId)}`);
      socket.current = ws;
      let finished = false;
      const end = (message?: string) => { finished = true; ws.close(); if (message) fail(message); };
      ws.onmessage = event => {
        if (!alive.current || finished) return;
        let message;
        try { message = JSON.parse(event.data); } catch { end(c.failed); return; }
        if (!message || typeof message !== 'object') { end(c.failed); return; }
        if (message.status === 'queued') setStatus({ kind: 'queued', position: message.position });
        else if (message.status === 'processing') setStatus({ kind: 'burn' });
        else if (message.status === 'error') end(typeof message.message === 'string' ? message.message : c.failed);
        else if (message.status === 'done') {
          if (!basename(message.outputFile)) { end(c.failed); return; }
          end(); running.current = false; setOutput(message.outputFile); setStatus({ kind: 'done' });
        }
      };
      ws.onerror = () => { if (!finished) end(c.disconnected); };
      ws.onclose = () => { if (!finished) { finished = true; fail(c.disconnected); } };
    } catch (error) { if (!controller.signal.aborted) fail(error instanceof Error ? error.message : c.failed); }
  }

  function downloadSrt() {
    if (!srt) return;
    const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'subtitles.srt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main id="content" className="upload-studio subtitle-editor">
    <h1>{c.title}</h1><p>{c.intro}</p><noscript>{c.noJs}</noscript>
    {!video && !loadError && <p role="status">{c.loading}</p>}
    {loadError && <section id="statusPanel" role="alert"><p>{c.loadError}</p><button onClick={() => setAttempt(n => n + 1)}>{c.retry}</button></section>}
    {video && <section id="editorView">
      <div className="editor-grid">
        <div><video ref={player} controls preload="metadata" src={`/videos/${encodeURIComponent(video)}`} onError={() => setPreviewError(true)} onTimeUpdate={event => setActiveCue(cues.findIndex(cue => event.currentTarget.currentTime >= cue.startSec && event.currentTarget.currentTime < cue.endSec))} />
          {previewError && <p className="hint">{c.previewError}</p>}
        </div>
        <div id="cueList" className="cue-list">{cues.map((cue, index) => <div key={index} ref={node => { rows.current[index] = node; }} className={`cue${activeCue === index ? ' active' : ''}`}>
          <button type="button" aria-label={`${c.seek} ${cue.start}`} onClick={() => { if (player.current) { player.current.currentTime = cue.startSec; setActiveCue(index); void player.current.play().catch(() => {}); } }}>{cue.start} → {cue.end}</button>
          <label htmlFor={`cue-${index}`}>{c.subtitle} {index + 1}</label>
          <textarea id={`cue-${index}`} rows={3} disabled={busy} value={cue.text} onChange={event => { setCues(current => current.map((item, i) => i === index ? { ...item, text: event.target.value } : item)); setOutput(''); setStatus({ kind: 'idle' }); }} />
        </div>)}</div>
      </div>
      {!srt && <p role="alert">{c.invalid}</p>}
      <p className="hint">{c.local}</p>
      <div className="editor-actions"><button id="applyBtn" className="button" disabled={busy || !srt} onClick={() => void apply()}>{output ? c.again : c.apply}</button>
        <button disabled={!srt} onClick={downloadSrt}>{c.srt}</button>
        {output && <a id="downloadVideoLink" className="button" href={`/outputs/${encodeURIComponent(output)}`} download>{c.video}</a>}
      </div>
      {renderJob && <PersistentJob jobId={renderJob} lang={lang} onTerminal={job => {
        setRenderJob(''); running.current = false;
        if (job.status === 'done' && basename(job.outputFile)) { setOutput(job.outputFile); setStatus({ kind: 'done' }); }
        else setStatus({ kind: 'error', message: job.message || c.failed });
      }} />}
      {!renderJob && status.kind !== 'idle' && <section className="upload-status" role={status.kind === 'error' ? 'alert' : 'status'}>{status.kind === 'error' ? status.message : status.kind === 'queued' ? `${c.queued}: ${status.position}` : c[status.kind]}</section>}
      <p className="hint">{durable ? (lang === 'uk' ? 'Обробка продовжується після закриття сторінки.' : 'Rendering continues after closing the page.') : c.keepOpen}</p>
      {versioned && <VersionHistory sessionId={sessionId} refresh={output} lang={lang} />}
      {output && support && <p>{c.support}: <a href={support.url} target="_blank" rel="noopener noreferrer">{support.name}</a></p>}
    </section>}
    <Link id="resetBtn" href={lang === 'uk' ? '/uk/studio' : '/studio'}>{c.reset}</Link>
  </main>;
}
