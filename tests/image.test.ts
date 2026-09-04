import { describe, expect, it } from "vitest";

import { calculateCropRegion } from "../shared/image";
import type { SelectionSnapshot } from "../shared/messages";

// Creates a complete geometry fixture while allowing each crop case to set its rectangle.
function selectionAt(
  x: number,
  y: number,
  width: number,
  height: number,
): SelectionSnapshot {
  return {
    kind: "image",
    tagName: "img",
    text: "",
    accessibleName: "",
    role: "",
    editable: false,
    rect: { x, y, width, height },
    viewport: { width: 1000, height: 500 },
  };
}

describe("screenshot crop geometry", () => {
  it("maps CSS coordinates to a high-density screenshot", () => {
    expect(calculateCropRegion(selectionAt(100, 50, 300, 100), 2000, 1000)).toEqual({
      x: 200,
      y: 100,
      width: 600,
      height: 200,
    });
  });

  it("clips an element to the current visible viewport", () => {
    expect(calculateCropRegion(selectionAt(-50, 450, 200, 100), 1000, 500)).toEqual({
      x: 0,
      y: 450,
      width: 150,
      height: 50,
    });
  });

  it("rejects a selection fully outside the viewport", () => {
    expect(() =>
      calculateCropRegion(selectionAt(1100, 20, 100, 100), 1000, 500),
    ).toThrow("selectionOutsideViewport");
  });
});
