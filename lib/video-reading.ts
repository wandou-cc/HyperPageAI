import { browser } from "wxt/browser";
import type {
  CommandResult,
  PageReadingSelection,
  PageReadingSnapshot,
} from "../shared/messages";
import {
  formatVideoTime,
  parseYouTubeCaptions,
  youtubeVideoId,
  type YouTubeCaptionSource,
} from "../shared/video";

interface VideoEntry {
  snapshot: PageReadingSnapshot;
  video: HTMLVideoElement;
}

export class VideoReading {
  private entries = new Map<string, VideoEntry>();
  private generation = 0;

  async read(): Promise<PageReadingSnapshot> {
    const videoId = youtubeVideoId(location.href);
    if (!videoId) throw new Error("youtubeVideoRequired");
    const video = document.querySelector<HTMLVideoElement>("video.html5-main-video");
    if (!video) throw new Error("youtubePlayerNotReady");
    const generation = this.generation;
    const result = await browser.runtime.sendMessage({ target: "background", type: "read-youtube-captions", videoId }) as CommandResult<YouTubeCaptionSource>;
    if (!result.ok) throw new Error(result.error);
    if (generation !== this.generation || youtubeVideoId(location.href) !== videoId || !video.isConnected || document.querySelector("video.html5-main-video") !== video || result.data.videoId !== videoId)
      throw new Error("youtubeVideoChanged");
    const snapshot: PageReadingSnapshot = {
      id: crypto.randomUUID(),
      title: `${result.data.title} (${result.data.languageCode})`,
      url: result.data.url,
      videoId,
      blocks: parseYouTubeCaptions(result.data.xml).map(({ text, timeSeconds }, index) => ({
        id: `1.${index + 1}`, text, timeSeconds, heading: formatVideoTime(timeSeconds), headingLevel: null,
      })),
    };
    this.entries.set(snapshot.id, { snapshot, video });
    return snapshot;
  }

  select(
    selection: PageReadingSelection,
  ): PageReadingSnapshot {
    if (
      !selection ||
      !Array.isArray(selection.blockIds) ||
      !selection.blockIds.length ||
      selection.blockIds.some((id) => typeof id !== "string") ||
      new Set(selection.blockIds).size !== selection.blockIds.length
    )
      throw new Error("pageReadingSelectionInvalid");
    const entry = this.entries.get(selection.snapshotId);
    if (!entry || entry.snapshot.videoId !== youtubeVideoId(location.href))
      throw new Error("pageReadingUnavailable");
    const ids = new Set(selection.blockIds);
    const snapshot = {
      ...entry.snapshot,
      blocks: entry.snapshot.blocks.filter((block) => ids.has(block.id)),
    };
    if (snapshot.blocks.length !== ids.size)
      throw new Error("pageReadingSelectionInvalid");
    return snapshot;
  }

  locate(snapshotId: string, blockId: string): void {
    const entry = this.entries.get(snapshotId);
    const block = entry?.snapshot.blocks.find((item) => item.id === blockId);
    const video = document.querySelector<HTMLVideoElement>(
      "video.html5-main-video",
    );
    if (
      !entry ||
      !block ||
      block.timeSeconds === undefined ||
      entry.snapshot.videoId !== youtubeVideoId(location.href) ||
      !video ||
      video !== entry.video ||
      !entry.video.isConnected ||
      !Number.isFinite(video.duration) ||
      block.timeSeconds > video.duration
    )
      throw new Error("citationUnavailable");
    video.currentTime = block.timeSeconds;
    video.scrollIntoView({ block: "center", behavior: "instant" });
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
  }
}
