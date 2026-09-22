import type { Metadata } from "next";

export function siteOrigin(): string | undefined {
  if (!process.env.SITE_URL) return undefined;
  const url = new URL(process.env.SITE_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_URL must be an http(s) origin without a path or credentials');
  }
  return url.origin;
}

export function pageMetadata(title: string, description: string, path: string, lang: 'en' | 'uk' | 'de'): Metadata {
  const origin = siteOrigin();
  const canonical = origin ? `${origin}${path}` : undefined;
  const english = path.replace(/^\/uk(?=\/|$)/, '') || '/';
  const ukrainian = english === '/' ? '/uk' : `/uk${english}`;
  return {
    title: `${title} — SUBTITLED`, description,
    robots: { index: true, follow: true },
    alternates: origin ? {
      canonical,
      ...(lang !== 'de' ? { languages: { en: `${origin}${english}`, uk: `${origin}${ukrainian}`, 'x-default': `${origin}${english}` } } : {}),
    } : undefined,
    openGraph: { title, description, url: canonical, type: 'website', siteName: 'SUBTITLED', locale: { en: 'en_US', uk: 'uk_UA', de: 'de_DE' }[lang] },
  };
}
