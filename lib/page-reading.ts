import type {
  PageContentBlock,
  PageReadingCommand,
  PageReadingSelection,
  PageReadingSnapshot,
} from "../shared/messages";
import { isSensitiveElement, isVisibleContent } from "../shared/dom-content";
import { VideoReading } from "./video-reading";

interface BlockTarget {
  root: Element;
  element: Element;
  nodes: Text[];
  text: string;
}

interface ReadingEntry {
  snapshot: PageReadingSnapshot;
  targets: Map<string, BlockTarget>;
}

const BLOCK_ELEMENTS =
  "h1, h2, h3, h4, h5, h6, p, li, dt, dd, pre, blockquote, tr, figcaption, div, section, article, main, body";
const FORM_CONTENT =
  "input, textarea, select, button, option, [contenteditable]:not([contenteditable='false'])";

function collectReadingGroups(
  root: Element,
): Array<{ element: Element; nodes: Text[] }> {
  const groups: Array<{ element: Element; nodes: Text[] }> = [];
  if (
    !isVisibleContent(root) ||
    root.closest(FORM_CONTENT) ||
    isSensitiveElement(root)
  )
    return groups;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element) {
          return !isVisibleContent(node) ||
            node.matches(FORM_CONTENT) ||
            isSensitiveElement(node)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        return node.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  let current: { element: Element; nodes: Text[] } | undefined;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node instanceof Text) || !node.parentElement) continue;
    const element = node.parentElement.closest(BLOCK_ELEMENTS);
    if (!element) continue;
    if (current?.element !== element) {
      current = { element, nodes: [] };
      groups.push(current);
    }
    current.nodes.push(node);
  }
  return groups;
}

export class PageReading {
  private video = new VideoReading();
  private entries = new Map<string, ReadingEntry>();
  private nextSnapshot = 1;
  private highlight: HTMLDivElement | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  readVideo(): Promise<PageReadingSnapshot> {
    return this.video.read();
  }

  execute(command: Exclude<PageReadingCommand, { type: "read-selected-element" | "read-video" }>): PageReadingSnapshot | null {
    switch (command.type) {
      case "get-video-selection":
        return this.video.select(command.selection);
      case "locate-video-citation":
        this.video.locate(command.snapshotId, command.blockId);
        return null;
      case "read-page":
        return this.read();
      case "get-reading-selection":
        return this.select(command.selection);
      case "locate-citation":
        this.locate(command.snapshotId, command.blockId);
        return null;
      case "clear-reading":
        this.clear();
        return null;
    }
  }

  read(root: Element = document.body): PageReadingSnapshot {
    const id = crypto.randomUUID();
    const number = this.nextSnapshot++;
    const blocks: PageContentBlock[] = [];
    const targets = new Map<string, BlockTarget>();
    const headings: Array<{ level: number; text: string }> = [];
    for (const current of collectReadingGroups(root)) {
      const text = current.nodes
        .map((node) => node.data)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      const headingLevel = /^H[1-6]$/.test(current.element.tagName)
        ? Number(current.element.tagName[1])
        : null;
      if (headingLevel !== null) {
        while (headings.some((heading) => heading.level >= headingLevel))
          headings.pop();
        headings.push({ level: headingLevel, text });
      }
      const block: PageContentBlock = {
        id: `${number}.${blocks.length + 1}`,
        text,
        heading: headings.map((heading) => heading.text).join(" / "),
        headingLevel,
      };
      blocks.push(block);
      targets.set(block.id, { ...current, root: root.contains(current.element) ? current.element : root, text });
    }
    if (!blocks.length) throw new Error("pageReadingEmpty");
    const snapshot: PageReadingSnapshot = {
      id,
      title: document.title,
      url: location.href,
      blocks,
    };
    this.entries.set(id, { snapshot, targets });
    return snapshot;
  }

  select(selection: PageReadingSelection): PageReadingSnapshot {
    if (
      !selection ||
      typeof selection.snapshotId !== "string" ||
      !Array.isArray(selection.blockIds) ||
      !selection.blockIds.length ||
      selection.blockIds.some((id) => typeof id !== "string") ||
      new Set(selection.blockIds).size !== selection.blockIds.length
    )
      throw new Error("pageReadingSelectionInvalid");
    const entry = this.entries.get(selection.snapshotId);
    if (!entry || entry.snapshot.url !== location.href)
      throw new Error("pageReadingUnavailable");
    if (selection.blockIds.some((id) => !entry.targets.has(id)))
      throw new Error("pageReadingSelectionInvalid");
    const ids = new Set(selection.blockIds);
    const snapshot = {
      ...entry.snapshot,
      blocks: entry.snapshot.blocks.filter((block) => ids.has(block.id)),
    };
    return snapshot;
  }

  private getTarget(snapshotId: string, blockId: string): BlockTarget {
    const entry = this.entries.get(snapshotId);
    const target = entry?.targets.get(blockId);
    const current =
      target &&
      collectReadingGroups(target.root).find(
        (group) =>
          group.element === target.element &&
          group.nodes[0] === target.nodes[0],
      );
    if (
      !entry ||
      entry.snapshot.url !== location.href ||
      !target ||
      !target.element.isConnected ||
      !target.root.isConnected ||
      !current ||
      current.nodes.length !== target.nodes.length ||
      current.nodes.some((node, index) => node !== target.nodes[index]) ||
      !isVisibleContent(target.element) ||
      target.nodes.some(
        (node) =>
          !node.isConnected ||
          !target.element.contains(node) ||
          !node.parentElement ||
          !isVisibleContent(node.parentElement) ||
          isSensitiveElement(node.parentElement) ||
          node.parentElement.closest(FORM_CONTENT),
      ) ||
      target.nodes
        .map((node) => node.data)
        .join("")
        .replace(/\s+/g, " ")
        .trim() !== target.text
    ) {
      throw new Error("citationUnavailable");
    }
    return target;
  }

  getBlockNodes(snapshotId: string, blockId: string): Text[] {
    return this.getTarget(snapshotId, blockId).nodes;
  }

  locate(snapshotId: string, blockId: string): void {
    const target = this.getTarget(snapshotId, blockId);
    const first = target.nodes[0];
    const last = target.nodes.at(-1);
    if (!first || !last) throw new Error("citationUnavailable");
    this.clearHighlight();
    target.element.scrollIntoView({ block: "center", behavior: "instant" });
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const rect = range.getBoundingClientRect();
    const highlight = document.createElement("div");
    highlight.dataset.hyperpageUi = "citation";
    Object.assign(highlight.style, {
      position: "absolute",
      pointerEvents: "none",
      zIndex: "2147483646",
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      outline: "2px solid #0891b2",
      background: "rgba(8, 145, 178, 0.12)",
    });
    document.body.append(highlight);
    this.highlight = highlight;
    this.highlightTimer = setTimeout(() => this.clearHighlight(), 2500);
  }

  private clearHighlight(): void {
    clearTimeout(this.highlightTimer);
    this.highlight?.remove();
    this.highlight = null;
  }

  clear(): void {
    this.video.clear();
    this.entries.clear();
    this.clearHighlight();
  }
}
