import { useMemo, useState } from "react";
import { Copy, LocateFixed } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import type { Locale, PageCitation } from "../../shared/messages";
import { CITATION_PREFIX, remarkCitations } from "../../shared/citations";
import { t } from "./translations";
import { IconTooltip } from "./ui";
import { SourceTextView } from "./SourceTextView";

interface ReadingAnswerProps {
  content: string;
  citations: PageCitation[];
  locale: Locale;
  onLocate: (citation: PageCitation) => Promise<boolean>;
  onCopy: (text: string) => void;
}

export function ReadingAnswer({
  content,
  citations,
  locale,
  onLocate,
  onCopy,
}: ReadingAnswerProps) {
  const [active, setActive] = useState<PageCitation | null>(null);
  const sourceBlocks = useMemo(() => active ? [{ ...active, heading: "" }] : [], [active]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  async function locate(citation: PageCitation): Promise<void> {
    setActive(citation);
    if (!(await onLocate(citation)))
      setUnavailable((ids) => [...ids, citation.id]);
  }
  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkCitations, { citations }]]}
        components={{
          a: ({ href, children, node: _node, ...props }) => {
            if (href?.startsWith(CITATION_PREFIX)) {
              const citation = citations.find(
                (item) => `${CITATION_PREFIX}${item.id}` === href,
              );
              if (!citation) return <span>{children}</span>;
              return (
                <button
                  type="button"
                  className="inline text-primary underline underline-offset-2"
                  title={citation.heading || citation.title}
                  onClick={() => void locate(citation)}
                >
                  {children}
                </button>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
      {active && (
        <div className="mt-2 flex min-w-0 flex-col gap-1 border-l-2 border-border pl-2 text-xs break-words">
          <div className="font-medium">
            [{active.blockId}] {active.title}
          </div>
          {active.heading && <div>{active.heading}</div>}
          {active.pageNumber && <div>{t(locale, "pdfPage")} {active.pageNumber}</div>}
          <div className="text-muted-foreground">{active.url}</div>
          <SourceTextView key={active.id} locale={locale} blocks={sourceBlocks} className="h-32" />
          <div className="flex gap-1">
            <IconTooltip label={t(locale, "locateSource")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t(locale, "locateSource")}
                disabled={unavailable.includes(active.id)}
                onClick={() => void locate(active)}
              >
                <LocateFixed />
              </Button>
            </IconTooltip>
            <IconTooltip label={t(locale, "copySource")}>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t(locale, "copySource")}
                onClick={() =>
                  onCopy(
                    `${active.title}\n${active.url}\n${active.pageNumber ? `${t(locale, "pdfPage")} ${active.pageNumber}\n` : ""}${active.heading}\n${active.text}`,
                  )
                }
              >
                <Copy />
              </Button>
            </IconTooltip>
          </div>
        </div>
      )}
    </>
  );
}
