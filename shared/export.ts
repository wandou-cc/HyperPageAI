import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { toString } from "mdast-util-to-string";
import type { RootContent } from "mdast";
import type { ConversationTurn } from "./conversations";
import { getTurnCitations } from "./conversations";
import type { PageCitation } from "./messages";
import { remarkCitations } from "./citations";

function plainBlock(node: RootContent): string {
  if (node.type === "html") return "";
  if (node.type === "code") return node.value;
  if (node.type === "table")
    return node.children
      .map((row) => row.children.map((cell) => toString(cell)).join("\t"))
      .join("\n");
  if (node.type === "list")
    return node.children
      .map(
        (item, index) =>
          `${node.ordered ? `${(node.start ?? 1) + index}.` : "-"} ${item.children.map(plainBlock).join("\n")}`,
      )
      .join("\n");
  if (node.type === "blockquote")
    return node.children.map(plainBlock).join("\n");
  return toString(node, { includeHtml: false });
}

export function markdownToText(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children.map(plainBlock).filter(Boolean).join("\n\n");
}

export function answerToMarkdown(
  answer: string,
  citations: PageCitation[],
): string {
  if (!citations.length) return answer;
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCitations, { citations, external: true })
    .use(remarkStringify);
  const markdown = String(processor.processSync(answer)).trim();
  const sources = citations.filter((citation) =>
    answer.includes(`[[${citation.id}]]`),
  );
  const notes = sources
    .map(
      (citation) =>
        `[${citation.blockId}] ${citation.title}\n${citation.url}\n${citation.pageNumber === undefined ? "" : `p. ${citation.pageNumber}\n`}${citation.heading}\n${citation.text}`,
    )
    .join("\n\n");
  return notes ? `${markdown}\n\n${notes}` : markdown;
}

export function conversationToMarkdown(
  turns: ConversationTurn[],
  labels: { user: string; assistant: string; incomplete: string },
): string {
  return turns
    .map((turn, index) => {
      return `## ${labels.user}\n\n${turn.prompt}\n\n## ${labels.assistant}\n\n${answerToMarkdown(turn.answer, getTurnCitations(turns, index))}${turn.status !== "complete" ? `\n\n${labels.incomplete}` : ""}`;
    })
    .join("\n\n---\n\n");
}

export function downloadText(
  content: string,
  filename: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Let the browser start consuming the download before revoking its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
