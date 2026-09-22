import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/metadata';
export const dynamic = 'force-dynamic';
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  // Never publish localhost or an invented production domain.
  if (!origin) return [];
  return ['/', '/uk', '/seo', '/uk/seo', '/impressum', '/datenschutz'].map(path => ({ url: `${origin}${path}` }));
}
