import type { PropsWithChildren, ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { Toaster } from "../components/ui/toast";

function MessageRoot({ children }: PropsWithChildren) {
  return <><Toaster closeLabel="Close message" />{children}</>;
}

function renderWithMessages(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { ...options, wrapper: MessageRoot });
}

export * from "@testing-library/react";
export { renderWithMessages as render };
