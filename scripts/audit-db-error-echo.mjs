#!/usr/bin/env node
/**
 * CI check (FIX-11): a 5xx response must never echo the caught error's text.
 *
 * Database errors carry the SQL and its parameters ("Failed query: ... params:
 * ..."), and those parameters include customer data from the request. Route
 * catches must call sendServerError() (server/lib/errorScrub.ts) or send a
 * fixed message. server/httpLog.ts also scrubs database text from every error
 * body at runtime; this check stops new echoes being written in the first place.
 *
 * Flags `.status(5xx).json({ ... <err>.message ... })` and
 * `.status(5xx).json({ ... String(<err>) ... })`, including across lines.
 * Exit 1 with a list of offenders.
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["server", "apps/server/src"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist"]);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|js|mjs)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) yield full;
  }
}

/** The argument text of the `.json(` call starting at `openIdx` (balanced parens). */
function jsonArgument(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length && i < openIdx + 2000; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1, openIdx + 2000);
}

const ERR_IDENT = String.raw`(?:e|err|error|ex|caught|cause|reason|[a-z]+Error|[a-z]+Err)`;
const ECHO_RE = new RegExp(
  String.raw`\b${ERR_IDENT}\??\.(?:message|stack|detail)\b|String\(\s*${ERR_IDENT}\s*\)|\$\{\s*${ERR_IDENT}\s*\}`,
);
const STATUS_5XX_JSON = /\.status\(\s*5\d\d\s*\)\s*\.json\(/g;

export function findEchoes(src) {
  const hits = [];
  for (const m of src.matchAll(STATUS_5XX_JSON)) {
    const open = m.index + m[0].length - 1;
    const arg = jsonArgument(src, open);
    if (ECHO_RE.test(arg)) {
      const line = src.slice(0, m.index).split("\n").length;
      hits.push({ line, snippet: arg.replace(/\s+/g, " ").trim().slice(0, 120) });
    }
  }
  return hits;
}

function main() {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, "utf8");
      for (const hit of findEchoes(src)) offenders.push(`${file}:${hit.line}  ${hit.snippet}`);
    }
  }
  if (offenders.length) {
    console.error("5xx responses that echo the caught error (use sendServerError from server/lib/errorScrub.ts):");
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log("audit-db-error-echo: no 5xx response echoes an error message.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
