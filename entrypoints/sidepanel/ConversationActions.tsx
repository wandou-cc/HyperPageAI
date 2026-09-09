import { ArrowLeft, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "../../shared/messages";
import { t } from "./translations";

export function ConversationActions({
  locale,
  libraryOpen,
  disabled,
  newDisabled,
  onToggleLibrary,
  onNew,
}: {
  locale: Locale;
  libraryOpen: boolean;
  disabled: boolean;
  newDisabled: boolean;
  onToggleLibrary: () => void;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={libraryOpen}
        disabled={disabled}
        onClick={onToggleLibrary}
      >
        {libraryOpen ? (
          <ArrowLeft data-icon="inline-start" />
        ) : (
          <History data-icon="inline-start" />
        )}
        {t(locale, libraryOpen ? "backToConversation" : "conversationHistory")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={newDisabled}
        onClick={onNew}
      >
        <Plus data-icon="inline-start" />
        {t(locale, "newConversation")}
      </Button>
    </div>
  );
}
