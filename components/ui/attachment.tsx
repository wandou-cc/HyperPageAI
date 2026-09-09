import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Attachment({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment" className={cn("flex min-w-0 items-center gap-2 rounded-md border bg-card p-2 text-card-foreground", className)} {...props} />;
}

function AttachmentMedia({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-media" className={cn("flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted [&_svg]:size-4", className)} {...props} />;
}

function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="attachment-content" className={cn("min-w-0 flex-1", className)} {...props} />;
}

function AttachmentTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="attachment-title" className={cn("block truncate text-xs font-medium", className)} {...props} />;
}

export { Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle };
