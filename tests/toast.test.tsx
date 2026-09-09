import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { message, Toaster } from "../components/ui/toast";
import { PortalContainerProvider } from "../components/ui/portal-container";

afterEach(cleanup);

describe("floating messages", () => {
  it("renders inside the panel's shadow portal, dismisses, and reports repeated errors", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const portal = document.createElement("div");
    shadow.append(portal);
    const app = render(<PortalContainerProvider container={portal}><Toaster closeLabel="Close message" /></PortalContainerProvider>);
    await act(async () => message.error("Request failed"));
    const notice = portal.querySelector<HTMLElement>('[data-slot="message"]');
    if (!notice) throw new Error("Missing error message");
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent("Request failed");
    expect(document.querySelector('[data-slot="message"]')).toBeNull();
    const closeButton = within(notice).getByRole("button", { hidden: true });
    expect(closeButton).toHaveAttribute("aria-label", "Close message");
    fireEvent.click(closeButton);
    await waitFor(() => expect(portal.querySelector('[data-slot="message"]')).toBeNull());
    await act(async () => message.error("Request failed"));
    expect(portal.querySelector('[data-slot="message"]')).toHaveTextContent("Request failed");
    app.unmount();
    host.remove();
  });
});
