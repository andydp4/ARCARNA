// Build the arcarna staff training manual, v1.2, in three editions from the
// twelve section files:
//
//   arcarna-training-cashier.pdf  unmarked content only
//   arcarna-training-manager.pdf  plus everything marked class="ed-manager"
//   arcarna-training-admin.pdf    plus everything marked class="ed-admin"
//
// A section whose <main> carries ed-manager / ed-admin is left out of the
// editions below it; a marked block inside a section is removed the same way.
// Section numbers are kept as written, so "Section 5" means the same thing in
// every edition. Usage: node docs/training/build-manual.mjs [cashier|manager|admin ...]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const VERSION = "1.2";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const SECTIONS = [
  "01-getting-started", "02-shifts", "03-the-till", "04-operations",
  "05-deliveries-my-run", "06-stock", "07-customers", "08-finance",
  "09-truths-evidence", "10-ask-arcarna", "11-settings-admin", "12-brand-guidelines",
];

const EDITIONS = {
  cashier: { cover: "For cashiers and drivers", tag: "Cashier edition", drop: ["ed-manager", "ed-admin"] },
  manager: { cover: "For managers", tag: "Manager edition", drop: ["ed-admin"] },
  admin: { cover: "For admins and owners", tag: "Admin edition", drop: [] },
};

// "Covers" column of the contents page, per edition where it differs.
const COVERS = {
  "01-getting-started": { all: "Roles, signing in, the Centres menu, page headers, tours, What's New and the Problem? button" },
  "02-shifts": { all: "How a shift starts, my shift so far, counting the drawer, closing, the Z-report, My performance", manager: "How a shift starts, counting and closing, the Z-report, the Shifts page and the daily close, My performance" },
  "03-the-till": { all: "Building an order, customers, discounts and points, split, credit, Card (link), personal use, working offline" },
  "04-operations": { all: "The board, moving orders along, changes, refunds, receipts and labels", manager: "The board, moving orders along, changes, refunds, invoices, labels and Order Timing" },
  "05-deliveries-my-run": { all: "Taking a delivery, My run on your phone, delivered and couldn't deliver", manager: "Taking a delivery, My run on a phone, and following a driver's run" },
  "06-stock": { all: "Stock levels, and what the Stock Centre holds", manager: "Products and prices, minimum prices, cost, price history, stock, reorders and suppliers" },
  "07-customers": { all: "Customers' privacy, finding a customer by phone, loyalty points and gift cards", manager: "Customer records, masked details, contact requests, loyalty, promotions and gift cards", admin: "Customer records, masked details, approving contact requests and the access log, loyalty, promotions and gift cards" },
  "08-finance": { all: "The Credit List and repayments, invoices, expenses, cashier pay" },
  "09-truths-evidence": { all: "Truths at a glance, Evidence, Needs a look, Staff Performance, targets", admin: "Truths at a glance, Evidence and exports, Needs a look, Would have flagged, Staff Performance, targets" },
  "10-ask-arcarna": { all: "What Ask arcarna is, asking good questions, checking answers, privacy", admin: "What Ask arcarna is, asking good questions, checking answers, privacy, and its settings" },
  "11-settings-admin": { all: "People and roles, Preview as, locations, price guard, Card (link), labels, WhatsApp, privacy notice, Problem? inbox, targets" },
  "12-brand-guidelines": { all: "Name, voice, colour, logo: staying on brand" },
};

function readSection(name) {
  const html = fs.readFileSync(path.join(DIR, "sections", name + ".html"), "utf8");
  const main = html.match(/<main[\s\S]*?<\/main>/);
  if (!main) throw new Error(`${name}: no <main>`);
  // Images are referenced from sections/ as ../images/...; the manual is built from docs/training/.
  return main[0].replace(/(src|href)="\.\.\//g, '$1="');
}

function sectionMeta(name, mainHtml) {
  const open = mainHtml.match(/^<main[^>]*class="([^"]*)"/);
  const classes = open ? open[1].split(/\s+/) : [];
  const num = (mainHtml.match(/class="chapter-num">([^<]*)</) ?? [])[1] ?? "";
  const title = (mainHtml.match(/class="chapter-title">([^<]*)</) ?? [])[1] ?? name;
  return { name, classes, num: num.trim(), title: title.trim() };
}

function coverHtml(ed) {
  return `
<section class="cover">
  <div class="cover-veil"></div>
  <img class="cover-logo" src="images/brand/arcarna-wordmark.png" alt="arcarna" />
  <div class="cover-title">Staff training manual</div>
  <div class="cover-sub">Reveal Your Truth&trade;</div>
  <div class="cover-meta">${ed.cover} · version ${VERSION}</div>
</section>`;
}

