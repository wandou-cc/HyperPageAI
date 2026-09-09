import { ListPlus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Locale, PageReadingSnapshot } from "../../shared/messages";
import { getReadingCharacters } from "../../shared/page-reading";
import { t } from "./translations";
import { IconTooltip } from "./ui";
import { SourceTextView } from "./SourceTextView";

export function ElementsContext({ locale, pages, disabled, loading, onAdd, onRemove, onClear }: {
  locale: Locale;
  pages: PageReadingSnapshot[];
  disabled: boolean;
  loading: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [openPages, setOpenPages] = useState<Set<string>>(() => new Set());
  const counts = useMemo(() => pages.map((page) => getReadingCharacters(page)), [pages]);
  const characters = counts.reduce((sum, count) => sum + count, 0);
  return <section aria-label={t(locale, "attachedPageContent")} className="flex min-w-0 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs" variant="outline" disabled={disabled || loading} onClick={onAdd}>
        {loading ? <Spinner data-icon="inline-start" /> : <ListPlus data-icon="inline-start" />}
        {t(locale, "addContextElement")}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">{characters.toLocaleString()} {t(locale, "characters")}</span>
      <IconTooltip label={t(locale, "clearContextElements")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "clearContextElements")} disabled={disabled || loading || !pages.length} onClick={onClear}><Trash2 /></Button></IconTooltip>
    </div>
    <div className="flex max-h-52 flex-col gap-2 overflow-y-auto">
      {pages.map((page, index) => <div key={page.id} className="flex min-w-0 items-start gap-2">
        <details className="min-w-0 flex-1 text-xs break-words" onToggle={(event) => {
          const open = event.currentTarget.open;
          setOpenPages((current) => {
            const next = new Set(current);
            if (open) next.add(page.id);
            else next.delete(page.id);
            return next;
          });
        }}>
          <summary>{index + 1}. {page.title} ({counts[index]?.toLocaleString()} {t(locale, "characters")})</summary>
          <div className="text-muted-foreground">{page.url}</div>
          {openPages.has(page.id) && <SourceTextView locale={locale} blocks={page.blocks} className="h-48" />}
        </details>
        <IconTooltip label={t(locale, "removeContextElement")}><Button size="icon-xs" variant="ghost" aria-label={`${t(locale, "removeContextElement")} ${index + 1}`} disabled={disabled || loading} onClick={() => onRemove(page.id)}><X /></Button></IconTooltip>
      </div>)}
    </div>
  </section>;
}
