import { useId, useState } from "react";
import { Check, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  fillTemplate,
  getTemplateVariables,
} from "../../shared/task-templates";
import type { Locale } from "../../shared/messages";
import { t } from "./translations";

export function TemplateParameters({
  template,
  locale,
  action,
  onRun,
  onCancel,
}: {
  template: string;
  locale: Locale;
  action: "run" | "apply";
  onRun: (task: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const names = getTemplateVariables(template);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(names.map((name) => [name, ""])),
  );
  const complete = names.every((name) => values[name]?.trim());
  const task = complete ? fillTemplate(template, values) : null;
  return (
    <section
      className="flex min-w-0 flex-col gap-3 border-y py-3"
      aria-label={t(
        locale,
        action === "run" ? "taskParameters" : "templateParameters",
      )}
    >
      <h2 className="text-sm font-medium">
        {t(locale, action === "run" ? "taskParameters" : "templateParameters")}
      </h2>
      <FieldGroup>
        {names.map((name, index) => (
          <Field key={name}>
            <FieldLabel htmlFor={`${id}-${index}`}>{name}</FieldLabel>
            <Input
              id={`${id}-${index}`}
              autoFocus={index === 0}
              required
              value={values[name]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </FieldGroup>
      {task && (
        <pre
          className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs"
          aria-label={t(locale, action === "run" ? "pageTask" : "templatePrompt")}
        >
          {task}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          <X data-icon="inline-start" />
          {t(locale, "cancel")}
        </Button>
        <Button
          disabled={!task}
          onClick={() => {
            if (task) onRun(task);
          }}
        >
          {action === "run" ? (
            <Play data-icon="inline-start" />
          ) : (
            <Check data-icon="inline-start" />
          )}
          {t(locale, action === "run" ? "startPageTask" : "applyTemplate")}
        </Button>
      </div>
    </section>
  );
}
