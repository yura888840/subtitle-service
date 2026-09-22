import { Marketing, copy } from '@/components/marketing';
import { pageMetadata } from '@/lib/metadata';
export function generateMetadata() {
  const c = copy.en;
  return pageMetadata(c.seoTitle, c.seoIntro, '/seo', 'en');
}
export default function Page() { return <Marketing lang="en" seo={true} />; }
