# Shared brief — arcarna staff training manual sections

You are writing ONE section of the arcarna staff training manual. Every section
must look and read like Section 1. Read these two files first, and copy their
structure exactly:

- `docs/training/sections/01-getting-started.html` — the exemplar. Mirror its
  HTML structure element-for-element (brand-band, chapter-open, eyebrow, h2/h3,
  tables, callouts, ol.steps, figure/figcaption).
- `docs/training/brand.css` — the stylesheet. Do NOT edit it. Only use classes
  that already exist in it.

## Non-negotiable brand rules (from the arcarna Brand Bible v1.0)

1. **The product name is `arcarna` — lowercase, always**, including at the start
   of a sentence. Never "ARCARNA", never "Arcarna". (Screenshots may show the
   app's own uppercase wordmark — that's fine; your prose is always lowercase.)
2. **Sentence case** for every heading and label. Never Title Case, never ALL CAPS.
3. **British English**: colour, realise, organise, centre.
4. **Calm, evidence-led, plain.** Short sentences. No hype. No exclamation marks.
   **No emoji anywhere.** Explain before instructing.
5. **Use arcarna's vocabulary, not generic software words:**
   | Say this | Not this |
   |----------|----------|
   | Control Centre | dashboard |
   | Truths | insights |
   | Evidence | reports |
   | Signals | notifications / alerts |
   | Next moves | recommendations |
   | Business Health | KPIs / metrics |
   Forbidden words entirely: dashboard, analytics, AI-powered, magic,
   revolutionary, game-changing, world-class, leverage, utilise, synergy.
6. **Numbers**: British currency like £1,240.50; percentages state their window
   (e.g. "down 7% vs last 30 days"). Losses/negatives are fine as plain signed
   numbers.
7. **Colours** come only from brand.css variables (Truth Blue #3C7AC4 etc). You
   won't set colours directly — the existing classes handle it.

## Audience & tone

Written for shop staff who have never used the system — a cashier on their first
shift, a manager learning the back office. Assume no technical knowledge.
Every instruction is a concrete step. Explain what a screen is *for* before how
to use it. Use the role tags `<span class="role role-cashier">CASHIER</span>`
and `<span class="role role-manager">MANAGER</span>` in the intro and wherever a
task is role-specific.

## Structure your file exactly like this

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>arcarna training — N. Section title in sentence case</title>
<link rel="stylesheet" href="../brand.css" />
</head>
<body>
<main class="section" id="short-id">
  <div class="brand-band">
    <img src="../images/brand/arcarna-wordmark.png" alt="arcarna" />
    <span class="band-tag">Staff training manual</span>
  </div>
  <div class="chapter-open">
    <div class="chapter-num">0N</div>
    <div class="chapter-title">Section title, sentence case</div>
    <p class="chapter-lead">One or two sentences: what this section covers and why it matters.</p>
  </div>

  <!-- then repeating blocks of: -->
  <p class="eyebrow">Short label · in context</p>
  <h2>A section heading, sentence case</h2>
  <p>Body text …</p>
  <!-- tables, ol.steps, callouts, figures as needed -->
</main>
</body>
</html>
```

Use the same building blocks Section 1 uses:
- `<p class="eyebrow">…</p>` before each `<h2>` (Plex-mono uppercase label).
- `<ol class="steps">…</ol>` for step-by-step instructions.
- `<table>` for reference/what-it-means tables (first column = the thing, second = plain-English meaning).
- `<div class="callout">` for tips; `<div class="callout warn">` for manager/important notes. First `<strong>` in a callout is its title.
- `<h3>` for sub-sections inside an `<h2>`.

## Screenshots — DO NOT capture them yourself

Insert a `<figure>` where a screenshot belongs, and describe it in an HTML
comment so the orchestrator can capture it centrally and consistently:

```html
<figure>
  <img src="../images/0N-short-name.png" alt="Plain description of what's shown" />
  <figcaption>Caption in sentence case — what the reader is looking at.</figcaption>
  <!-- SHOT: route=/create-order ; show=the product grid with the cart on the right ; state=none -->
</figure>
```

- Use image filenames `0N-short-name.png` (your section number, then a short slug).
- `route=` the in-app path to visit. `show=` what should be visible. `state=`
  any setup needed (e.g. "a shift must be open", or "none").
- Aim for 2–5 screenshots per section — enough for clarity, not clutter.

## Accuracy — read the real UI

To describe the real screens accurately, READ the relevant page component(s)
under `client/src/pages/` for your area (your section prompt names them). Base
labels, button names and field names on what the code actually renders. Do not
invent features that aren't there.

## Output

Write your finished HTML to the path given in your section prompt. Do not touch
any other file. Do not run git. When done, reply with: the file you wrote, the
list of screenshot specs (filename + route + what to show), and any point you
were unsure about for the reviewer.
