import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageReading } from "../lib/page-reading";
import { getPageCitations, buildPageReadingContent } from "../shared/page-reading";
import { parseContextSnapshot } from "../shared/conversations";
import { answerToMarkdown } from "../shared/export";
import { parseYouTubeCaptions, type YouTubeCaptionSource } from "../shared/video";

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage } } }));
const source: YouTubeCaptionSource = {
  videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Video", languageCode: "en",
  xml: '<timedtext format="3"><body><p t="0" d="1500">Introduction</p><p t="85000" d="2500"><s>The second </s><s>topic</s></p></body></timedtext>',
};
let reading: PageReading;
beforeEach(() => {
  vi.clearAllMocks();
  reading = new PageReading();
  vi.stubGlobal("location", { href: source.url });
  document.body.innerHTML = '<video class="html5-main-video"></video><button class="ytp-subtitles-button" aria-pressed="false">CC</button>';
  const video = document.querySelector("video");
  if (!video) throw new Error("Missing fixture video");
  Object.defineProperty(video, "duration", { value: 100 });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  sendMessage.mockResolvedValue({ ok: true, data: source });
});
afterEach(() => { reading.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("direct YouTube subtitle reading", () => {
  it("selects a complete long transcript and rejects unknown or duplicate cue IDs", async () => {
    const text = "Long subtitle ".repeat(10_000).trim();
    sendMessage.mockResolvedValue({ ok: true, data: { ...source, xml: `<timedtext format="3"><body><p t="0">${text}</p></body></timedtext>` } });
    const snapshot = await reading.readVideo();
    const command = { type: "get-video-selection" as const, selection: { snapshotId: snapshot.id, blockIds: ["1.1"] } };
    expect(reading.execute(command)?.blocks[0]?.text).toBe(text);
    for (const blockIds of [["missing"], ["1.1", "missing"], ["1.1", "1.1"]]) {
      expect(() => reading.execute({ ...command, selection: { ...command.selection, blockIds } })).toThrow("pageReadingSelectionInvalid");
    }
  });

  it("reads without a transcript panel or enabled CC and preserves timestamp citations", async () => {
    const snapshot = await reading.readVideo();
    expect(sendMessage).toHaveBeenCalledWith({ target: "background", type: "read-youtube-captions", videoId: source.videoId });
    expect(snapshot.blocks.map((block) => [block.text, block.timeSeconds])).toEqual([["Introduction", 0], ["The second topic", 85]]);
    expect(snapshot.title).toBe("Video (en)");
    const selected = reading.execute({ type: "get-video-selection", selection: { snapshotId: snapshot.id, blockIds: ["1.2"] } });
    if (!selected) throw new Error("Missing selection");
    expect(parseContextSnapshot({ type: "page", page: selected }).type).toBe("page");
    expect(buildPageReadingContent("Summarize", selected)).toContain('"timeSeconds":85');
    const citations = getPageCitations(selected);
    expect(citations[0]?.url).toContain("&t=85s");
    expect(answerToMarkdown(`Answer [[${snapshot.id}:1.2]]`, citations)).toContain("1:25");
    reading.execute({ type: "locate-video-citation", snapshotId: snapshot.id, blockId: "1.2" });
    expect(document.querySelector("video")?.currentTime).toBe(85);
    expect(document.querySelector(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "false");
  });

  it("invalidates citations after video replacement, navigation and clearing", async () => {
    const snapshot = await reading.readVideo();
    const command = { type: "locate-video-citation" as const, snapshotId: snapshot.id, blockId: "1.2" };
    document.body.innerHTML = '<video class="html5-main-video"></video>';
    expect(() => reading.execute(command)).toThrow("citationUnavailable");
    vi.stubGlobal("location", { href: "https://www.youtube.com/watch?v=12345678901" });
    expect(() => reading.execute({ type: "get-video-selection", selection: { snapshotId: snapshot.id, blockIds: ["1.1"] } })).toThrow("pageReadingUnavailable");
    reading.clear();
    expect(() => reading.execute(command)).toThrow("citationUnavailable");
  });

  it.each(["navigation", "clear"])("discards a pending extraction after %s", async (change) => {
    let complete: ((value: unknown) => void) | undefined;
    sendMessage.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const pending = reading.readVideo();
    if (change === "navigation") vi.stubGlobal("location", { href: "https://www.youtube.com/watch?v=12345678901" });
    else reading.clear();
    if (!complete) throw new Error("Missing pending request");
    complete({ ok: true, data: source });
    await expect(pending).rejects.toThrow("youtubeVideoChanged");
  });

  it("surfaces subtitle access errors and rejects unsupported websites before requesting data", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "youtubeCaptionsAccessDenied" });
    await expect(reading.readVideo()).rejects.toThrow("youtubeCaptionsAccessDenied");
    sendMessage.mockClear();
    vi.stubGlobal("location", { href: "https://example.com/watch?v=abcdefghijk" });
    await expect(reading.readVideo()).rejects.toThrow("youtubeVideoRequired");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("YouTube srv3 subtitle data", () => {
  it("parses word segments, XML entities, line breaks and subsecond timestamps", () => {
    expect(parseYouTubeCaptions('<timedtext format="3"><body><p t="1250" d="2000"><s>One &amp; </s><s>two</s><br/>Next line</p><p t="3250"> </p></body></timedtext>'))
      .toEqual([{ text: "One & two\nNext line", timeSeconds: 1.25 }]);
  });

  it.each([
    '<html><body>Login</body></html>', '<timedtext format="3"><body>',
    '<timedtext format="3"><body><p>Missing time</p></body></timedtext>',
    '<timedtext format="3"><body><p t="-1">Negative</p></body></timedtext>',
    '<timedtext format="3"><body><p t="2000">Later</p><p t="1000">Earlier</p></body></timedtext>',
  ])("rejects malformed or unrelated responses: %s", (xml) => {
    expect(() => parseYouTubeCaptions(xml)).toThrow("videoTranscriptInvalid");
  });

  it("distinguishes an empty subtitle file", () => {
    expect(() => parseYouTubeCaptions('<timedtext format="3"><body/></timedtext>')).toThrow("youtubeCaptionsEmpty");
  });
});
