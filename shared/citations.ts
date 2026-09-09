import type { PhrasingContent, Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import type { PageCitation } from "./messages";
import { formatVideoTime } from "./video";

export const CITATION_PREFIX = "#hyperpage-source-";

// Transform only Markdown text nodes, leaving code, URLs and unknown IDs intact.
export function remarkCitations(options: { citations: PageCitation[]; external?: boolean }) {
  const sources = new Map(options.citations.map((citation) => [citation.id, citation]));
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "link" || node.type === "linkReference") return SKIP;
      if (node.type !== "text") return;
      if (index === undefined || !parent) return;
      const parts: PhrasingContent[] = [];
      let offset = 0;
      for (const match of node.value.matchAll(/\[\[([a-zA-Z0-9-]+:\d+\.\d+)\]\]/g)) {
        const source = match[1] && sources.get(match[1]);
        if (!source) continue;
        if (match.index > offset)
          parts.push({
            type: "text",
            value: node.value.slice(offset, match.index),
          });
        parts.push(options.external && !source.url ? { type: "text", value: `[${source.blockId}]` } : {
          type: "link",
          url: options.external ? source.url : `${CITATION_PREFIX}${match[1]}`,
          children: [{ type: "text", value: `[${source.timeSeconds === undefined ? source.blockId : formatVideoTime(source.timeSeconds)}]` }],
        });
        offset = match.index + match[0].length;
      }
      if (!parts.length) return;
      if (offset < node.value.length)
        parts.push({ type: "text", value: node.value.slice(offset) });
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
