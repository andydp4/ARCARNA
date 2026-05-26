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

function unfoldVcardLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const raw = normalized.split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim()) {
      lines.push(line);
    }
  }
  return lines;
}

function decodeVcardValue(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1);
  }
  // Quoted-printable (common in Apple exports)
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

/** Parse one or more VCARD records from file text (3.0 / 4.0). */
export function parseVcardFile(content: string): ParsedVCard[] {
  const lines = unfoldVcardLines(content);
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

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      card = emptyCard();
      continue;
    }
    if (upper === "END:VCARD") {
      if (card) {
        const finalized = finalizeCard(card);
        if (finalized) results.push(finalized);
      }
      card = null;
      continue;
    }
    if (!card) continue;

    const prop = propertyKey(line);
    if (!prop) continue;

    const value = decodeVcardValue(prop.value);
    if (!value) continue;

    switch (prop.key) {
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
