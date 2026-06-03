import { randomInt } from "crypto";

export const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CODE_BODY_LENGTH = 15;

function charValue(char: string): number {
  const idx = BASE32_ALPHABET.indexOf(char.toUpperCase());
  if (idx === -1) throw new Error("Invalid base32 character");
  return idx;
}

export function luhnCheckDigitBase32(body: string): string {
  if (body.length !== CODE_BODY_LENGTH) throw new Error(`Expected ${CODE_BODY_LENGTH} character body`);
  const digits = body.split("").map(charValue);
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d >= 32) d = Math.floor(d / 32) + (d % 32);
    }
    sum += d;
    double = !double;
  }
  return BASE32_ALPHABET[(32 - (sum % 32)) % 32];
}

export function generateGiftCardCode(): string {
  let body = "";
  for (let i = 0; i < CODE_BODY_LENGTH; i++) body += BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)];
  return body + luhnCheckDigitBase32(body);
}

export function validateGiftCardCode(code: string): boolean {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== 16 || !/^[A-Z2-7]+$/.test(normalized)) return false;
  try {
    return luhnCheckDigitBase32(normalized.slice(0, CODE_BODY_LENGTH)) === normalized.slice(CODE_BODY_LENGTH);
  } catch { return false; }
}

export function normalizeGiftCardCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function maskGiftCardCode(code: string): string {
  const normalized = normalizeGiftCardCode(code);
  return normalized.length < 4 ? "****" : `****${normalized.slice(-4)}`;
}
