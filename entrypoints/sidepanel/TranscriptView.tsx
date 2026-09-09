import { useMemo, useState } from "react";
import { AlignLeft, ListVideo } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Locale, PageContentBlock } from "../../shared/messages";
import { getTranscriptParagraphs } from "../../shared/video";
import { SourceTextView } from "./SourceTextView";
import { t } from "./translations";

export function TranscriptView({ locale, blocks, selectedIds, onSelect, disabled, className }: {
  locale: Locale;
  blocks: readonly PageContentBlock[];
  selectedIds: readonly string[];
  onSelect: (ids: string[]) => void;
  disabled: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<"timestamps" | "body">("timestamps");
  const paragraphs = useMemo(() => mode === "body" ? getTranscriptParagraphs(blocks).map((text, index) => ({
    id: `body.${index}`, text, heading: "", headingLevel: null,
  })) : [], [blocks, mode]);
  return <div className={cn("flex min-h-0 min-w-0 flex-col gap-2", className)}>
    <ToggleGroup value={[mode]} onValueChange={(values) => {
      const value = values[0];
      if (value === "timestamps" || value === "body") setMode(value);
    }} variant="outline" size="sm" spacing={0} aria-label={t(locale, "transcriptDisplay")} className="shrink-0">
      <ToggleGroupItem value="timestamps"><ListVideo />{t(locale, "transcriptTimestamps")}</ToggleGroupItem>
      <ToggleGroupItem value="body"><AlignLeft />{t(locale, "transcriptBody")}</ToggleGroupItem>
    </ToggleGroup>
    {mode === "timestamps"
      ? <SourceTextView key="timestamps" locale={locale} blocks={blocks} selectedIds={selectedIds} onSelect={onSelect} disabled={disabled} className="flex-1" />
      : <SourceTextView key="body" locale={locale} blocks={paragraphs} className="mx-auto w-full max-w-3xl flex-1" />}
  </div>;
}
