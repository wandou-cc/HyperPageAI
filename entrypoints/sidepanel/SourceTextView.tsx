import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FileContentBlock, Locale, PageContentBlock } from "../../shared/messages";
import { t } from "./translations";

type SourceBlock = PageContentBlock | FileContentBlock;
type SourceRow =
  | { id: string; pageNumber: number; empty: boolean }
  | { id: string; block: SourceBlock; text: string; first: boolean };

export interface SourceTextViewHandle {
  scrollToBlock: (blockId: string) => boolean;
  scrollToPage: (pageNumber: number) => boolean;
}

export function SourceTextView({ blocks, pageCount, locale, selectedIds, onSelect, disabled, className, ref }: {
  blocks: readonly SourceBlock[];
  pageCount?: number;
  locale: Locale;
  selectedIds?: readonly string[];
  onSelect?: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  ref?: Ref<SourceTextViewHandle>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rows = useMemo(() => {
    const result: SourceRow[] = [];
    const addBlock = (block: SourceBlock) => {
      // Bound text layout work even when the source contains one enormous paragraph.
      for (let offset = 0; offset < block.text.length;) {
        let end = Math.min(offset + 2_000, block.text.length);
        if (end < block.text.length && /[\uD800-\uDBFF]/.test(block.text.charAt(end - 1))) end--;
        result.push({ id: `${block.id}:${offset}`, block, text: block.text.slice(offset, end), first: offset === 0 });
        offset = end;
      }
    };
    if (pageCount !== undefined) {
      const pages = new Map<number, SourceBlock[]>();
      for (const block of blocks) {
        if (!("pageNumber" in block)) throw new Error("fileContextRequired");
        const page = pages.get(block.pageNumber);
        if (page) page.push(block);
        else pages.set(block.pageNumber, [block]);
      }
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const page = pages.get(pageNumber);
        result.push({ id: `page:${pageNumber}`, pageNumber, empty: !page?.length });
        page?.forEach(addBlock);
      }
    } else blocks.forEach(addBlock);
    return result;
  }, [blocks, pageCount]);
  const getItemKey = useCallback((index: number) => {
    const row = rows[index];
    if (!row) throw new Error("citationUnavailable");
    return row.id;
  }, [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    getItemKey,
    estimateSize: () => 104,
    overscan: 4,
    useAnimationFrameWithResizeObserver: true,
  });
  const items = virtualizer.getVirtualItems();
  useImperativeHandle(ref, () => {
    const scrollTo = (index: number) => {
      const row = rows[index];
      if (!row) return false;
      virtualizer.scrollToIndex(index, { align: "start" });
      setFocusRow(row.id);
      return true;
    };
    return {
      scrollToBlock: (blockId) => scrollTo(rows.findIndex((row) => "block" in row && row.block.id === blockId)),
      scrollToPage: (pageNumber) => scrollTo(rows.findIndex((row) => "pageNumber" in row && row.pageNumber === pageNumber)),
    };
  }, [rows, virtualizer]);
  useLayoutEffect(() => {
    if (!focusRow) return;
    const row = Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-source-row]") ?? [])
      .find((element) => element.dataset.sourceRow === focusRow);
    if (row) { row.focus({ preventScroll: true }); setFocusRow(null); }
  }, [focusRow, items]);
  return <div ref={scroller} role="list" aria-label={t(locale, "documentSource")} tabIndex={0} data-source-list className={cn("min-h-0 min-w-0 overflow-y-auto", className)}>
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const row = rows[item.index];
        if (!row) throw new Error("citationUnavailable");
        return <div key={item.key} ref={virtualizer.measureElement} role="listitem" aria-posinset={item.index + 1} aria-setsize={rows.length} data-index={item.index} data-source-row={row.id} tabIndex={-1}
          className="absolute left-0 top-0 w-full min-w-0 py-2" style={{ transform: `translateY(${item.start}px)` }}>
          {"pageNumber" in row ? <>
            <h2 className="text-xs font-medium text-muted-foreground">{t(locale, "pdfPage")} {row.pageNumber}</h2>
            {row.empty && <p className="mt-2 text-sm text-muted-foreground">{t(locale, "pdfPageNoText")}</p>}
          </> : <div className="flex min-w-0 items-start gap-2">
            {onSelect && <div className="w-4 shrink-0">
              {row.first && <Checkbox aria-label={`${t(locale, "readingBlock")} ${row.block.id}`} checked={selected.has(row.block.id)} disabled={disabled} onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(row.block.id);
                else next.delete(row.block.id);
                onSelect(Array.from(next));
              }} />}
            </div>}
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {row.first && row.block.heading && <div className="mb-1 text-xs text-muted-foreground">{row.block.heading}</div>}
              <p className="whitespace-pre-wrap text-sm leading-6">{row.text}</p>
            </div>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
