import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Locale } from "../../shared/messages";
import {
  WRITING_MODES,
  writingNeedsSource,
  type WritingOptions,
} from "../../shared/writing";
import { t } from "./translations";
import { AiComposer } from "./AiComposer";

export function WritingTools({
  locale,
  disabled,
  hasSource,
  onRun,
  running,
  onStop,
}: {
  locale: Locale;
  disabled: boolean;
  hasSource: boolean;
  onRun: (options: WritingOptions) => void;
  running: boolean;
  onStop: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [options, setOptions] = useState<WritingOptions>({
    mode: "rewrite",
    tone: "",
    targetLength: null,
    instruction: "",
  });
  const modes = WRITING_MODES.map((mode) => ({
    value: mode,
    label: t(locale, `writing_${mode}`),
  }));
  const canSubmit = hasSource || (!writingNeedsSource(options.mode) && Boolean(options.instruction.trim()));
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="writing-heading">
      <h2 id="writing-heading" className="text-sm font-medium">
        {t(locale, "writingAssistant")}
      </h2>
      <form
        ref={form}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !running && canSubmit) onRun(options);
        }}
      >
        <FieldGroup>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="writing-mode">
              {t(locale, "writingMode")}
            </FieldLabel>
            <Select
              items={modes}
              disabled={disabled}
              value={options.mode}
              onValueChange={(mode) => {
                if (mode !== null) setOptions({ ...options, mode });
              }}
            >
              <SelectTrigger id="writing-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {modes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="writing-tone">
              {t(locale, "writingTone")}
            </FieldLabel>
            <Input
              id="writing-tone"
              value={options.tone}
              disabled={disabled}
              maxLength={100}
              onChange={(event) =>
                setOptions({ ...options, tone: event.target.value })
              }
            />
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="writing-length">
              {t(locale, "writingLength")}
            </FieldLabel>
            <Input
              id="writing-length"
              type="number"
              min={20}
              max={3000}
              step={1}
              value={options.targetLength ?? ""}
              disabled={disabled}
              onChange={(event) =>
                setOptions({
                  ...options,
                  targetLength:
                    event.target.value === ""
                      ? null
                      : event.target.valueAsNumber,
                })
              }
            />
          </Field>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="writing-instruction">
              {t(locale, "writingRequirements")}
            </FieldLabel>
            <AiComposer
              id="writing-instruction"
              locale={locale}
              value={options.instruction}
              disabled={disabled}
              running={running}
              onStop={onStop}
              canSubmit={canSubmit}
              submitLabel={t(locale, "generateWriting")}
              submitIcon={Pencil}
              onSubmit={() => form.current?.requestSubmit()}
              maxLength={4000}
              onChange={(event) =>
                setOptions({ ...options, instruction: event.target.value })
              }
            />
          </Field>
        </FieldGroup>
      </form>
    </section>
  );
}
