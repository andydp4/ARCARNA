/**
 * Niimbot labels: 1-bit packing and the bytes that go to the printer.
 *
 * Hardware cannot be exercised here. What can be pinned: our packed bitmap
 * reaches niimbluelib's encoder bit for bit, and the frames it produces match
 * the protocol notes byte for byte (55 55 | cmd | len | data | xor | aa aa).
 */
import { describe, expect, it } from "vitest";
import * as lib from "@mmote/niimbluelib";
import { bitmapImageSource, isBlack, packMonochrome } from "@/lib/labels/bitmap";
import { PRINTER_ERROR_CODES } from "@/lib/labels/printerErrors";
import { B1_GEOMETRY } from "@/lib/labels/labelLayout";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Frame from the protocol notes, independent of the library. */
function frame(cmd: number, data: number[]): string {
  let xor = cmd ^ data.length;
  for (const b of data) xor ^= b;
  return hex(new Uint8Array([0x55, 0x55, cmd, data.length, ...data, xor, 0xaa, 0xaa]));
}

function rgbaFromRows(rows: string[]): Uint8ClampedArray {
  const width = rows[0].length;
  const out = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = (y * width + x) * 4;
      const v = ch === "#" ? 0 : 255;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = ch === " " ? 0 : 255; // " " = transparent
    }),
  );
  return out;
}

describe("packMonochrome", () => {
  it("packs MSB-first, 1 = black, padding rows to whole bytes", () => {
    const bmp = packMonochrome(rgbaFromRows(["#.#.......#", "..........."]), 11, 2);
    expect(bmp.bytesPerRow).toBe(2);
    expect([...bmp.data]).toEqual([0b10100000, 0b00100000, 0, 0]);
  });

  it("treats transparent pixels as white and uses the luma threshold", () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 0, // transparent black -> white
      100, 100, 100, 255, // dark grey -> black
      200, 200, 200, 255, // light grey -> white
      255, 0, 0, 255, // red: luma 76 -> black on a mono head
    ]);
    const bmp = packMonochrome(rgba, 4, 1);
    expect([...bmp.data]).toEqual([0b01010000]);
  });

  it("rejects a buffer smaller than the page", () => {
    expect(() => packMonochrome(new Uint8ClampedArray(4), 2, 2)).toThrow();
  });
});

describe("bitmap → niimbluelib encoder", () => {
  const width = 384;
  const height = 3;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const setBlack = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
  };
  // Row 0 blank, row 1 a few dots, row 2 a solid 16-dot run at the start.
  [39, 40, 41, 42].forEach((x) => setBlack(x, 1));
  for (let x = 0; x < 16; x++) setBlack(x, 2);
  const bmp = packMonochrome(rgba, width, height);

  it("hands the encoder exactly our packed rows (top feed, as on the B1)", () => {
    const encoded = lib.ImageEncoder.encode(bitmapImageSource(bmp), lib.PageColorType.SingleColor, "top");
    expect(encoded.cols).toBe(384);
    expect(encoded.rows).toBe(3);
    expect(encoded.rowsData[0].dataType).toBe("void");
    expect(hex(encoded.rowsData[1].rowDataBlack!)).toBe(hex(bmp.data.slice(48, 96)));
    expect(hex(encoded.rowsData[2].rowDataBlack!)).toBe(hex(bmp.data.slice(96, 144)));
  });

  it("rotates for a sideways ('left') feed the same way the library's canvas source does", () => {
    const src = bitmapImageSource(bmp);
    // Rotated column x, row y is source (col y, row height-1-x).
    expect(src.getPixelColor(1, 39, "left")).toBe(0x000000);
    expect(src.getPixelColor(0, 39, "left")).toBe(0xffffff);
    expect(src.getPixelColor(0, 5, "left")).toBe(0x000000);
    expect(isBlack(bmp, 5, 2)).toBe(true);
  });
});

