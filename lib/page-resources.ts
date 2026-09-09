import type { FileReadingSnapshot } from "../shared/messages";
import type { PageResource, ResourceCatalog, ResourceCommand, ResourceResult } from "../shared/page-resources";
import { normalizeImageBlob, IMAGE_BYTE_LIMIT } from "../shared/image";
import { PDF_FILE_BYTE_LIMIT, TEXT_FILE_BYTE_LIMIT } from "../shared/files";
import { formatVideoTime, youtubeVideoId } from "../shared/video";
import { VideoReading } from "./video-reading";

const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

interface ResourceEntry {
  resource: PageResource;
  element: Element;
  address: string;
  pageUrl: string;
}

function addressOf(element: Element): string {
  const address = element instanceof HTMLImageElement ? element.currentSrc || element.getAttribute("src") :
    element instanceof HTMLVideoElement ? element.currentSrc || element.getAttribute("src") || element.querySelector<HTMLSourceElement>("source[src]")?.src :
      element.getAttribute("href") || element.getAttribute("src") || element.getAttribute("data");
  if (!address) return "";
  try { return new URL(address, document.baseURI).href; }
  catch { return ""; }
}

function subtitleTrack(video: HTMLVideoElement): TextTrack | undefined {
  return Array.from(video.textTracks).find((track) => ["subtitles", "captions"].includes(track.kind) && track.cues && track.cues.length > 0);
}

