import { useMemo } from "react";
import type { ChatContextSnapshot, Locale, PageContentBlock } from "../../shared/messages";
import { SourceTextView } from "./SourceTextView";
import { t } from "./translations";

export function SnapshotPreview({ snapshot, locale }: { snapshot: ChatContextSnapshot; locale: Locale }) {
  const blocks = useMemo<PageContentBlock[]>(() => {
    switch (snapshot.type) {
      case "page": return snapshot.page.blocks;
      case "file": return snapshot.file.blocks;
      case "elements": return snapshot.pages.flatMap((page) => page.blocks.map((block) => ({
        ...block, id: `${page.id}:${block.id}`, heading: [page.title, page.url, block.heading].filter(Boolean).join("\n"),
      })));
      case "selection": return [{ id: "selection", text: snapshot.selection.text, heading: snapshot.selection.accessibleName, headingLevel: null }];
      default: return [];
    }
  }, [snapshot]);
  if (snapshot.type === "none") return <p>{t(locale, "noPageContext")}</p>;
  if (snapshot.type === "image") return <img src={snapshot.image.dataUrl} alt={snapshot.image.name} className="max-h-32 max-w-full object-contain" />;
  return <div className="flex min-w-0 flex-col gap-1">
    {snapshot.type === "page" && <><div>{snapshot.page.title}</div><div className="text-muted-foreground">{snapshot.page.url}</div></>}
    {snapshot.type === "file" && <div>{snapshot.file.name}</div>}
    <SourceTextView locale={locale} blocks={blocks} className="h-32" />
  </div>;
}
