import { z } from "zod";

const outputSchema = z.object({
  status: z.literal("completed"),
  output: z.array(z.object({ type: z.string() }).passthrough()),
});
const citationSchema = z.object({
  type: z.literal("url_citation"),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative(),
  title: z.string(),
  url: z.url().refine((url) => ["https:", "http:"].includes(new URL(url).protocol)),
});
const messageSchema = z.object({
  status: z.literal("completed"),
  role: z.literal("assistant"),
  content: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("output_text"), text: z.string(), annotations: z.array(citationSchema) }),
    z.object({ type: z.literal("refusal"), refusal: z.string() }),
  ])),
});
const searchCallSchema = z.object({
  id: z.string().min(1),
  status: z.literal("completed"),
  action: z.object({ type: z.enum(["search", "open_page", "find_in_page"]) }),
});

// Native tool output and URL annotations are the evidence that a search ran.
export function parseWebSearchResponse(value: unknown): string {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) throw new Error("apiResponseInvalid");
  let searched = false;
  const urls = new Map<string, number>();
  const parts: string[] = [];
  for (const item of parsed.data.output) {
    if (item.type === "reasoning") continue;
    if (item.type === "web_search_call") {
      const call = searchCallSchema.safeParse(item);
      if (!call.success) throw new Error("webSearchNotPerformed");
      if (call.data.action.type === "search") searched = true;
      continue;
    }
    if (item.type !== "message") throw new Error("apiResponseInvalid");
    const message = messageSchema.safeParse(item);
    if (!message.success) throw new Error("apiResponseInvalid");
    for (const part of message.data.content) {
      if (part.type === "refusal") throw new Error("modelOutputFiltered");
      let offset = 0;
      let text = "";
      for (const citation of [...part.annotations].sort((a, b) => a.start_index - b.start_index)) {
        if (citation.start_index < offset || citation.end_index < citation.start_index || citation.end_index > part.text.length)
          throw new Error("apiResponseInvalid");
        if (!urls.has(citation.url)) urls.set(citation.url, urls.size + 1);
        const url = citation.url.replace(/[<>\s\\]/g, (character) => encodeURIComponent(character));
        text += `${part.text.slice(offset, citation.start_index)}[${urls.get(citation.url)}](<${url}>)`;
        offset = citation.end_index;
      }
      parts.push(text + part.text.slice(offset));
    }
  }
  if (!searched || !urls.size) throw new Error("webSearchNotPerformed");
  const answer = parts.join("\n\n").trim();
  if (!answer) throw new Error("apiResponseInvalid");
  return answer;
}
