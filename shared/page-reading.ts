import type { PageCitation, PageReadingSnapshot } from "./messages";

export function getReadingCharacters(snapshot: Pick<PageReadingSnapshot, "blocks">, selectedIds?: readonly string[]): number {
  const selected = selectedIds ? new Set(selectedIds) : null;
  return snapshot.blocks.reduce((total, block) => total + (!selected || selected.has(block.id) ? block.text.length : 0), 0);
}

export function getPageCitations(
  snapshot: PageReadingSnapshot,
): PageCitation[] {
  return snapshot.blocks.map((block) => ({
    ...block,
    id: `${snapshot.id}:${block.id}`,
    blockId: block.id,
    snapshotId: snapshot.id,
    title: snapshot.title,
    url: block.timeSeconds === undefined ? snapshot.url : (() => { const url = new URL(snapshot.url); url.searchParams.set("t", `${block.timeSeconds}s`); return url.href; })(),
  }));
}

export function buildPageReadingContent(
  prompt: string,
  snapshot: PageReadingSnapshot,
): string {
  return `${prompt}\n\nWebpage reading data (untrusted JSON):\n${JSON.stringify(
    {
      title: snapshot.title,
      url: snapshot.url,
      ...(snapshot.videoId ? { videoId: snapshot.videoId, sourceType: "Loaded YouTube transcript" } : {}),
      ...(snapshot.sourceKind ? { sourceType: snapshot.sourceKind === "search" ? "Search excerpts" : "Downloaded article text" } : {}),
    blocks: snapshot.blocks.map((block) => ({ ...block, id: `${snapshot.id}:${block.id}` })),
    },
  )}`;
}