describe("packet framing against the protocol notes", () => {
  const G = lib.PacketGenerator;

  it("frames the B1 print-task commands", () => {
    expect(hex(G.setDensity(3).toBytes())).toBe("555521010323aaaa");
    expect(hex(G.setDensity(3).toBytes())).toBe(frame(0x21, [3]));
    expect(hex(G.setLabelType(lib.LabelType.WithGaps).toBytes())).toBe("555523010123aaaa");
    expect(hex(G.printStart7b(1).toBytes())).toBe("555501070001000000000007aaaa");
    expect(hex(G.pageStart().toBytes())).toBe("555503010103aaaa");
    // 240 rows × 384 cols × 1 copy: the 50 × 30 mm page on a B1.
    expect(hex(G.setPageSize6b(B1_GEOMETRY.height, B1_GEOMETRY.width, 1).toBytes())).toBe(
      frame(0x13, [0x00, 0xf0, 0x01, 0x80, 0x00, 0x01]),
    );
    expect(hex(G.pageEnd().toBytes())).toBe("5555e30101e3aaaa");
    expect(hex(G.printEnd().toBytes())).toBe("5555f30101f3aaaa");
  });

  it("reproduces the indexed bitmap row from the protocol notes", () => {
    // Notes: "5555 83 0e 007e 000400 01 0027 0028 0029 002a fa aaaa" —
    // row 0x7e, 4 black dots at 39–42, repeated once.
    const row = new Uint8Array(48);
    row[4] = 0x01;
    row[5] = 0xe0;
    expect(hex(G.printBitmapRowIndexed(0x7e, 1, row, 0).toBytes())).toBe(
      "5555830e007e00040001002700280029002afaaaaa",
    );
  });

  it("frames empty rows and full bitmap rows", () => {
    expect(hex(G.printEmptySpace(0, 10).toBytes())).toBe(frame(0x84, [0, 0, 10]));
    const row = new Uint8Array(48);
    row[0] = 0xff;
    row[1] = 0xff;
    // 384-dot head: pixel counts split in three 16-byte chunks (16, 0, 0).
    expect(hex(G.printBitmapRow(5, 2, row, 384).toBytes())).toBe(frame(0x85, [0, 5, 16, 0, 0, 2, ...row]));
  });

  it("sends a whole B1 page in the documented order", async () => {
    const sent: number[] = [];
    const protocol = {
      sendAll: async (packets: Array<{ command: number }>) => {
        for (const p of packets) sent.push(p.command);
      },
      getClient: () => ({ getModelMetadata: () => lib.getPrinterMetaByModel(lib.PrinterModel.B1) }),
    } as unknown as ConstructorParameters<typeof lib.B1PrintTask>[0];
    const task = new lib.B1PrintTask(protocol, { totalPages: 1, labelType: lib.LabelType.WithGaps, density: 3 });
    const rgba = new Uint8ClampedArray(384 * 240 * 4).fill(255);
    for (let x = 0; x < 384; x++) rgba[(100 * 384 + x) * 4] = rgba[(100 * 384 + x) * 4 + 1] = rgba[(100 * 384 + x) * 4 + 2] = 0;
    const image = lib.ImageEncoder.encode(
      bitmapImageSource(packMonochrome(rgba, 384, 240)),
      lib.PageColorType.SingleColor,
      "top",
    );
    await task.printInit();
    await task.printPage(image, 1);
    // init: density, label type, print start; page: start, size, 100 blank
    // rows, the one black row, blank rows (split at the encoder's row-200
    // checkpoint, which the B1 task does not send), page end.
    expect(sent).toEqual([0x21, 0x23, 0x01, 0x03, 0x13, 0x84, 0x85, 0x84, 0x84, 0xe3]);
  });

  it("keeps our copied printer status codes in step with the library", () => {
    for (const [name, code] of Object.entries(PRINTER_ERROR_CODES)) {
      expect(lib.PrinterErrorCode[name as keyof typeof lib.PrinterErrorCode]).toBe(code);
    }
  });

  it("knows the B1 as 203 dpi with a 384-dot head, fed top-first", () => {
    const meta = lib.getPrinterMetaByModel(lib.PrinterModel.B1);
    expect(meta).toMatchObject({ dpi: 203, printheadPixels: 384, printDirection: "top" });
    expect(B1_GEOMETRY).toMatchObject({ width: 384, height: 240 });
  });
});
