/** Parsed contact from a vCard (Apple Contacts export compatible). */
export type ParsedVCard = {
  firstName: string;
  lastName: string;
  name: string;
  phones: string[];
  emails: string[];
  company: string;
  notes: string;
};

const SKIP_PROPERTY_KEYS = new Set([
  "PHOTO",
  "LOGO",
  "SOUND",
  "KEY",
  "ANNIVERSARY",
  "BDAY",
  "X-ABSHOWMAP",
  "X-ABCARDIMAGE",
  "X-ABTHUMBNAILIMAGE",
]);

function decodeVcardValue(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1);
  }
  if (/=[0-9A-F]{2}/i.test(v)) {
    v = v
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return v.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function parseStructuredName(value: string): { firstName: string; lastName: string } {
  const parts = value.split(";");
  return {
    lastName: (parts[0] ?? "").trim(),
    firstName: (parts[1] ?? "").trim(),
  };
}

function propertyKey(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const keyPart = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const key = keyPart.split(";")[0].split(".")[0].toUpperCase();
  return { key, value };
}

function finalizeCard(card: {
  firstName: string;
  lastName: string;
  fn: string;
  phones: string[];
  emails: string[];
  company: string;
  notes: string;
}): ParsedVCard | null {
  const name =
    card.fn.trim() ||
    [card.firstName, card.lastName].filter(Boolean).join(" ").trim() ||
    card.company.trim();
  if (!name && card.phones.length === 0 && card.emails.length === 0) {
    return null;
  }
  return {
    firstName: card.firstName,
    lastName: card.lastName,
    name: name || "Unknown",
    phones: card.phones,
    emails: card.emails,
    company: card.company,
    notes: card.notes,
  };
}

function isFoldContinuation(line: string): boolean {
  return line.startsWith(" ") || line.startsWith("\t");
}

/**
 * Parse vCards without loading embedded PHOTO blobs into memory (Apple exports
 * can be 10MB+ mostly JPEG data for ~1k contacts).
 */
export function parseVcardFile(content: string): ParsedVCard[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const raw = normalized.split("\n");
  const results: ParsedVCard[] = [];
  let card: {
    firstName: string;
    lastName: string;
    fn: string;
    phones: string[];
    emails: string[];
    company: string;
    notes: string;
  } | null = null;

  const emptyCard = () => ({
    firstName: "",
    lastName: "",
    fn: "",
    phones: [] as string[],
    emails: [] as string[],
    company: "",
    notes: "",
  });

  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      card = emptyCard();
      i++;
      continue;
    }
    if (upper === "END:VCARD") {
      if (card) {
        const finalized = finalizeCard(card);
        if (finalized) results.push(finalized);
      }
      card = null;
      i++;
      continue;
    }

    if (!card) {
      i++;
      continue;
    }

    const prop = propertyKey(line);
    if (!prop) {
      i++;
      continue;
    }

    if (SKIP_PROPERTY_KEYS.has(prop.key)) {
      i++;
      while (i < raw.length && isFoldContinuation(raw[i])) i++;
      continue;
    }

    let fullLine = line;
    i++;
    while (i < raw.length && isFoldContinuation(raw[i])) {
      fullLine += raw[i].slice(1);
      i++;
    }

    const merged = propertyKey(fullLine);
    if (!merged) continue;

    const value = decodeVcardValue(merged.value);
    if (!value) continue;

    switch (merged.key) {
      case "FN":
        card.fn = value;
        break;
      case "N": {
        const { firstName, lastName } = parseStructuredName(value);
        card.firstName = firstName;
        card.lastName = lastName;
        break;
      }
      case "TEL":
        if (!card.phones.includes(value)) card.phones.push(value);
        break;
      case "EMAIL":
        if (!card.emails.includes(value)) card.emails.push(value);
        break;
      case "ORG":
        card.company = value.split(";")[0]?.trim() || value;
        break;
      case "NOTE":
        card.notes = card.notes ? `${card.notes}\n${value}` : value;
        break;
      default:
        break;
    }
  }

  return results;
}
