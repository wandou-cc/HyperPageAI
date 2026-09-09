import { useState } from "react";
import { ExternalLink, FileText, Image, LocateFixed, RefreshCw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Locale } from "../../shared/messages";
import type { PageResource, ResourceCatalog } from "../../shared/page-resources";
import { IconTooltip } from "../sidepanel/ui";
import { t } from "../sidepanel/translations";

const kinds = ["document", "image", "video"] as const;
const icons = { document: FileText, image: Image, video: Video };

export function PageResourceList({ locale, catalog, scanning, disabled, error, onRefresh, onSelect, onReveal }: {
  locale: Locale;
  catalog: ResourceCatalog | null;
  scanning: boolean;
  disabled: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (resource: PageResource) => void;
  onReveal: (resource: PageResource) => void;
}) {
  const [kind, setKind] = useState("document");
  return <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label={t(locale, "pageResources")}>
    <div className="flex items-center gap-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={catalog?.title}>{catalog?.title || t(locale, "pageResources")}</h2>
      <IconTooltip label={t(locale, "refreshResources")}>
        <Button size="icon-sm" variant="ghost" aria-label={t(locale, "refreshResources")} disabled={disabled || scanning} onClick={onRefresh}>
          {scanning ? <Spinner /> : <RefreshCw />}
        </Button>
      </IconTooltip>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : scanning && !catalog ? <div role="status" className="text-sm text-muted-foreground">{t(locale, "scanningResources")}</div> : (
      <Tabs value={kind} onValueChange={setKind} className="min-h-0 flex-1">
        <TabsList className="grid w-full shrink-0 grid-cols-3">
          {kinds.map((item) => <TabsTrigger key={item} value={item}>{t(locale, `resourceKind_${item}`)} {catalog?.resources.filter((resource) => resource.kind === item).length ?? 0}</TabsTrigger>)}
        </TabsList>
        {kinds.map((item) => {
          const resources = catalog?.resources.filter((resource) => resource.kind === item) ?? [];
          const Icon = icons[item];
          return <TabsContent key={item} value={item} className="min-h-0 overflow-y-auto">
            {resources.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{t(locale, "noPageResources")}</EmptyTitle></EmptyHeader></Empty> : (
              <ul className="divide-y">
                {resources.map((resource) => <li key={resource.id} className="flex min-w-0 items-center gap-2 py-3">
                  {resource.kind === "image" && resource.url ? (
                    <img
                      src={resource.url}
                      alt={resource.name}
                      loading="lazy"
                      decoding="async"
                      className="h-20 w-28 shrink-0 rounded-sm border object-contain"
                    />
                  ) : (
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <button type="button" className="break-words text-left text-sm font-medium hover:underline disabled:no-underline disabled:opacity-60" disabled={disabled || scanning || !resource.reader} onClick={() => onSelect(resource)}>{resource.name}</button>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{resource.format.toUpperCase()}</Badge>
                      <span>{t(locale, resource.reader === "youtube" ? "resourceExtractCaptions" : resource.reader === "transcript" ? "resourceTranscript" : resource.reader ? "resourceReadable" : item === "video" ? "resourceNoTranscript" : "resourceOpenOnly")}</span>
                    </div>
                  </div>
                  <IconTooltip label={t(locale, "locateResource")}>
                    <Button size="icon-xs" variant="ghost" aria-label={t(locale, "locateResource")} disabled={disabled || scanning} onClick={() => onReveal(resource)}><LocateFixed /></Button>
                  </IconTooltip>
                  {resource.url && <IconTooltip label={t(locale, "openResource")}>
                    <Button size="icon-xs" variant="ghost" role="link" aria-label={t(locale, "openResource")} nativeButton={false} render={<a href={resource.url} target="_blank" rel="noreferrer" />}><ExternalLink /></Button>
                  </IconTooltip>}
                </li>)}
              </ul>
            )}
          </TabsContent>;
        })}
      </Tabs>
    )}
  </section>;
}
