// Assemble all sections into one combined arcarna staff training manual PDF.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const SECTIONS = [
  "01-getting-started", "02-opening-shifts", "03-creating-orders",
  "04-monitoring-orders", "05-products", "06-customers", "07-expenses",
  "08-truths-insights", "09-loyalty", "10-brand-guidelines",
];

function innerMain(file) {
  const html = fs.readFileSync(path.join(DIR, "sections", file + ".html"), "utf8");
  const m = html.match(/<main[\s\S]*?<\/main>/);
  return m ? m[0] : "";
}

const cover = `
<section class="cover">
  <div class="cover-veil"></div>
  <img class="cover-logo" src="images/brand/arcarna-wordmark.png" alt="arcarna" />
  <div class="cover-title">Staff training manual</div>
  <div class="cover-sub">Reveal Your Truth&trade;</div>
  <div class="cover-meta">For cashiers and managers · version 1.0</div>
</section>`;

const toc = `
<section class="section toc-page">
  <div class="brand-band"><img src="images/brand/arcarna-wordmark.png" alt="arcarna" /><span class="band-tag">Staff training manual</span></div>
  <p class="eyebrow">What's inside</p>
  <h2>Contents</h2>
  <table>
    <tr><th>Section</th><th>Covers</th></tr>
    <tr><td>1 · Getting started</td><td>Roles, signing in, the Control Centre, the menu</td></tr>
    <tr><td>2 · Opening &amp; shifts</td><td>Starting and closing a shift, the float, the Z-report</td></tr>
    <tr><td>3 · Creating orders</td><td>The till: basket, customer, discounts, payment</td></tr>
    <tr><td>4 · Monitoring orders</td><td>Open orders, amending, refunds, invoices</td></tr>
    <tr><td>5 · Products</td><td>Adding, editing and retiring products; prices and stock</td></tr>
    <tr><td>6 · Customers</td><td>Records, history, tick accounts</td></tr>
    <tr><td>7 · Expenses</td><td>Logging costs so profit is honest</td></tr>
    <tr><td>8 · Truths</td><td>Understanding the business: RFM, hours, stock turn</td></tr>
    <tr><td>9 · Loyalty</td><td>Points, tiers, earning and redeeming</td></tr>
    <tr><td>10 · Brand guidelines</td><td>Name, voice, colour, logo — staying on brand</td></tr>
  </table>
</section>`;

const body = SECTIONS.map((s, i) =>
  `<div class="page-break">${innerMain(s).replace('class="section"', 'class="section"')}</div>`
).join("\n");

const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>arcarna staff training manual</title>
<link rel="stylesheet" href="brand.css">
<style>
  .cover { position:relative; height:257mm; display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--deep-shadow); color:#fff; text-align:center; page-break-after:always; overflow:hidden; }
  .cover-veil { position:absolute; inset:0; background:radial-gradient(ellipse 60% 45% at 50% 45%, rgba(93,180,255,0.28), rgba(6,19,39,0) 70%); }
  .cover-logo { width:300px; max-width:60%; position:relative; filter:brightness(0) invert(1); opacity:0.96; }
  .cover-title { position:relative; font-family:var(--font-head); font-weight:600; font-size:26pt; margin-top:26px; }
  .cover-sub { position:relative; font-family:var(--font-head); color:var(--sky-blue); font-size:13pt; margin-top:6px; }
  .cover-meta { position:relative; font-family:var(--font-mono); color:var(--bg300); font-size:9pt; letter-spacing:0.14em; text-transform:uppercase; margin-top:40px; }
  .page-break { page-break-before:always; }
  .toc-page { page-break-after:always; }
</style></head>
<body>${cover}${toc}${body}</body></html>`;

fs.writeFileSync(path.join(DIR, ".manual.html"), doc);

const b = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
const p = await b.newPage();
await p.goto("file://" + path.join(DIR, ".manual.html"), { waitUntil:"networkidle" });
await p.waitForTimeout(800);
await p.pdf({
  path: path.join(DIR, "ARCARNA-Staff-Training-Manual.pdf"),
  format:"A4", printBackground:true,
  margin:{ top:"15mm", bottom:"16mm", left:"16mm", right:"16mm" },
  displayHeaderFooter:true,
  headerTemplate:"<span></span>",
  footerTemplate:'<div style="width:100%; font-family:monospace; font-size:7pt; color:#7D8FA6; padding:0 16mm; display:flex; justify-content:space-between;"><span>arcarna · staff training manual</span><span class="pageNumber"></span></div>',
});
fs.unlinkSync(path.join(DIR, ".manual.html"));
await b.close();
console.log("manual built");