function tocHtml(edKey, ed, metas) {
  const rows = metas
    .map((m) => {
      const c = COVERS[m.name] ?? {};
      const covers = c[edKey] ?? (edKey === "admin" ? c.manager : undefined) ?? c.all ?? "";
      return `    <tr><td>${Number(m.num)} · ${m.title}</td><td>${covers}</td></tr>`;
    })
    .join("\n");
  return `
<section class="section toc-page">
  <div class="brand-band"><img src="images/brand/arcarna-wordmark.png" alt="arcarna" /><span class="band-tag">Staff training manual · ${ed.tag}</span></div>
  <p class="eyebrow">What's inside · version ${VERSION}</p>
  <h2>Contents</h2>
  <table>
    <tr><th>Section</th><th>Covers</th></tr>
${rows}
  </table>
</section>`;
}

const STYLE = `
  .cover { position:relative; height:257mm; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--deep-shadow); color:#fff; text-align:center; page-break-after:always; overflow:hidden; }
  .cover-veil { position:absolute; inset:0; background:radial-gradient(ellipse 60% 45% at 50% 45%, rgba(93,180,255,0.28), rgba(6,19,39,0) 70%); }
  .cover-logo { width:300px; max-width:60%; position:relative; filter:brightness(0) invert(1); opacity:0.96; }
  .cover-title { position:relative; font-family:var(--font-head); font-weight:600; font-size:26pt; margin-top:26px; }
  .cover-sub { position:relative; font-family:var(--font-head); color:var(--sky-blue); font-size:13pt; margin-top:6px; }
  .cover-meta { position:relative; font-family:var(--font-mono); color:var(--bg300); font-size:9pt; letter-spacing:0.14em; text-transform:uppercase; margin-top:40px; }
  .page-break { page-break-before:always; }
  .toc-page { page-break-after:always; }
  /* Screenshots never run off the page; phone shots sit narrow and centred. */
  figure img { max-height:205mm; object-fit:contain; }
  figure.phone img { width:auto; max-width:62%; max-height:150mm; display:block; margin:0 auto; }
  figure.phone figcaption { text-align:center; }
`;

const args = process.argv.slice(2);
// --draft builds even with screenshots missing (for checking layout while capturing).
const DRAFT = args.includes("--draft");
const named = args.filter((a) => !a.startsWith("--"));
const wanted = named.length ? named : Object.keys(EDITIONS);
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

for (const edKey of wanted) {
  const ed = EDITIONS[edKey];
  if (!ed) throw new Error(`unknown edition ${edKey}`);
  const mains = SECTIONS.map((s) => ({ name: s, html: readSection(s) }));
  const present = mains
    .map((m) => ({ ...m, meta: sectionMeta(m.name, m.html) }))
    .filter((m) => !m.meta.classes.some((c) => ed.drop.includes(c)));

  const body = present.map((m) => `<div class="page-break">${m.html}</div>`).join("\n");
  const doc = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<title>arcarna staff training manual · ${ed.tag} · v${VERSION}</title>
<link rel="stylesheet" href="brand.css">
<style>${STYLE}</style></head>
<body>${coverHtml(ed)}${tocHtml(edKey, ed, present.map((m) => m.meta))}${body}</body></html>`;

  const tmp = path.join(DIR, `.manual-${edKey}.html`);
  fs.writeFileSync(tmp, doc);
  const page = await browser.newPage();
  await page.goto("file://" + tmp, { waitUntil: "networkidle" });
  const removed = await page.evaluate((drop) => {
    let n = 0;
    for (const cls of drop) {
      document.querySelectorAll("." + cls).forEach((el) => { el.remove(); n++; });
    }
    return n;
  }, ed.drop);
  const report = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll("img")];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    const broken = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
    imgs.forEach((i) => { if (i.naturalHeight > i.naturalWidth) i.closest("figure")?.classList.add("phone"); });
    return { images: imgs.length, broken };
  });
  if (report.broken.length) {
    const msg = `${edKey}: missing images: ${report.broken.join(", ")}`;
    if (!DRAFT) throw new Error(msg);
    console.warn(msg);
  }
  await page.waitForTimeout(500);
  const out = path.join(DIR, `arcarna-training-${edKey}.pdf`);
  await page.pdf({
    path: out,
    format: "A4", printBackground: true,
    margin: { top: "15mm", bottom: "16mm", left: "16mm", right: "16mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%; font-family:monospace; font-size:7pt; color:#7D8FA6; padding:0 16mm; display:flex; justify-content:space-between;"><span>arcarna · staff training manual · ${ed.tag.toLowerCase()} · v${VERSION}</span><span class="pageNumber"></span></div>`,
  });
  await page.close();
  fs.unlinkSync(tmp);
  console.log(`${edKey}: ${present.length} sections, ${removed} marked blocks removed, ${report.images} images -> ${path.basename(out)}`);
}
await browser.close();
