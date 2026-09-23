export type Cue = { start: string; end: string; startSec: number; endSec: number; text: string };
const timestamp = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})';
const timing = new RegExp(`^${timestamp}\\s+-->\\s+${timestamp}$`);
export function parseSrt(source: string): Cue[] {
  const content = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('Empty subtitles');
  return content.split(/\n[ \t]*\n/).map(block => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = lines.shift()?.trim().match(timing);
    if (!match || !lines.join('\n').trim()) throw new Error('Invalid subtitle block');
    const seconds = (i: number) => Number(match[i]) * 3600 + Number(match[i + 1]) * 60 + Number(match[i + 2]) + Number(match[i + 3]) / 1000;
    const startSec = seconds(1), endSec = seconds(5);
    if (endSec <= startSec) throw new Error('Invalid subtitle timing');
    return { start: `${match[1]}:${match[2]}:${match[3]},${match[4]}`, end: `${match[5]}:${match[6]}:${match[7]},${match[8]}`, startSec, endSec, text: lines.join('\n') };
  });
}
export function serializeSrt(cues: Cue[]): string {
  if (!cues.length || cues.some(cue => !cue.text.trim() || /\n\s*\n/.test(cue.text))) throw new Error('Empty subtitle or blank line');
  return cues.map((cue, i) => `${i + 1}\n${cue.start} --> ${cue.end}\n${cue.text.trim()}`).join('\n\n') + '\n';
}
