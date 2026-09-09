export function youtubeVideoId(value: string): string | null {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  )
    return null;
  const id = url.pathname === "/watch" ? url.searchParams.get("v") : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function formatVideoTime(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function getTranscriptParagraphs(blocks: readonly { text: string }[]): string[] {
  const parts: string[] = [];
  let previous = "";
  for (const block of blocks) {
    const text = block.text.replace(/\s+/g, " ").trim();
    // Chinese and Japanese subtitle boundaries do not imply spaces.
    const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]$/u.test(previous) &&
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u.test(text);
    if (previous && !unspaced) parts.push(" ");
    parts.push(text);
    previous = text;
  }
  const text = parts.join("");
  const paragraphs: string[] = [];
  let paragraph = "";
  // Reflow existing sentences for reading without generating or rewriting text.
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)) {
    paragraph += segment;
    if (paragraph.length >= 800) {
      paragraphs.push(paragraph.trim());
      paragraph = "";
    }
  }
  if (paragraph) paragraphs.push(paragraph.trim());
  return paragraphs;
}

export interface YouTubeCaptionSource {
  videoId: string;
  url: string;
  title: string;
  languageCode: string;
  xml: string;
}

export function parseYouTubeCaptions(xml: string): Array<{ text: string; timeSeconds: number }> {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement.tagName !== "timedtext" || document.documentElement.getAttribute("format") !== "3")
    throw new Error("videoTranscriptInvalid");
  const blocks = [];
  let previousTime = -1;
  for (const paragraph of document.querySelectorAll("timedtext > body > p")) {
    for (const lineBreak of paragraph.querySelectorAll("br")) lineBreak.replaceWith(document.createTextNode("\n"));
    const text = paragraph.textContent?.trim() ?? "";
    if (!text) continue;
    const start = paragraph.getAttribute("t");
    if (start === null || !/^\d+$/.test(start)) throw new Error("videoTranscriptInvalid");
    const milliseconds = Number(start);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < previousTime) throw new Error("videoTranscriptInvalid");
    previousTime = milliseconds;
    blocks.push({ text, timeSeconds: milliseconds / 1000 });
  }
  if (!blocks.length) throw new Error("youtubeCaptionsEmpty");
  return blocks;
}
