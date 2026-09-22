import Link from "next/link";
import "@/app/globals.css";

export function SiteLayout({ children, lang }: { children: React.ReactNode; lang: 'en' | 'uk' | 'de' }) {
  const uk = lang === 'uk';
  return <html lang={lang}><body>
    <a className="skip-link" href="#content">{uk ? 'До вмісту' : lang === 'de' ? 'Zum Inhalt' : 'Skip to content'}</a>
    <header className="site-header">
      <Link className="brand" href={uk ? '/uk' : '/'}>SUBTITLED<span>.</span></Link>
      <nav aria-label={uk ? 'Головне меню' : 'Navigation'}>
        <Link href={uk ? '/uk/seo' : '/seo'}>{uk ? 'Про субтитри' : lang === 'de' ? 'Über Untertitel' : 'About subtitles'}</Link>
        <Link href="/">EN</Link><Link href="/uk">УКР</Link>
      </nav>
    </header>
    {children}
    <footer className="site-footer">
      <span>{uk ? 'Створено з любов’ю до України' : 'Made with love to Ukraine'}</span>
      <nav aria-label="Legal"><Link href="/impressum">Impressum</Link><Link href="/datenschutz">Datenschutz</Link></nav>
    </footer>
  </body></html>;
}
