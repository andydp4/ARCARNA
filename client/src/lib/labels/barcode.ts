/**
 * Barcode symbols for product labels, as plain module runs.
 *
 * Written here rather than pulled from a barcode package because every one of
 * those draws to a DOM node or a canvas, and a label has to land on exact
 * printer dots (1 module = N whole dots) to scan off a 203 dpi thermal head.
 * A list of modules is also something a node test can check byte for byte.
 */

/** One symbol: `true` is a bar module, `false` a space. No quiet zone. */
export interface BarcodeSymbol {
  kind: "ean13" | "code128";
  modules: boolean[];
  /** What is printed under the bars. */
  text: string;
}

// Code 128 bar/space widths for values 0–106 (103–105 are the start codes,
// 106 is stop). Every entry sums to 11 modules, stop to 13.
const CODE128_WIDTHS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
const CODE128_CODE_B = 100;
const CODE128_STOP = 106;

function widthsToModules(widths: string, out: boolean[]): void {
  let bar = true;
  for (const ch of widths) {
    const n = Number(ch);
    for (let i = 0; i < n; i++) out.push(bar);
    bar = !bar;
  }
}

/**
 * Code 128 symbol values (start, data, checksum, stop). Uses Code C for runs
 * of digits — it halves the width, which is what lets a 12–14 digit supplier
 * code fit 48 mm at two dots a module — and Code B for anything else.
 * Returns null for text Code 128 B cannot carry (outside printable ASCII).
 */
export function code128Values(text: string): number[] | null {
  if (text.length === 0) return null;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) return null;
  }
  const values: number[] = [];
  const allDigits = /^\d+$/.test(text);
  if (allDigits && text.length >= 4) {
    values.push(CODE128_START_C);
    const pairs = text.length - (text.length % 2);
    for (let i = 0; i < pairs; i += 2) values.push(Number(text.slice(i, i + 2)));
    if (pairs < text.length) {
      values.push(CODE128_CODE_B);
      values.push(text.charCodeAt(pairs) - 32);
    }
  } else {
    values.push(CODE128_START_B);
    for (let i = 0; i < text.length; i++) values.push(text.charCodeAt(i) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(CODE128_STOP);
  return values;
}

export function encodeCode128(text: string): BarcodeSymbol | null {
  const values = code128Values(text);
  if (!values) return null;
  const modules: boolean[] = [];
  for (const v of values) widthsToModules(CODE128_WIDTHS[v], modules);
  return { kind: "code128", modules, text };
}

// EAN-13: left-hand "L" widths (space first); "R" is the same widths bar
// first; "G" is L reversed. The first digit is carried by the L/G parity of
// the next six.
const EAN_L = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** True for a 13-digit EAN (or 12-digit UPC-A) whose check digit is right. */
export function isValidEan13(code: string): boolean {
  const c = code.length === 12 ? `0${code}` : code;
  if (!/^\d{13}$/.test(c)) return false;
  return ean13CheckDigit(c.slice(0, 12)) === Number(c[12]);
}

function pushWidths(widths: string, barFirst: boolean, out: boolean[]): void {
  let bar = barFirst;
  for (const ch of widths) {
    const n = Number(ch);
    for (let i = 0; i < n; i++) out.push(bar);
    bar = !bar;
  }
}

export function encodeEan13(code: string): BarcodeSymbol | null {
  if (!isValidEan13(code)) return null;
  const c = code.length === 12 ? `0${code}` : code;
  const parity = EAN_PARITY[Number(c[0])];
  const modules: boolean[] = [];
  pushWidths("111", true, modules); // start guard
  for (let i = 1; i <= 6; i++) {
    const w = EAN_L[Number(c[i])];
    pushWidths(parity[i - 1] === "L" ? w : [...w].reverse().join(""), false, modules);
  }
  pushWidths("11111", false, modules); // centre guard
  for (let i = 7; i <= 12; i++) pushWidths(EAN_L[Number(c[i])], true, modules);
  pushWidths("111", true, modules); // end guard
  return { kind: "ean13", modules, text: c };
}

/**
 * The symbol a product label should carry: EAN-13 when the stored barcode is
 * a valid EAN-13/UPC-A (what a till scanner expects on retail stock),
 * otherwise Code 128 of the barcode as typed. Null when there is no barcode or
 * it cannot be encoded.
 */
export function barcodeForProduct(barcode: string | null | undefined): BarcodeSymbol | null {
  const code = (barcode ?? "").trim();
  if (!code) return null;
  return encodeEan13(code) ?? encodeCode128(code);
}
