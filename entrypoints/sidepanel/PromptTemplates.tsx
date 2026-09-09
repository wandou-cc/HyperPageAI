import { message as notify } from "@/components/ui/toast";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  Check,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  TEMPLATE_CATEGORIES,
  PROMPT_TEMPLATES_STORAGE_KEY,
  loadPromptTemplates,
  savePromptTemplates,
  type PromptTemplate,
  type TemplateCategory,
} from "../../shared/prompt-templates";
import { getTemplateVariables } from "../../shared/task-templates";
import type { Locale } from "../../shared/messages";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";
import { TemplateParameters } from "./TemplateParameters";

export function PromptTemplates({
  locale,
  disabled,
  onUse,
}: {
  locale: Locale;
  disabled: boolean;
  onUse: (prompt: string) => void;
}) {
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const [editor, setEditor] = useState<PromptTemplate | null>(null);
  const [parameters, setParameters] = useState<PromptTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setLoading(true);
      void loadPromptTemplates(locale)
        .then((items) => {
          if (active) {
            setTemplates(items);

          }
        })
        .catch((failure: unknown) => {
          if (active) {
            setTemplates(null);
            notify.error(formatError(locale, failure));
          }
        }).finally(() => { if (active) setLoading(false); });
    };
    const listener = (
      changes: Record<string, Browser.storage.StorageChange>,
      area: Browser.storage.AreaName,
    ) => {
      if (area === "local" && changes[PROMPT_TEMPLATES_STORAGE_KEY]) refresh();
    };
    refresh();
    browser.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(listener);
    };
  }, [locale]);

  async function mutate(
    change: (current: PromptTemplate[]) => PromptTemplate[],
  ): Promise<void> {
    if (blocked) return;
    setBusy(true);

    try {
      setTemplates(
        await savePromptTemplates(change(await loadPromptTemplates(locale))),
      );
      setEditor(null);
      setParameters(null);
    } catch (failure) {
      notify.error(formatError(locale, failure));
    } finally {
      setBusy(false);
    }
  }

  function useTemplate(template: PromptTemplate): void {

    setEditor(null);
    if (getTemplateVariables(template.prompt).length) {
      setParameters(template);
      return;
    }
    setParameters(null);
    onUse(template.prompt);
  }

  function move(id: string, offset: number): void {
    void mutate((current) => {
      const index = current.findIndex((item) => item.id === id);
      const item = current[index];
      if (!item || index + offset < 0 || index + offset >= current.length)
        throw new Error("templateUnavailable");
      const next = [...current];
      next.splice(index, 1);
      next.splice(index + offset, 0, item);
      return next;
    });
  }

  const visible = templates?.filter(
    (item) => category === "all" || item.category === category,
  );
  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      aria-label={t(locale, "promptTemplates")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t(locale, "promptTemplates")}
        </span>
        <IconTooltip label={t(locale, "manageTemplates")}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "manageTemplates")}
            aria-expanded={open}
            disabled={blocked}
            onClick={() => setOpen((current) => !current)}
          >
            <BookMarked />
          </Button>
        </IconTooltip>
      </div>
      {loading && <Spinner aria-label={t(locale, "processing")} />}
      {templates && (
        <div className="grid grid-cols-2 gap-1">
          {templates
            .filter((item) => item.favorite)
            .map((template) => (
              <IconTooltip key={template.id} label={template.name}>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 justify-start"
                  aria-label={`${t(locale, "applyTemplate")}: ${template.name}`}
                  disabled={blocked}
                  onClick={() => useTemplate(template)}
                >
                  <Star data-icon="inline-start" />
                  <span className="truncate">{template.name}</span>
                </Button>
              </IconTooltip>
            ))}
        </div>
      )}
      {parameters && !disabled && (
        <TemplateParameters
          action="apply"
          key={parameters.id}
          template={parameters.prompt}
          locale={locale}
          onCancel={() => setParameters(null)}
          onRun={(prompt) => {
            setParameters(null);
            onUse(prompt);
          }}
        />
      )}
      {open && templates && (
        <>
          <ToggleGroup
            value={[category]}
            variant="outline"
            size="sm"
            className="grid grid-cols-3"
            disabled={blocked}
            aria-label={t(locale, "templateCategory")}
            onValueChange={(values) => {
              const value = values[0];
              if (
                value === "all" ||
                TEMPLATE_CATEGORIES.some((item) => item === value)
              )
                setCategory(value as TemplateCategory | "all");
            }}
          >
            <ToggleGroupItem value="all">
              {t(locale, "allTemplates")}
            </ToggleGroupItem>
            {TEMPLATE_CATEGORIES.map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {t(locale, `templateCategory_${value}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() => {
              setParameters(null);
              setEditor({
                id: crypto.randomUUID(),
                name: "",
                prompt: "",
                category: "other",
                favorite: false,
              });
            }}
          >
            <Plus data-icon="inline-start" />
            {t(locale, "newTemplate")}
          </Button>
          {editor && (
            <form
              className="flex flex-col gap-3 border-y py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate((current) => {
                  const exists = current.some((item) => item.id === editor.id);
                  return exists
                    ? current.map((item) =>
                        item.id === editor.id ? editor : item,
                      )
                    : [...current, editor];
                });
              }}
            >
              <FieldGroup>
                <Field data-disabled={blocked}>
                  <FieldLabel htmlFor="template-name">
                    {t(locale, "templateName")}
                  </FieldLabel>
                  <Input
                    id="template-name"
                    maxLength={100}
                    required
                    autoFocus
                    disabled={blocked}
                    value={editor.name}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                  />
                </Field>
                <Field data-disabled={blocked}>
                  <FieldLabel htmlFor="template-prompt">
                    {t(locale, "templatePrompt")}
                  </FieldLabel>
                  <Textarea
                    id="template-prompt"
                    maxLength={12_000}
                    required
                    disabled={blocked}
                    value={editor.prompt}
                    onChange={(event) =>
                      setEditor({ ...editor, prompt: event.target.value })
                    }
                  />
                </Field>
                <Field data-disabled={blocked}>
                  <FieldLabel>{t(locale, "templateCategory")}</FieldLabel>
                  <ToggleGroup
                    value={[editor.category]}
                    variant="outline"
                    className="grid grid-cols-2"
                    disabled={blocked}
                    aria-label={t(locale, "templateCategory")}
                    onValueChange={(values) => {
                      const value = values[0];
                      if (TEMPLATE_CATEGORIES.some((item) => item === value))
                        setEditor({
                          ...editor,
                          category: value as TemplateCategory,
                        });
                    }}
                  >
                    {TEMPLATE_CATEGORIES.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {t(locale, `templateCategory_${value}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  <X data-icon="inline-start" />
                  {t(locale, "cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    blocked || !editor.name.trim() || !editor.prompt.trim()
                  }
                >
                  <Save data-icon="inline-start" />
                  {t(locale, "saveTemplate")}
                </Button>
              </div>
            </form>
          )}
          {visible?.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t(locale, "noTemplates")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          <ul className="flex max-h-72 flex-col divide-y overflow-y-auto">
            {visible?.map((template) => (
              <li
                key={template.id}
                className="flex min-w-0 flex-col gap-1 py-2"
              >
                <p className="break-words text-sm font-medium">
                  {template.name}
                </p>
                <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                  {template.prompt}
                </p>
                <div className="flex flex-wrap justify-end gap-1">
                  <IconTooltip label={t(locale, "applyTemplate")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "applyTemplate")}: ${template.name}`}
                      disabled={blocked}
                      onClick={() => useTemplate(template)}
                    >
                      <Check />
                    </Button>
                  </IconTooltip>
                  <IconTooltip label={t(locale, "favoriteTemplate")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "favoriteTemplate")}: ${template.name}`}
                      aria-pressed={template.favorite}
                      disabled={blocked}
                      onClick={() =>
                        void mutate((current) =>
                          current.map((item) =>
                            item.id === template.id
                              ? { ...item, favorite: !item.favorite }
                              : item,
                          ),
                        )
                      }
                    >
                      <Star
                        fill={template.favorite ? "currentColor" : "none"}
                      />
                    </Button>
                  </IconTooltip>
                  <IconTooltip label={t(locale, "moveTemplateUp")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "moveTemplateUp")}: ${template.name}`}
                      disabled={blocked || templates[0]?.id === template.id}
                      onClick={() => move(template.id, -1)}
                    >
                      <ArrowUp />
                    </Button>
                  </IconTooltip>
                  <IconTooltip label={t(locale, "moveTemplateDown")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "moveTemplateDown")}: ${template.name}`}
                      disabled={blocked || templates.at(-1)?.id === template.id}
                      onClick={() => move(template.id, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </IconTooltip>
                  <IconTooltip label={t(locale, "editTemplate")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "editTemplate")}: ${template.name}`}
                      disabled={blocked}
                      onClick={() => {
                        setEditor(template);
                        setParameters(null);
                      }}
                    >
                      <Pencil />
                    </Button>
                  </IconTooltip>
                  <IconTooltip label={t(locale, "deleteTemplate")}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${t(locale, "deleteTemplate")}: ${template.name}`}
                      disabled={blocked}
                      onClick={() =>
                        void mutate((current) =>
                          current.filter((item) => item.id !== template.id),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </IconTooltip>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
