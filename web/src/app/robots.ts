import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/metadata';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/task', '/uk/task', '/jobs/', '/studio', '/uk/studio', '/editor', '/uk/editor', '/sessions/', '/videos/', '/outputs/', '/srt/', '/api/', '/health', '/license', '/upload', '/apply', '/ws'] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
