import { useEffect, useMemo, useRef, useState } from "react";
import { Check, PanelBottom, Replace, TextCursorInput, X } from "lucide-react";
import { diffWordsWithSpace } from "diff";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { message as notify } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  BackgroundRequest,
  CommandResult,
  EditablePreview,
  Locale,
  PageEditingCommand,
  PageEditingResults,
  PageState,
} from "../../shared/messages";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";

async function edit<C extends PageEditingCommand>(
  command: C,
): Promise<PageEditingResults[C["type"]]> {
  const result = (await browser.runtime.sendMessage({
    target: "background",
    type: "editing-command",
    command,
  } satisfies BackgroundRequest)) as CommandResult<
    PageEditingResults[C["type"]]
  >;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function ResultActions({
  text,
  locale,
  state,
  disabled,
  onState,
  onError,
}: {
  text: string;
  locale: Locale;
  state: PageState;
  disabled: boolean;
  onState: (state: PageState) => void;
  onError: (error: string) => void;
}) {
  const [preview, setPreview] = useState<EditablePreview | null>(null);
  const [view, setView] = useState<"diff" | "before" | "after">("diff");
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const changes = useMemo(
    () =>
      preview
        ? diffWordsWithSpace(preview.before, preview.after, { timeout: 200 })
        : [],
    [preview],
  );
  useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (changes === undefined) onError(t(locale, "editDiffTooLarge"));
  }, [changes, locale, onError]);

  async function prepare(mode: "replace" | "insert"): Promise<void> {
    setBusy(true);

    try {
      setPreview(
        await edit({
          type: "prepare-edit",
          mode,
          text,
          selectionRevision: state.selectionRevision,
        }),
      );
      setView("diff");
    } catch (failure) {
      onError(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!preview) return;
    setBusy(true);

    try {
      const next = await edit({ type: "apply-edit", previewId: preview.id });
      setPreview(null);
      onState(next);
      notify.success(t(locale, "contentUpdated"));
    } catch (failure) {
      onError(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    try {
      await edit({ type: "cancel-edit", previewId: preview.id });
      setPreview(null);
    } catch (failure) {
      onError(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  async function insertBelow(): Promise<void> {
    setBusy(true);

    try {
      const response = (await browser.runtime.sendMessage({
        target: "background",
        type: "page-command",
        command: { type: "insert-result", text },
      } satisfies BackgroundRequest)) as CommandResult<PageState>;
      if (!response.ok) throw new Error(response.error);
      onState(response.data);
      notify.success(t(locale, "inserted"));
    } catch (failure) {
      onError(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  const blocked = disabled || busy;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <IconTooltip label={t(locale, "insertBelow")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "insertBelow")}
            disabled={blocked || !state.selection || preview !== null}
            onClick={() => void insertBelow()}
          >
            <PanelBottom />
          </Button>
        </IconTooltip>
        <IconTooltip label={t(locale, "replaceField")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "replaceField")}
            disabled={blocked || !state.selection?.editable || preview !== null}
            onClick={() => void prepare("replace")}
          >
            <Replace />
          </Button>
        </IconTooltip>
        <IconTooltip label={t(locale, "insertAtCursor")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "insertAtCursor")}
            disabled={blocked || !state.selection?.editable || preview !== null}
            onClick={() => void prepare("insert")}
          >
            <TextCursorInput />
          </Button>
        </IconTooltip>
      </div>
      {preview && (
        <section
          ref={previewRef}
          tabIndex={-1}
          aria-label={t(locale, "editPreview")}
          className="flex min-w-0 flex-col gap-2 border-y py-2"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !blocked) {
              event.stopPropagation();
              void cancel();
            }
          }}
        >
          <ToggleGroup
            value={[view]}
            variant="outline"
            size="sm"
            className="grid grid-cols-3"
            aria-label={t(locale, "editPreview")}
            disabled={blocked}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "diff" || next === "before" || next === "after")
                setView(next);
            }}
          >
            <ToggleGroupItem value="diff">
              {t(locale, "editChanges")}
            </ToggleGroupItem>
            <ToggleGroupItem value="before">
              {t(locale, "editBefore")}
            </ToggleGroupItem>
            <ToggleGroupItem value="after">
              {t(locale, "editAfter")}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-sm">
            {view === "before" ? (
              preview.before
            ) : view === "after" ? (
              preview.after
            ) : changes !== undefined && (
              changes.map((change, index) =>
                change.added ? (
                  <ins key={index} className="bg-accent underline decoration-2">
                    {change.value}
                  </ins>
                ) : change.removed ? (
                  <del
                    key={index}
                    className="bg-destructive/10 text-destructive"
                  >
                    {change.value}
                  </del>
                ) : (
                  <span key={index}>{change.value}</span>
                ),
              )
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => void cancel()}
            >
              <X data-icon="inline-start" />
              {t(locale, "cancel")}
            </Button>
            <Button disabled={blocked} onClick={() => void confirm()}>
              <Check data-icon="inline-start" />
              {t(locale, "confirmEdit")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