async function fetchResource(address: string, limit: number, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(address, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("resourceReadFailed");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("resourceTooLarge");
  }
  if (!response.body) throw new Error("resourceReadFailed");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("resourceTooLarge");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    try { await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
  return new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream" });
}

export class PageResources {
  private entries = new Map<string | Element, ResourceEntry>();
  private video = new VideoReading();
  private youtubeSnapshots = new Set<string>();
  private subtitles = new Map<string, { entry: ResourceEntry; seconds: Map<string, number> }>();
  private abort = new AbortController();

  scan(): ResourceCatalog {
    const previous = this.entries;
    const next = new Map<string | Element, ResourceEntry>();
    for (const element of document.querySelectorAll("a[href], img, video, iframe[src], embed[src], object[data]")) {
      if (element.closest("[data-hyperpage-ui]")) continue;
      const address = addressOf(element);
      const parsed = address ? new URL(address) : null;
      if (!parsed && !(element instanceof HTMLVideoElement)) continue;
      if (parsed && !["http:", "https:", "blob:", "data:"].includes(parsed.protocol)) continue;
      const filename = parsed && ["http:", "https:"].includes(parsed.protocol) ? parsed.pathname.split("/").at(-1) || "" : "";
      const download = element.getAttribute("download") || "";
      const mime = element.getAttribute("type")?.split(";")[0]?.trim().toLowerCase() || "";
      const extension = (download || filename).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
      const format = DOCUMENT_TYPES[mime] || extension;
      let kind: PageResource["kind"];
      let reader: PageResource["reader"] = null;
      let resourceFormat = format;
      if (element instanceof HTMLImageElement || /^(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(format) || mime.startsWith("image/")) {
        if (!address) continue;
        kind = "image";
        reader = "image";
        resourceFormat = format || "image";
      } else if (element instanceof HTMLVideoElement || /^(mp4|webm|mov|m4v|ogv|m3u8|mpd)$/.test(format) || mime.startsWith("video/") ||
        (element instanceof HTMLIFrameElement && parsed && /(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com)$/.test(parsed.hostname))) {
        kind = "video";
        resourceFormat = format || "video";
        if (element instanceof HTMLVideoElement) {
          if (youtubeVideoId(location.href) && element.matches("video.html5-main-video")) reader = "youtube";
          else if (subtitleTrack(element)) reader = "transcript";
        }
      } else if (/^(pdf|txt|md|markdown|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/.test(format) || element.hasAttribute("download")) {
        if (!parsed) continue;
        kind = "document";
        reader = format === "pdf" ? "pdf" : /^(txt|md|markdown)$/.test(format) ? "text" : null;
        resourceFormat = format || "file";
      } else continue;
      const url = reader === "youtube" ? location.href : parsed && ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
      if (parsed && parsed.protocol !== "data:") parsed.hash = "";
      const key = parsed ? `${kind}:${parsed.href}` : element;
      const existing = next.get(key);
      if (existing && (existing.resource.reader || !reader)) continue;
      const name = (download || element.getAttribute("alt") || element.getAttribute("title") ||
        (element instanceof HTMLAnchorElement ? element.textContent?.trim() : "") || filename || document.title || resourceFormat).slice(0, 255);
      next.set(key, {
        resource: { id: previous.get(key)?.resource.id || crypto.randomUUID(), kind, name, url, format: resourceFormat, reader },
        element, address, pageUrl: location.href,
      });
    }
    this.entries = next;
    return { type: "catalog", url: location.href, title: document.title, resources: Array.from(next.values(), (entry) => entry.resource) };
  }

  private entry(id: string): ResourceEntry {
    const entry = Array.from(this.entries.values()).find((value) => value.resource.id === id);
    if (!entry || !entry.element.isConnected || entry.pageUrl !== location.href || entry.address !== addressOf(entry.element)) throw new Error("resourceUnavailable");
    return entry;
  }

  async execute(command: ResourceCommand): Promise<ResourceResult> {
    if (command.type === "scan") return this.scan();
    if (command.type === "locate") {
      const transcript = this.subtitles.get(command.snapshotId);
      if (transcript) {
        const { entry, seconds } = transcript;
        const time = seconds.get(command.blockId);
        if (!entry.element.isConnected || entry.pageUrl !== location.href || entry.address !== addressOf(entry.element) || time === undefined || !(entry.element instanceof HTMLVideoElement)) return { type: "located", found: false };
        entry.element.currentTime = time;
        entry.element.scrollIntoView({ block: "center" });
      } else if (this.youtubeSnapshots.has(command.snapshotId)) {
        this.video.locate(command.snapshotId, command.blockId);
      } else return { type: "located", found: false };
      return { type: "located", found: true };
    }
    const entry = this.entry(command.resourceId);
    if (command.type === "reveal") {
      entry.element.scrollIntoView({ block: "center" });
      return { type: "located", found: true };
    }
    const { resource, element } = entry;
    if (!resource.reader) throw new Error("resourceUnsupported");
    if (resource.reader === "youtube") {
      const page = await this.video.read();
      this.youtubeSnapshots.add(page.id);
      return { type: "page", page };
    }
    if (resource.reader === "transcript") {
      if (!(element instanceof HTMLVideoElement)) throw new Error("resourceUnavailable");
      const track = subtitleTrack(element);
      if (!track?.cues) throw new Error("videoTranscriptUnavailable");
      const cues = Array.from(track.cues).filter((cue): cue is VTTCue => cue instanceof VTTCue && Boolean(cue.text.trim()));
      if (!cues.length) throw new Error("videoTranscriptUnavailable");
      const file: FileReadingSnapshot = { id: crypto.randomUUID(), name: resource.name, format: "text", pageCount: 1,
        blocks: cues.map((cue, index) => ({ id: `1.${index + 1}`, text: cue.text, heading: formatVideoTime(cue.startTime), headingLevel: null, pageNumber: 1 })),
      };
      this.subtitles.set(file.id, { entry, seconds: new Map(cues.map((cue, index) => [`1.${index + 1}`, cue.startTime])) });
      return { type: "file", file };
    }
    const limit = resource.reader === "image" ? IMAGE_BYTE_LIMIT : resource.reader === "pdf" ? PDF_FILE_BYTE_LIMIT : TEXT_FILE_BYTE_LIMIT;
    let blob: Blob;
    try {
      blob = await fetchResource(entry.address, limit, AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]));
    } catch (error) {
      if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) throw new Error("resourceReadFailed");
      throw error;
    }
    this.entry(resource.id);
    if (resource.reader === "image") {
      const dataUrl = await normalizeImageBlob(blob);
      this.entry(resource.id);
      return { type: "image", image: { id: crypto.randomUUID(), name: resource.name, dataUrl } };
    }
    const allowed = resource.reader === "pdf" ? ["application/pdf", "application/octet-stream"] : ["text/plain", "text/markdown", "application/octet-stream"];
    if (!allowed.includes(blob.type)) throw new Error("resourceContentInvalid");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const suffix = resource.reader === "pdf" ? "pdf" : "txt";
    const matchingSuffix = resource.reader === "pdf" ? /\.pdf$/i : /\.(txt|md|markdown)$/i;
    const name = matchingSuffix.test(resource.name) ? resource.name : `${resource.name.slice(0, 250)}.${suffix}`;
    return { type: "bytes", format: resource.reader, name, base64: btoa(binary) };
  }

  destroy(): void {
    this.abort.abort();
    this.entries.clear();
    this.subtitles.clear();
    this.youtubeSnapshots.clear();
    this.video.clear();
  }
}
