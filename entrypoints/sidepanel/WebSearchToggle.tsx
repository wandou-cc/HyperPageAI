import { useId } from "react";
import { Globe } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { CapabilityResult, Locale } from "../../shared/messages";
import { t } from "./translations";
import { IconTooltip } from "./ui";

export function WebSearchToggle({ locale, capability, checked, disabled, onChange }: {
  locale: Locale;
  capability: CapabilityResult | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const supported = capability?.status === "supported";
  return (
    <IconTooltip label={t(locale, supported ? "webSearch" : "webSearchCheckRequired")}>
      <span className="inline-flex min-w-0" tabIndex={supported ? undefined : 0}>
        <Field orientation="horizontal" className="w-auto gap-1.5" data-disabled={disabled || !supported}>
          <Switch id={id} size="sm" checked={checked && supported} disabled={disabled || !supported} onCheckedChange={onChange} />
          <FieldLabel htmlFor={id} className="gap-1 whitespace-nowrap"><Globe className="size-3.5" />{t(locale, "webSearch")}</FieldLabel>
        </Field>
      </span>
    </IconTooltip>
  );
}
