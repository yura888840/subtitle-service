import Link from 'next/link';
import { getOptions } from '@/lib/public-config';

const copy = {
  en: {
    eyebrow: 'Video Subtitle Studio', title: 'Speak your language. Share it in English.',
    intro: 'Translate your video into English subtitles, review every line beside the player, then burn the subtitles into your video.',
    start: 'Open subtitle studio', steps: [['Upload', 'Choose your video and its spoken language.'], ['Review', 'Check the English translation and edit the subtitle text.'], ['Download', 'Save an SRT file or render an MP4 with subtitles included.']],
    more: 'How to add English subtitles to a video', limits: 'Before you upload',
    limitsText: (mb: number, minutes: number, daily: number) => `Videos up to ${minutes} minutes and ${mb} MB. ${daily} free translations per IP per day. A license removes the daily limit.`,
    wait: 'Processing is queued. Keep the studio tab open while your video is processing. Download your files before they expire.',
    seoTitle: 'Add English subtitles to your videos online', seoIntro: 'Turn spoken video into editable English subtitles, then share a video that carries its captions with it.',
    sections: [
      ['Translate speech into English subtitles', 'Select the language spoken in your video. Whisper generates English subtitles with timestamps. The selected language describes your source video; it does not change the output language.'],
      ['Review subtitles alongside your video', 'Listen to the original audio, click a timestamp to jump to that moment, and edit the translated text. Automatic translations can make mistakes, so review names and important details before exporting.'],
      ['Download SRT or burn subtitles into MP4', 'Use an SRT file as a separate subtitle track, or render an MP4 with the subtitles permanently visible. Burned-in subtitles do not need to be enabled in the player.'],
      ['Work with a range of source languages', 'The studio offers a configured list of source languages and Whisper models. Choose your source language before uploading; processing time depends on the video, model and queue.'],
    ],
    faq: 'Questions about video subtitles', questions: [
      ['Can I choose another output language?', 'The current service produces English subtitles. You can edit the resulting text before rendering.'],
      ['Do I need an account?', 'No account is required for the current studio. Free usage is limited per IP per day.'],
      ['Can I close the tab while processing?', 'Keep it open. Closing the studio tab cancels a queued or running job.'],
      ['Are the files stored permanently?', 'No. Files are removed by automatic retention cleanup. Download your results promptly.'],
    ],
  },
  uk: {
    eyebrow: 'Студія відеосубтитрів', title: 'Говоріть своєю мовою. Діліться англійською.',
    intro: 'Перекладайте відео англійськими субтитрами, перевіряйте кожен рядок поруч із плеєром і вшивайте субтитри у відео.',
    start: 'Відкрити студію субтитрів', steps: [['Завантажте', 'Оберіть відео та мову, якою в ньому говорять.'], ['Перевірте', 'Перегляньте англійський переклад і відредагуйте текст.'], ['Збережіть', 'Завантажте SRT або створіть MP4 із вшитими субтитрами.']],
    more: 'Як додати англійські субтитри до відео', limits: 'Перед завантаженням',
    limitsText: (mb: number, minutes: number, daily: number) => `Відео до ${minutes} хвилин і ${mb} МБ. Безкоштовних перекладів на одну IP-адресу за день: ${daily}. Ліцензія знімає денне обмеження.`,
    wait: 'Обробка відбувається в черзі. Не закривайте вкладку студії під час обробки. Завантажте файли до завершення терміну зберігання.',
    seoTitle: 'Додайте англійські субтитри до відео онлайн', seoIntro: 'Перетворіть мовлення у відео на англійські субтитри, відредагуйте їх і збережіть відео з видимим перекладом.',
    sections: [
      ['Перекладайте мовлення англійськими субтитрами', 'Оберіть мову оригінального відео. Whisper створить англійські субтитри з часовими позначками. Обрана мова стосується джерела, а не мови результату.'],
      ['Редагуйте субтитри поруч із відео', 'Слухайте оригінальне аудіо, натискайте на час для переходу до потрібного моменту та редагуйте переклад. Автоматичний переклад може помилятися: перевірте імена й важливі деталі.'],
      ['Завантажуйте SRT або вшивайте субтитри у MP4', 'Використовуйте SRT як окрему доріжку або створіть MP4 із постійно видимими субтитрами. Вшиті субтитри не потрібно вмикати у плеєрі.'],
      ['Працюйте з різними мовами оригіналу', 'У студії доступний налаштований перелік мов і моделей Whisper. Оберіть мову перед завантаженням. Час обробки залежить від відео, моделі та черги.'],
    ],
    faq: 'Запитання про відеосубтитри', questions: [
      ['Чи можна обрати іншу мову перекладу?', 'Зараз сервіс створює англійські субтитри. Перед вшиванням ви можете відредагувати їхній текст.'],
      ['Чи потрібен обліковий запис?', 'Ні. Безкоштовне використання має денне обмеження на одну IP-адресу.'],
      ['Чи можна закрити вкладку під час обробки?', 'Залишайте її відкритою. Закриття вкладки студії скасовує завдання в черзі або під час обробки.'],
      ['Чи зберігаються файли назавжди?', 'Ні. Файли видаляються автоматично після завершення терміну зберігання. Завантажте результати завчасно.'],
    ],
  },
};
export { copy };
export async function Marketing({ lang, seo = false }: { lang: 'en' | 'uk'; seo?: boolean }) {
  const c = copy[lang];
  const options = await getOptions();
  return <main id="content">
    <p className="eyebrow">{c.eyebrow}</p>
    <h1>{seo ? c.seoTitle : c.title}</h1>
    <p className="intro">{seo ? c.seoIntro : c.intro}</p>
    <nav className="language-links" aria-label="Page language"><Link href={seo ? '/seo' : '/'} hrefLang="en" aria-current={lang === 'en' ? 'page' : undefined}>English</Link><Link href={seo ? '/uk/seo' : '/uk'} hrefLang="uk" aria-current={lang === 'uk' ? 'page' : undefined}>Українська</Link></nav>
    <a className="button" href={`/studio?lang=${lang}`}>{c.start} <span aria-hidden="true">→</span></a>
    <ol className="steps">{c.steps.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ol>
    {seo ? <article className="article">
      {c.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}
      <section><h2>{c.faq}</h2>{c.questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>
    </article> : <p><Link href={lang === 'uk' ? '/uk/seo' : '/seo'}>{c.more} →</Link></p>}
    <aside className="conditions"><h2>{c.limits}</h2><p>{c.limitsText(options.maxFileSizeMb, options.maxDurationSec / 60, options.dailyLimit)}</p><p>{c.wait}</p></aside>
  </main>;
}
