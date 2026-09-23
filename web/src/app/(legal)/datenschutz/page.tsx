/* Existing operator-provided legal text migrated to JSX; not a legal review. */
/* eslint-disable react/no-unescaped-entities */
import Link from 'next/link';
import { getLegal } from '@/lib/public-config';
import { pageMetadata } from '@/lib/metadata';
export function generateMetadata() { return pageMetadata('Datenschutzerklärung', 'Datenschutzerklärung für den Video-Untertitel-Dienst SUBTITLED.', '/datenschutz', 'de'); }
export default async function Page() {
  const config = await getLegal();
  const { legal } = config;
  return <main id="content" className="legal-doc">
  <Link href="/" className="backlink">← Zurück zum Dienst</Link>

  <div className="eyebrow">Datenschutz</div>
  <h1>Datenschutzerklärung</h1>
  <div className="updated">Stand: <span id="today">2026</span> · Gemäß DSGVO / BDSG</div>

  <nav className="toc">
    <a href="#s1"><span className="n">1</span>Verantwortlicher</a>
    <a href="#s2"><span className="n">2</span>Überblick</a>
    <a href="#s3"><span className="n">3</span>Hochgeladene Videos</a>
    <a href="#s4"><span className="n">4</span>Server-Logs &amp; IP-Adresse</a>
    <a href="#s5"><span className="n">5</span>Cookies &amp; lokale Speicherung</a>
    <a href="#s6"><span className="n">6</span>Lizenzschlüssel</a>
    <a href="#s7"><span className="n">7</span>Schriftarten</a>
    <a href="#s8"><span className="n">8</span>Speicherdauer</a>
    <a href="#s9"><span className="n">9</span>Empfänger / Auftragsverarbeiter</a>
    <a href="#s10"><span className="n">10</span>Ihre Rechte</a>
    <a href="#s11"><span className="n">11</span>Beschwerderecht</a>
    <a href="#s12"><span className="n">12</span>Änderungen</a>
  </nav>

  <h2 id="s1"><span className="n">01</span> Verantwortlicher</h2>
  <p>Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:</p>
  <div className="card-block">
    <p id="dsName"><strong>{legal.name}</strong></p>
    <p id="dsAddr">{[legal.street, legal.zipCity, legal.country].filter(Boolean).join(', ')}</p>
    <p>E-Mail: <a id="dsEmail" href={`mailto:${legal.email}`}>{legal.email}</a></p>
  </div>
  <p>Die vollständigen Kontaktdaten finden Sie in unserem <Link href="/impressum">Impressum</Link>.</p>

  <h2 id="s2"><span className="n">02</span> Überblick &amp; Grundsatz der Datensparsamkeit</h2>
  <p>
    Dieser Dienst erstellt Untertitel für kurze Videos. Wir haben ihn bewusst
    <strong>datensparsam</strong> gestaltet: Es besteht <strong>keine Registrierung</strong>, wir legen
    <strong>keine Nutzerkonten</strong> an, und wir setzen <strong>keine Tracking- oder Analyse-Dienste</strong>
    sowie <strong>keine Werbung</strong> ein. Die wenigen verarbeiteten Daten sind nachfolgend einzeln
    aufgeführt.
  </p>

  <h2 id="s3"><span className="n">03</span> Verarbeitung hochgeladener Videos</h2>
  <p>
    Wenn Sie ein Video hochladen, wird die Datei auf unserem Server gespeichert und verarbeitet, um
    daraus per automatischer Spracherkennung (Software „Whisper") Untertitel zu erzeugen und diese auf
    Wunsch in das Video einzubrennen (Software „ffmpeg"). Die gesamte Verarbeitung findet
    <strong>auf unserem eigenen Server</strong> statt; es werden hierfür <strong>keine externen
    KI-Dienste oder Cloud-APIs</strong> aufgerufen.
  </p>
  <p>
    Videos können personenbezogene Daten enthalten (z. B. abgebildete oder sprechende Personen). Sie
    sind allein dafür verantwortlich, dass Sie über die erforderlichen Rechte an den hochgeladenen
    Inhalten verfügen und dass durch den Upload keine Rechte Dritter verletzt werden.
  </p>
  <div className="table-scroll"><table><tbody>
    <tr><th>Merkmal</th><th>Angabe</th></tr>
    <tr><td>Zweck</td><td>Erstellung und Einbrennen von Untertiteln</td></tr>
    <tr><td>Rechtsgrundlage</td><td>Art. 6 Abs. 1 lit. b DSGVO (Erfüllung der von Ihnen angeforderten Leistung)</td></tr>
    <tr><td>Speicherdauer</td><td>Automatische Löschung nach <span id="ret1" className="mono">{config.retentionHours}</span> Stunden</td></tr>
    <tr><td>Weitergabe</td><td>Keine Weitergabe an Dritte</td></tr>
  </tbody></table></div>

  <h2 id="s4"><span className="n">04</span> Server-Logfiles &amp; IP-Adresse</h2>
  <p>
    Beim Aufruf des Dienstes verarbeitet der Server technisch notwendige Verbindungsdaten. Ihre
    <strong>IP-Adresse</strong> wird darüber hinaus verwendet, um die Anzahl kostenloser Übersetzungen
    pro Tag zu begrenzen (<span id="daily1" className="mono">{config.dailyLimit}</span> pro Tag) und um Missbrauch abzuwehren.
    Zu diesem Zweck wird pro IP-Adresse ein Tageszähler im Arbeitsspeicher geführt.
  </p>
  <div className="table-scroll"><table><tbody>
    <tr><th>Merkmal</th><th>Angabe</th></tr>
    <tr><td>Datenarten</td><td>IP-Adresse, Datum/Uhrzeit, technische Verbindungsdaten, Ereignis-Logs (z. B. Upload angenommen, Limit erreicht)</td></tr>
    <tr><td>Zweck</td><td>Bereitstellung und Stabilität des Dienstes, Begrenzung kostenloser Nutzung, Missbrauchsabwehr, IT-Sicherheit</td></tr>
    <tr><td>Rechtsgrundlage</td><td>Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren, missbrauchsfreien Betrieb)</td></tr>
    <tr><td>Speicherdauer</td><td>Der IP-Tageszähler wird spätestens täglich zurückgesetzt. Etwaige Server-Logdateien werden kurzfristig gespeichert und regelmäßig gelöscht.</td></tr>
  </tbody></table></div>

  <h2 id="s5"><span className="n">05</span> Cookies &amp; lokale Speicherung</h2>
  <p>
    Wir verwenden <strong>ausschließlich technisch notwendige bzw. funktionale</strong> Cookies und
    Browser-Speicher. Es werden <strong>keine Marketing- oder Tracking-Cookies</strong> gesetzt. Aus
    diesem Grund ist eine Einwilligung für die nachfolgenden Einträge nicht erforderlich; wir informieren
    Sie dennoch transparent über einen kurzen Hinweis-Banner.
  </p>
  <div className="table-scroll"><table><tbody>
    <tr><th>Name</th><th>Typ</th><th>Zweck</th><th>Dauer</th></tr>
    <tr><td className="mono">license</td><td>Cookie (httpOnly)</td><td>Erkennt einen gültigen Lizenzschlüssel, um das Tageslimit aufzuheben</td><td className="mono"><span id="lic1">{config.licenseTtlDays}</span> Tage</td></tr>
    <tr><td className="mono">pref_language</td><td>Cookie</td><td>Merkt sich die zuletzt gewählte Video-Sprache</td><td className="mono">180 Tage</td></tr>
    <tr><td className="mono">pref_model</td><td>Cookie</td><td>Merkt sich das zuletzt gewählte Modell</td><td className="mono">180 Tage</td></tr>
    <tr><td className="mono">lang</td><td>localStorage</td><td>Merkt sich die Sprache der Benutzeroberfläche (DE/EN/UK)</td><td className="mono">bis zur Löschung</td></tr>
    <tr><td className="mono">cookie_notice</td><td>localStorage</td><td>Merkt sich, dass Sie den Hinweis-Banner geschlossen haben</td><td className="mono">bis zur Löschung</td></tr>
  </tbody></table></div>
  <p>
    <strong>Rechtsgrundlage:</strong> § 25 Abs. 2 Nr. 2 TDDG (technisch erforderliche bzw. vom Nutzer
    ausdrücklich gewünschte Speicherung) sowie Art. 6 Abs. 1 lit. f DSGVO. Sie können Cookies jederzeit
    in Ihren Browsereinstellungen löschen und die lokale Speicherung deaktivieren.
  </p>

  <h2 id="s6"><span className="n">06</span> Lizenzschlüssel</h2>
  <p>
    Geben Sie einen Lizenzschlüssel ein, wird dieser in einem <span className="mono">httpOnly</span>-Cookie
    gespeichert, damit Ihr Browser bei weiteren Anfragen als lizenziert erkannt wird. Der Schlüssel wird
    ausschließlich zur Freischaltung der unbegrenzten Nutzung verwendet. Eine darüber hinausgehende
    Identifizierung Ihrer Person erfolgt hierdurch nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
  </p>

  <h2 id="s7"><span className="n">07</span> Schriftarten</h2>
  <p>Diese Website einschließlich Upload und Video-Editor verwendet Systemschriftarten. Es werden keine Schriftarten von Google Fonts abgerufen.</p>

  <h2 id="s8"><span className="n">08</span> Speicherdauer</h2>
  <ul>
    <li><strong>Hochgeladene Videos, erzeugte Untertitel und Ergebnisdateien:</strong> automatische Löschung spätestens <span id="ret2" className="mono">{config.retentionHours}</span> Stunden nach dem Upload.</li>
    <li><strong>Laufende Verarbeitung:</strong> Schließen Sie den Browser-Tab, wird eine laufende Verarbeitung abgebrochen und die zugehörige Datei entfernt.</li>
    <li><strong>IP-Tageszähler:</strong> Rücksetzung spätestens täglich.</li>
    <li><strong>Cookies / localStorage:</strong> gemäß Tabelle in Abschnitt 5.</li>
  </ul>

  <h2 id="s9"><span className="n">09</span> Empfänger &amp; Auftragsverarbeiter</h2>
  <p>
    Die Verarbeitung erfolgt auf unserem eigenen Server. Eine Übermittlung Ihrer Daten an Dritte findet
    nicht statt. Sofern der Server
    bei einem Hosting-Dienstleister betrieben wird, erfolgt dies auf Grundlage eines Vertrags zur
    Auftragsverarbeitung gemäß Art. 28 DSGVO.
  </p>
  <div className="note-legal">
    <strong>Auszufüllen durch den Betreiber:</strong> Nennen Sie hier Ihren Hosting-Anbieter
    (Name, Anschrift, Land) und bestätigen Sie das Bestehen eines Auftragsverarbeitungsvertrags (AVV).
    Bei Serverstandort außerhalb der EU sind zusätzliche Angaben zum Drittlandtransfer erforderlich.
  </div>

  <h2 id="s10"><span className="n">10</span> Ihre Rechte als betroffene Person</h2>
  <p>Ihnen stehen nach der DSGVO folgende Rechte zu:</p>
  <ul>
    <li><strong>Auskunft</strong> (Art. 15 DSGVO)</li>
    <li><strong>Berichtigung</strong> (Art. 16 DSGVO)</li>
    <li><strong>Löschung</strong> (Art. 17 DSGVO)</li>
    <li><strong>Einschränkung der Verarbeitung</strong> (Art. 18 DSGVO)</li>
    <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
    <li><strong>Widerspruch</strong> gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO)</li>
  </ul>
  <p>
    Zur Ausübung Ihrer Rechte genügt eine formlose Mitteilung an die im Impressum genannte
    E-Mail-Adresse. Bitte beachten Sie, dass wir aufgrund der kurzen Speicherdauer (24 Stunden) und der
    Datensparsamkeit in der Regel keine Ihnen zuordenbaren Daten mehr vorhalten.
  </p>

  <h2 id="s11"><span className="n">11</span> Beschwerderecht bei der Aufsichtsbehörde</h2>
  <p>
    Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde über die Verarbeitung Ihrer
    personenbezogenen Daten zu beschweren (Art. 77 DSGVO). Zuständig ist grundsätzlich die
    Aufsichtsbehörde des Bundeslandes, in dem der Verantwortliche seinen Sitz hat. Eine Liste der
    deutschen Aufsichtsbehörden finden Sie unter
    <a href="https://www.bfdi.bund.de/" target="_blank" rel="noopener noreferrer">www.bfdi.bund.de</a>.
  </p>

  <h2 id="s12"><span className="n">12</span> Änderungen dieser Datenschutzerklärung</h2>
  <p>
    Wir behalten uns vor, diese Datenschutzerklärung anzupassen, damit sie stets den aktuellen
    rechtlichen Anforderungen entspricht oder um Änderungen unseres Dienstes umzusetzen. Für Ihren
    erneuten Besuch gilt dann die jeweils aktuelle Fassung.
  </p>

  </main>;
}
