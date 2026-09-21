export default function Home() {
  return (
    <main>
      <p className="eyebrow">Video Subtitle Studio</p>
      <h1>Your video.<br />English subtitles.</h1>
      <p className="intro">Upload a video, review and edit its translated subtitles, then download the finished video.</p>
      {/* Full document navigation keeps the existing studio and its WS lifecycle intact. */}
      <a className="button" href="/studio">Open subtitle studio <span aria-hidden="true">→</span></a>
      <ol className="steps">
        <li><strong>Upload</strong><span>Choose your video and its spoken language.</span></li>
        <li><strong>Review</strong><span>Edit each subtitle alongside your video.</span></li>
        <li><strong>Download</strong><span>Save the video with subtitles included.</span></li>
      </ol>
      <footer><a href="/impressum.html">Impressum</a><a href="/datenschutz.html">Privacy</a></footer>
    </main>
  );
}
