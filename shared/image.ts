import type { SelectionSnapshot } from "./messages";

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Maps a visible CSS-pixel selection rectangle onto captured bitmap pixels.
export function calculateCropRegion(
  selection: SelectionSnapshot,
  imageWidth: number,
  imageHeight: number,
): CropRegion {
  const left = Math.max(0, selection.rect.x);
  const top = Math.max(0, selection.rect.y);
  const right = Math.min(
    selection.viewport.width,
    selection.rect.x + selection.rect.width,
  );
  const bottom = Math.min(
    selection.viewport.height,
    selection.rect.y + selection.rect.height,
  );

  if (right <= left || bottom <= top) {
    throw new Error("selectionOutsideViewport");
  }

  const scaleX = imageWidth / selection.viewport.width;
  const scaleY = imageHeight / selection.viewport.height;
  const x = Math.floor(left * scaleX);
  const y = Math.floor(top * scaleY);
  const rightPixel = Math.min(imageWidth, Math.ceil(right * scaleX));
  const bottomPixel = Math.min(imageHeight, Math.ceil(bottom * scaleY));

  return {
    x,
    y,
    width: rightPixel - x,
    height: bottomPixel - y,
  };
}
