import type { ComponentProps, ReactNode } from "react";
import { Send, Square, type LucideIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Locale } from "../../shared/messages";
import { t } from "./translations";
import { IconTooltip } from "./ui";

type AiComposerProps = Omit<ComponentProps<typeof InputGroupTextarea>, "onSubmit" | "onKeyDown" | "children"> & {
  locale: Locale;
  canSubmit: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  submitIcon?: LucideIcon;
  running?: boolean;
  onStop?: () => void;
  stopLabel?: string;
  toolbar?: ReactNode;
  overlay?: ReactNode;
};

export function AiComposer({
  locale,
  canSubmit,
  onSubmit,
  submitLabel = t(locale, "sendMessage"),
  submitIcon: SubmitIcon = Send,
  running = false,
  onStop,
  stopLabel = t(locale, "stopGenerating"),
  toolbar,
  overlay,
  disabled,
  className,
  ...inputProps
}: AiComposerProps) {
  const submitDisabled = disabled || running || !canSubmit;
  function submit(): void {
    if (!submitDisabled) onSubmit();
  }
  return (
    <InputGroup data-ai-composer>
      <div className="relative w-full">
        {overlay}
        <InputGroupTextarea
          {...inputProps}
          className={cn("relative min-h-16 max-h-36", className)}
          disabled={disabled || running}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <InputGroupAddon align="block-end" className="flex-wrap">
        {toolbar}
        {running && onStop ? (
          <IconTooltip label={stopLabel}>
            <InputGroupButton className="ml-auto" size="icon-sm" variant="destructive" aria-label={stopLabel} onClick={onStop}>
              <Square />
            </InputGroupButton>
          </IconTooltip>
        ) : (
          <IconTooltip label={submitLabel}>
            <InputGroupButton className="ml-auto" size="icon-sm" variant="default" aria-label={submitLabel} disabled={submitDisabled} onClick={submit}>
              {running ? <Spinner /> : <SubmitIcon />}
            </InputGroupButton>
          </IconTooltip>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
