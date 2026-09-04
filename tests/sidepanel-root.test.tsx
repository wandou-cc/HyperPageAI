import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip";
import { IconTooltip } from "../entrypoints/sidepanel/ui";

describe("floating panel root", () => {
  it("renders tooltip controls inside the required provider", () => {
    render(
      <TooltipProvider>
        <IconTooltip label="Settings">
          <button type="button">Open settings</button>
        </IconTooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
  });
});
