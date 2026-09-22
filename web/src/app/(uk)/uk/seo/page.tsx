import { Marketing, copy } from '@/components/marketing';
import { pageMetadata } from '@/lib/metadata';
export function generateMetadata() {
  const c = copy.uk;
  return pageMetadata(c.seoTitle, c.seoIntro, '/uk/seo', 'uk');
}
export default function Page() { return <Marketing lang="uk" seo={true} />; }
