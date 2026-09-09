import { useEffect, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Locale } from "../../shared/messages";
import { t } from "./translations";

export function SourceWorkspace({ locale, children, conversation, view, onViewChange }: {
  locale: Locale;
  children: ReactNode;
  conversation: ReactNode;
  view: string;
  onViewChange: (view: string) => void;
}) {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const visibleOnDesktop = wide ? { hidden: false, inert: false, tabIndex: 0 } : {};
  return (
    <Tabs value={view} onValueChange={onViewChange} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="mb-3 grid w-full shrink-0 grid-cols-2 lg:hidden">
        <TabsTrigger value="sources">{t(locale, "sourceWorkspace")}</TabsTrigger>
        <TabsTrigger value="conversation">{t(locale, "answerWorkspace")}</TabsTrigger>
      </TabsList>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-5">
        <TabsContent value="sources" keepMounted {...visibleOnDesktop} className="min-h-0 overflow-y-auto data-[hidden]:hidden lg:data-[hidden]:block">
          {children}
        </TabsContent>
        <TabsContent value="conversation" keepMounted {...visibleOnDesktop} className="min-h-0 data-[hidden]:hidden lg:data-[hidden]:block">
          {conversation}
        </TabsContent>
      </div>
    </Tabs>
  );
}
