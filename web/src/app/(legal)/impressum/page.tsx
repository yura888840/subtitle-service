/* Existing operator-provided legal text migrated to JSX; not a legal review. */
import Link from 'next/link';
import { getLegal } from '@/lib/public-config';
import { pageMetadata } from '@/lib/metadata';
export function generateMetadata() { return pageMetadata('Impressum', 'Impressum für den Video-Untertitel-Dienst SUBTITLED.', '/impressum', 'de'); }
export default async function Page() {
  const config = await getLegal();
  const { legal } = config;
  return <main id="content" className="legal-doc">
  <Link href="/" className="backlink">← Zurück zum Dienst</Link>

  <div className="eyebrow">Rechtliche Angaben</div>
  <h1>Impressum</h1>

  <h2>Angaben gemäß § 5 DDG</h2>
  <address className="addr" id="providerBlock">
    <span className="k">Diensteanbieter</span>
    <span id="legalName">{legal.name}</span>
    <span className="k">Anschrift</span>
    <span id="legalStreet">{legal.street}</span><br />
    <span id="legalZipCity">{legal.zipCity}</span><br />
    <span id="legalCountry">{legal.country}</span>
  </address>

  <h2>Kontakt</h2>
  <address className="addr">
    <span className="k">E-Mail</span>
    <a id="legalEmail" href={`mailto:${legal.email}`}>{legal.email}</a>
    <span className="k" id="phoneLabel" hidden={!legal.phone}>Telefon</span>
    <span id="legalPhone" hidden={!legal.phone}>{legal.phone}</span>
    <span className="k">Telegram</span>
    <a id="legalTg" href={`https://t.me/${config.tgContact.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer">{config.tgContact}</a>
  </address>

  <h2 id="vatSection" hidden={!legal.vatId}>Umsatzsteuer-ID</h2>
  <p id="vatBlock" hidden={!legal.vatId}>
    Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
    <strong id="legalVat">{legal.vatId}</strong>
  </p>

  <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
  <address className="addr">
    <span id="legalResponsible">{legal.responsible || legal.name}</span><br />
    <span id="legalResponsibleAddr">{[legal.street, legal.zipCity].filter(Boolean).join(', ')}</span>
  </address>

  <h2>Streitschlichtung</h2>
  <p>
    Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
    <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>.
    Unsere E-Mail-Adresse finden Sie oben im Impressum.
  </p>
  <p>
    Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
    Verbraucherschlichtungsstelle teilzunehmen.
  </p>

  <h2>Haftung für Inhalte</h2>
  <p>
    Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den
    allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht
    verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen
    zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
  </p>
  <p>
    Dieser Dienst verarbeitet von Nutzern hochgeladene Videodateien ausschließlich zum Zweck der
    Untertitel-Erstellung. Die Verantwortung für die hochgeladenen Inhalte und die Rechte an ihnen
    liegt allein beim jeweiligen Nutzer. Hochgeladene Dateien werden automatisch nach
    <strong id="retentionInline">{config.retentionHours}</strong> Stunden gelöscht.
  </p>

  <h2>Haftung für Links</h2>
  <p>
    Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben.
    Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
    verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
  </p>

  <h2>Urheberrecht</h2>
  <p>
    Die durch den Diensteanbieter erstellten Inhalte und Werke auf diesen Seiten unterliegen dem
    deutschen Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet. Downloads und Kopien
    dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.
  </p>

  </main>;
}
