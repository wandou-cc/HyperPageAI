import {
  FileText,
  ListTree,
  RefreshCw,
  Sparkles,
  TableProperties,
  ScanText,
  X,
} from "lucide-react";
import { useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { FileReadingSnapshot, Locale, PageReadingSnapshot } from "../../shared/messages";
import { getReadingCharacters } from "../../shared/page-reading";
import { t } from "./translations";
import { IconTooltip } from "./ui";
import { SourceTextView } from "./SourceTextView";
import { TranscriptView } from "./TranscriptView";

interface ReadingContextProps {
  locale: Locale;
  snapshot: PageReadingSnapshot | FileReadingSnapshot | null;
  sourceType?: "page" | "file" | "video";
  selectedIds: string[];
  loading: boolean;
  disabled: boolean;
  onRead?: () => void;
  onSelect: (ids: string[]) => void;
  onPrompt?: (prompt: string) => void;
  onClear?: () => void;
}

export function ReadingContext({
  locale,
  snapshot,
  sourceType = "page",
  selectedIds,
  loading,
  disabled,
  onRead,
  onSelect,
  onPrompt,
  onClear,
}: ReadingContextProps) {
  const id = useId();
  const characters = useMemo(() => snapshot ? getReadingCharacters(snapshot, selectedIds) : 0, [snapshot, selectedIds]);
  return (
    <section
      aria-label={t(locale, sourceType === "video" ? "videoContext" : sourceType === "file" ? "fileContext" : "currentPageContext")}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" role="status">
          {characters.toLocaleString()}{" "}
          {t(locale, "characters")}
        </span>
        {onRead && <IconTooltip label={t(locale, sourceType === "video" ? "readVideoTranscript" : sourceType === "file" ? "chooseTextFile" : "readCurrentPage")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, sourceType === "video" ? "readVideoTranscript" : sourceType === "file" ? "chooseTextFile" : "readCurrentPage")}
            disabled={disabled || loading}
            onClick={onRead}
          >
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        </IconTooltip>}
        {onClear && <IconTooltip label={t(locale, "clearFileContext")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "clearFileContext")} disabled={disabled || loading || !snapshot} onClick={onClear}><X /></Button></IconTooltip>}
      </div>
      {snapshot && (
        <>
          <div className="min-w-0 text-xs break-words">
            <div className="font-medium">{"title" in snapshot ? snapshot.title : snapshot.name}</div>
            {"url" in snapshot && <div className="text-muted-foreground">{snapshot.url}</div>}
          </div>
          <FieldSet disabled={disabled || loading} className="gap-2">
            <FieldLegend variant="label">
              {t(locale, "readingRange")}
            </FieldLegend>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-all`}
                checked={selectedIds.length === snapshot.blocks.length}
                indeterminate={
                  selectedIds.length > 0 &&
                  selectedIds.length < snapshot.blocks.length
                }
                onCheckedChange={(checked) =>
                  onSelect(
                    checked ? snapshot.blocks.map((block) => block.id) : [],
                  )
                }
              />
              <FieldLabel htmlFor={`${id}-all`}>
                {t(locale, "selectAllBlocks")}
              </FieldLabel>
            </Field>
            {sourceType === "video"
              ? <TranscriptView key={snapshot.id} locale={locale} blocks={snapshot.blocks} selectedIds={selectedIds} onSelect={onSelect} disabled={disabled || loading} className="h-80" />
              : <SourceTextView key={snapshot.id} locale={locale} blocks={snapshot.blocks} selectedIds={selectedIds} onSelect={onSelect} disabled={disabled || loading} className="h-64" />}
          </FieldSet>
          {sourceType !== "video" && onPrompt && <div className="flex flex-wrap gap-1">
            {(
              [
                ["summarize", "pageSummaryPrompt", FileText],
                ["pageKeyPoints", "pageKeyPointsPrompt", Sparkles],
                ["pageOutline", "pageOutlinePrompt", ListTree],
                ["pageExtract", "pageExtractPrompt", TableProperties],
                ["pageType", "pageTypePrompt", ScanText],
              ] as const
            ).map(([label, prompt, Icon]) => (
              <Button
                key={label}
                size="xs"
                variant="outline"
                disabled={
                  disabled ||
                  loading ||
                  !characters
                }
                onClick={() => onPrompt(t(locale, sourceType === "file" ? `${prompt}File` : prompt))}
              >
                <Icon data-icon="inline-start" />
                {t(locale, label)}
              </Button>
            ))}
          </div>}
        </>
      )}
    </section>
  );
}
