'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { LicenseStatus, UploadOptions } from '@/lib/media-types';
import { uploadCopy } from '@/lib/upload-copy';

type Status = { kind: 'idle' | 'uploading' | 'connecting' | 'queued' | 'compress' | 'transcribe' | 'ready' | 'error'; progress?: number; position?: number; message?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readPreference(name: string) {
  const value = document.cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  try { return value ? decodeURIComponent(value) : ''; } catch { return ''; }
}
function savePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=15552000; Path=/; SameSite=Lax`;
}
async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  return body;
}

export function UploadStudio({ lang }: { lang: 'en' | 'uk' }) {
  const c = uploadCopy[lang];
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseError, setLicenseError] = useState('');
  const [licenseMessage, setLicenseMessage] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activatingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = ['uploading', 'connecting', 'queued', 'compress', 'transcribe', 'ready'].includes(status.kind);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = false;
      xhrRef.current?.abort();
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/options', { signal: controller.signal, cache: 'no-store' }).then(jsonResponse).then((data: UploadOptions) => {
      if (!data.models?.length || !data.languages?.length || !data.allowedExtensions?.length || !(data.maxFileSizeMb > 0)) throw new Error('Invalid options');
      if (controller.signal.aborted) return;
      setOptions(data);
      const savedLanguage = readPreference('pref_language');
      const savedModel = readPreference('pref_model');
      setLanguage(data.languages.some(item => item.value === savedLanguage) ? savedLanguage : data.languages[0].value);
      setModel(data.models.includes(savedModel) ? savedModel : data.models[0]);
    }).catch(() => { if (!controller.signal.aborted) setOptionsError(true); });
    fetch('/license/status', { signal: controller.signal, cache: 'no-store' }).then(jsonResponse).then(data => {
      if (!controller.signal.aborted) setLicense(data);
    }).catch(() => { if (!controller.signal.aborted) setLicenseError(c.licenseError); });
    return () => controller.abort();
  }, [attempt, c.licenseError]);

  async function refreshLicense() {
    try {
      const data = await fetch('/license/status', { cache: 'no-store' }).then(jsonResponse);
      if (mounted.current) { setLicense(data); setLicenseError(''); }
    } catch { if (mounted.current) setLicenseError(c.licenseError); }
  }

  function fail(message: string) {
    active.current = false;
    if (mounted.current) setStatus({ kind: 'error', message });
  }

  function choose(files: FileList | null) {
    if (active.current || !options) return;
    const next = files?.[0];
    const count = files?.length;
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    if (!next || count !== 1 || next.size === 0 || !options.allowedExtensions.some(ext => next.name.toLowerCase().endsWith(ext.toLowerCase()))) {
      setStatus({ kind: 'error', message: c.fileError }); return;
    }
    if (next.size > options.maxFileSizeMb * 1024 * 1024) {
      setStatus({ kind: 'error', message: c.sizeError }); return;
    }
    setFile(next); setStatus({ kind: 'idle' });
  }

  function connect(jobId: string) {
    let terminal = false;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?jobId=${encodeURIComponent(jobId)}`);
    socketRef.current = socket;
    socket.onmessage = event => {
      if (!mounted.current || terminal) return;
      let message;
      try { message = JSON.parse(event.data); } catch { terminal = true; fail(c.processingError); socket.close(); return; }
      if (!message || typeof message !== 'object') { terminal = true; fail(c.processingError); socket.close(); return; }
      if (message.status === 'queued') {
        setStatus({ kind: 'queued', position: message.position });
      } else if (message.status === 'processing') {
        setStatus({ kind: message.stage === 'compress' ? 'compress' : 'transcribe' });
      } else if (message.status === 'transcribed') {
        terminal = true;
        active.current = false;
        socket.close();
        if (message.sessionId !== jobId) { fail(c.processingError); return; }
        setStatus({ kind: 'ready' });
        // A full navigation happens only after transcription has created the session.
        // The legacy editor resolves file names from the server, not URL input.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- /editor is an Express document, not a Next.js route.
        location.assign(`/editor?sessionId=${encodeURIComponent(jobId)}&lang=${lang}`);
      } else if (message.status === 'error') {
        terminal = true;
        fail(typeof message.message === 'string' ? message.message : c.processingError);
        socket.close();
      }
    };
    socket.onerror = () => {
      if (terminal) return;
      terminal = true; fail(c.connectionError); socket.close();
    };
    socket.onclose = () => { if (!terminal && mounted.current) fail(c.connectionError); };
  }

  function upload(event: FormEvent) {
    event.preventDefault();
    if (active.current || !file || !options) return;
    active.current = true; // Guard before React commits state, including double clicks.
    setStatus({ kind: 'uploading', progress: 0 });
    savePreference('pref_language', language); savePreference('pref_model', model);
    const xhr = new XMLHttpRequest(); xhrRef.current = xhr;
    xhr.open('POST', '/upload');
    xhr.upload.onprogress = event => {
      if (mounted.current && event.lengthComputable) setStatus({ kind: 'uploading', progress: Math.round(event.loaded / event.total * 100) });
    };
    xhr.onload = () => {
      if (!mounted.current) return;
      void refreshLicense();
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { fail(c.uploadError); return; }
      if (xhr.status !== 200) {
        fail(xhr.status === 429 ? c.quotaError : xhr.status === 413 ? c.sizeError : typeof data.error === 'string' ? data.error : c.uploadError);
        return;
      }
      if (typeof data.jobId !== 'string' || !uuid.test(data.jobId)) { fail(c.uploadError); return; }
      setStatus({ kind: 'connecting' });
      try { connect(data.jobId); } catch { fail(c.connectionError); }
    };
    xhr.onerror = () => fail(c.networkError);
    xhr.onabort = () => { if (mounted.current) fail(c.networkError); };
    const body = new FormData(); body.append('video', file); body.append('language', language); body.append('model', model);
    try { xhr.send(body); } catch { fail(c.networkError); }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (activatingRef.current) return;
    if (!licenseKey.trim()) { setLicenseError(c.invalidKey); return; }
    activatingRef.current = true; setActivating(true); setLicenseError(''); setLicenseMessage('');
    try {
      await fetch('/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: licenseKey.trim() }) }).then(jsonResponse);
      if (!mounted.current) return;
      setLicenseKey(''); setLicenseMessage(c.activated);
      await refreshLicense();
    } catch (error) { if (mounted.current) setLicenseError(error instanceof Error ? error.message : c.networkError); }
    finally { activatingRef.current = false; if (mounted.current) setActivating(false); }
  }

  return <main id="content" className="upload-studio">
    <h1>{c.title}</h1><p className="intro">{c.intro}</p>
    <noscript>{c.noJs}</noscript>
    {!options && !optionsError && <p role="status">{c.loading}</p>}
    {optionsError && <div role="alert"><p>{c.optionsError}</p><button type="button" onClick={() => { setOptionsError(false); setAttempt(n => n + 1); }}>{c.retry}</button></div>}
    {options && <>
      <p>{c.limits}: {options.maxFileSizeMb} MB · {options.maxDurationSec / 60} {c.minutes}</p>
      <form onSubmit={upload} aria-label={c.upload}>
        <fieldset disabled={busy}>
          <div className="drop-area" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files); }}>
            <label htmlFor="video">{c.drop}</label>
            <input ref={inputRef} id="video" type="file" accept={options.allowedExtensions.join(',')} aria-label={c.file} onChange={event => choose(event.target.files)} />
            <p className="file-summary">{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : options.allowedExtensions.join(', ')}</p>
          </div>
          <div className="upload-fields">
            <div><label htmlFor="source-language">{c.language}</label><select id="source-language" value={language} onChange={event => { setLanguage(event.target.value); savePreference('pref_language', event.target.value); }}>{options.languages.map(item => <option key={item.value} value={item.value}>{item.label} ({item.code})</option>)}</select></div>
            <div><label htmlFor="whisper-model">{c.model}</label><select id="whisper-model" value={model} onChange={event => { setModel(event.target.value); savePreference('pref_model', event.target.value); }}>{options.models.map(item => <option key={item}>{item}</option>)}</select></div>
          </div>
          <p>{c.source}</p><p className="hint">{c.modelHint}</p>
          <button className="button" type="submit" disabled={!file || busy}>{c.upload}</button>
        </fieldset>
      </form>
      <p className="hint">{c.keepOpen}</p>
    </>}
    {status.kind !== 'idle' && <section className="upload-status" role={status.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      {status.kind === 'error' ? <p>{status.message}</p> : <>
        <p>{status.kind === 'queued' ? `${c.queued}: ${status.position}` : c[status.kind]}</p>
        {status.kind === 'uploading' && <><progress max="100" value={status.progress} aria-label={c.uploading} /><span> {status.progress}%</span></>}
      </>}
    </section>}
    <section className="license-panel" aria-label={c.license}>
      <h2>{c.license}</h2>
      {license && <p>{license.active ? c.active : `${c.remaining}: ${license.remaining} / ${license.dailyLimit}`}</p>}
      {licenseError && <p role="alert">{licenseError}</p>}
      {licenseMessage && <p role="status">{licenseMessage}</p>}
      {!license?.active && <form onSubmit={activate}>
        <label>{c.key}<input type="password" value={licenseKey} onChange={event => setLicenseKey(event.target.value)} autoComplete="off" disabled={activating} /></label>
        <button type="submit" disabled={activating}>{activating ? c.activating : c.activate}</button>
      </form>}
      {options?.tgContact && <p><a href={`https://t.me/${options.tgContact.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">{c.contact}</a></p>}
      <button type="button" onClick={() => void refreshLicense()}>{c.retry}</button>
    </section>
    <p className="hint">{c.notice} <Link href="/datenschutz">{c.privacy}</Link></p>
  </main>;
}
