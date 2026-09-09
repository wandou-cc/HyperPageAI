import { useEffect, useMemo, useState } from "react";
import { message as notify } from "@/components/ui/toast";
import { copyText } from "../../shared/clipboard";
import { ChevronDown, Copy, Languages, Plus, RotateCcw, Save, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Locale, PageReadingSnapshot } from "../../shared/messages";
import { getReadingCharacters } from "../../shared/page-reading";
import { loadTranslationTerms, saveTranslationTerms, type PageTranslationCommand, type PageTranslationResult, type TranslationDisplayMode, type TranslationTerm } from "../../shared/page-translation";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";
import { TextExport } from "./TextExport";
import { SourceTextView } from "./SourceTextView";

export interface TranslationPreview { source: PageReadingSnapshot; result: PageTranslationResult }

export function PageTranslationTools({ locale, source, targetLanguage, preview, mode, disabled, running, onRun, onCommand, onCancel, onError }: {
  locale: Locale;
  source: PageReadingSnapshot | null;
  targetLanguage: string;
  preview: TranslationPreview | null;
  mode: TranslationDisplayMode | null;
  disabled: boolean;
  running: boolean;
  onRun: (language: string, terms: TranslationTerm[]) => void;
  onCommand: (command: PageTranslationCommand) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}) {
  const [language, setLanguage] = useState(targetLanguage);
  const [terms, setTerms] = useState<TranslationTerm[]>([]);
  const [termsBusy, setTermsBusy] = useState(true);
  const [termsReady, setTermsReady] = useState(false);
  useEffect(() => {
    let active = true;
    void loadTranslationTerms().then((value) => {
      if (active) { setTerms(value); setTermsReady(true); }
    }).catch((failure) => { if (active) onError(formatError(locale, failure)); })
      .finally(() => { if (active) setTermsBusy(false); });
    return () => { active = false; };
  }, [locale, onError]);
  async function saveTerms(): Promise<void> {
    setTermsBusy(true);

    try { await saveTranslationTerms(terms); notify.success(t(locale, "termsSaved")); }
    catch (failure) { onError(formatError(locale, failure)); }
    finally { setTermsBusy(false); }
  }
  const busy = disabled || termsBusy;
  const characters = useMemo(() => source ? getReadingCharacters(source) : 0, [source]);
  const translationBlocks = useMemo(() => preview?.result.translations.map((item) => ({ id: item.blockId, text: item.text, heading: `[${item.blockId}]`, headingLevel: null })) ?? [], [preview]);
  const translationText = () => preview ? `${preview.source.title}\n${preview.source.url}\n\n${preview.result.translations.map((item) => item.text).join("\n\n")}` : "";
  return <section aria-label={t(locale, "pageTranslation")}>
    <div className="flex min-w-0 flex-col gap-3">
      <FieldGroup>
        <Field data-disabled={busy}>
          <FieldLabel htmlFor="page-translation-language">{t(locale, "translationLanguage")}</FieldLabel>
          <Input id="page-translation-language" value={language} maxLength={100} disabled={busy} onChange={(event) => setLanguage(event.target.value)} />
        </Field>
        <Collapsible className="flex flex-col gap-2">
          <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="justify-start" />}>
            {t(locale, "translationTerms")}{terms.length > 0 && ` (${terms.length})`}
            <ChevronDown data-icon="inline-end" className="ml-auto" />
          </CollapsibleTrigger>
          <CollapsibleContent>
        <FieldSet disabled={busy} className="gap-2">
          <FieldLegend variant="label" className="sr-only">{t(locale, "translationTerms")}</FieldLegend>
          {terms.map((term, index) => <div className="flex items-end gap-1" key={index}>
            <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`term-source-${index}`}>{t(locale, "termSource")} {index + 1}</FieldLabel><Input id={`term-source-${index}`} value={term.source} maxLength={100} onChange={(event) => { setTerms(terms.map((item, at) => at === index ? { ...item, source: event.target.value } : item)); }} /></Field>
            <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`term-target-${index}`}>{t(locale, "termTarget")} {index + 1}</FieldLabel><Input id={`term-target-${index}`} value={term.target} maxLength={200} onChange={(event) => { setTerms(terms.map((item, at) => at === index ? { ...item, target: event.target.value } : item)); }} /></Field>
            <IconTooltip label={t(locale, "removeTerm")}><Button size="icon-sm" variant="ghost" aria-label={`${t(locale, "removeTerm")} ${index + 1}`} onClick={() => { setTerms(terms.filter((_, at) => at !== index)); }}><X /></Button></IconTooltip>
          </div>)}
          <div className="flex items-center gap-2">
            <IconTooltip label={t(locale, "addTerm")}><Button size="icon-xs" variant="outline" aria-label={t(locale, "addTerm")} disabled={busy || !termsReady || terms.length >= 100} onClick={() => { setTerms([...terms, { source: "", target: "" }]); }}><Plus /></Button></IconTooltip>
            <Button size="xs" variant="outline" disabled={busy || !termsReady} onClick={() => void saveTerms()}><Save data-icon="inline-start" />{t(locale, "saveTerms")}</Button>
          </div>
        </FieldSet>
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !termsReady || Boolean(mode) || !language.trim() || !characters} onClick={() => onRun(language, terms)}><Languages data-icon="inline-start" />{t(locale, "translatePageRange")}</Button>
        {running && <IconTooltip label={t(locale, "stopGenerating")}><Button size="icon-sm" variant="destructive" aria-label={t(locale, "stopGenerating")} onClick={onCancel}><Square /></Button></IconTooltip>}
      </div>
      {preview && <>
        <div className="flex items-center gap-1">
          <IconTooltip label={t(locale, "copyResponse")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "copyResponse")} disabled={busy} onClick={() => { void copyText(translationText()).then(() => notify.success(t(locale, "copied"))).catch((failure) => onError(formatError(locale, failure))); }}><Copy /></Button></IconTooltip>
          <TextExport content={translationText} filename="hyperpage-translation" locale={locale} disabled={busy} />
        </div>
        <details className="text-xs break-words">
          <summary>{t(locale, "translationPreview")}: {preview.source.title}</summary>
          <div className="text-muted-foreground">{preview.source.url}</div>
          <SourceTextView key={preview.source.id} locale={locale} blocks={translationBlocks} className="h-52" />
        </details>
        {mode ? <>
          <ToggleGroup value={[mode]} variant="outline" size="sm" disabled={busy} aria-label={t(locale, "translationDisplay")} onValueChange={(values) => {
            const value = values[0];
            if (value === "original" || value === "bilingual" || value === "translated") onCommand({ type: "translation-mode", mode: value });
          }}>
            <ToggleGroupItem value="original">{t(locale, "translationOriginal")}</ToggleGroupItem>
            <ToggleGroupItem value="bilingual">{t(locale, "translationBilingual")}</ToggleGroupItem>
            <ToggleGroupItem value="translated">{t(locale, "translationOnly")}</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onCommand({ type: "restore-translation" })}><RotateCcw data-icon="inline-start" />{t(locale, "restoreTranslation")}</Button>
        </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => onCommand({ type: "apply-translation", result: preview.result })}><Languages data-icon="inline-start" />{t(locale, "applyTranslation")}</Button>}
      </>}
    </div>
  </section>;
}
