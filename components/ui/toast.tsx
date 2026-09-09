import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortalContainer } from "@/components/ui/portal-container";

const toastManager = Toast.createToastManager();

export const message = {
  success(text: string): void {
    toastManager.add({ title: text, type: "success" });
  },
  error(text: string): void {
    toastManager.add({ title: text, type: "error", priority: "high", timeout: 7000 });
  },
  info(text: string): void {
    toastManager.add({ title: text, type: "info" });
  },
};

function MessageList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => (
    <Toast.Root key={item.id} toast={item} data-slot="message"
      className="pointer-events-auto relative w-full rounded-md border bg-popover text-popover-foreground shadow-lg data-limited:hidden data-ending-style:opacity-0">
      <Toast.Content className="flex items-start gap-2 p-3">
        {item.type === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> :
          item.type === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
        <Toast.Title className="min-w-0 flex-1 text-sm whitespace-pre-wrap wrap-anywhere" />
        <Toast.Close render={<Button size="icon-xs" variant="ghost" aria-label={closeLabel} />}><X /></Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export function Toaster({ closeLabel }: { closeLabel: string }) {
  const container = usePortalContainer();
  return (
    <Toast.Provider toastManager={toastManager} timeout={4500} limit={3}>
      <Toast.Portal container={container}>
        <Toast.Viewport data-slot="message-viewport" className="pointer-events-none fixed inset-x-3 top-4 z-50 mx-auto flex w-[calc(100vw-24px)] max-w-sm flex-col gap-2 outline-none">
          <MessageList closeLabel={closeLabel} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
