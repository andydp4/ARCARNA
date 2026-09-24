/**
 * The 1-bit page a thermal printer takes: one bit per dot, most significant
 * bit leftmost, 1 = burn (black), rows padded to whole bytes. This is the
 * layout the Niimbot bitmap-row packets carry (niimbluelib's ImageEncoder
 * packs the same way), so a packed label can be handed over unchanged.
 */
export interface MonoBitmap {
  width: number;
  height: number;
  bytesPerRow: number;
  data: Uint8Array;
}

/**
 * Pack RGBA pixels (a canvas ImageData buffer) into a MonoBitmap. A pixel is
 * black when it is mostly opaque and darker than `threshold` — transparent
 * canvas corners must come out white, not black, or the head burns a frame.
 */
export function packMonochrome(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 128,
): MonoBitmap {
  if (rgba.length < width * height * 4) {
    throw new Error(`Pixel buffer too small for ${width}×${height}`);
  }
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      if (alpha < 128) continue;
      // Rec. 601 luma, integer maths.
      const luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      if (luma < threshold) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bytesPerRow, data };
}

export function isBlack(bitmap: MonoBitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return false;
  return (bitmap.data[y * bitmap.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

/**
 * The shape niimbluelib's `ImageEncoder.encode` reads pixels through
 * (`ImageSource`): 0x000000 for black, 0xffffff for white. Declared here
 * structurally so this module stays free of the printer library.
 */
export function bitmapImageSource(bitmap: MonoBitmap) {
  return {
    width: bitmap.width,
    height: bitmap.height,
    // "left" is the library's rotated feed (the page goes through sideways):
    // it asks for column x of the rotated page, which is source row
    // height-1-x. Mirrors CanvasImageSource so either feed direction works.
    getPixelColor(x: number, y: number, printDirection: "left" | "top" = "top"): number {
      const black =
        printDirection === "left"
          ? isBlack(bitmap, y, bitmap.height - 1 - x)
          : isBlack(bitmap, x, y);
      return black ? 0x000000 : 0xffffff;
    },
  };
}
