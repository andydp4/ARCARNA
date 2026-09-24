# Ask arcarna: what is sent, what is kept, who sees it

*v1.2. For the owner and admins; the staff notice (docs/staff-privacy-notice.md)
has the short version.*

Ask arcarna answers staff questions in plain English ("how did we do last
Saturday vs the one before?") from the shop's own records. It is read-only: it
cannot change anything. It is **off and hidden** until `ANTHROPIC_API_KEY` is
set in the server's `.env`, and an admin can pause it at any time by setting
the monthly limit to £0 (Settings › Integrations).

## Who runs the AI

Answers are written by Anthropic's Claude (model `claude-opus-5` by default,
`ARCARNA_AI_MODEL` to change it), called through Anthropic's API with the
shop's own API key.

- **Training:** Anthropic does not train its models on data sent through its
  commercial API by default.
- **Retention:** Anthropic keeps API inputs and outputs for a limited period
  under its commercial terms and privacy policy (check the current period at
  anthropic.com/legal before relying on it), for example to detect misuse.
- **Contract:** Anthropic offers a Data Processing Addendum (DPA) for API
  customers; the business should accept it before switching this on, and list
  Anthropic as a processor in its own privacy records.
- **Refusal fallbacks:** if Claude's safety checks decline a question, the API
  may re-run it on another Claude model (the "server-side fallback" feature).
  It is the same provider and the same terms.

## What is sent to Anthropic

For each question:

- the question, and up to the last ten questions and answers from the same
  conversation on that device;
- a fixed set of instructions (the same for every shop), today's date and the
  asker's **role** (never their name, email or login);
- the results of the look-ups Claude asks for, described below.

## What the look-ups can return

Each look-up checks the asker's role on the server with the same rules as the
matching page, so a question never reaches more than the person could already
see on screen.

| Look-up | Who can use it | What it returns |
|---|---|---|
| List of Evidence | Managers and above | Evidence names and purposes the role may open |
| An Evidence report (daily and weekly sales, stock, margin, order timing, satisfaction, reseller credit, customer lapse, lifetime value, stock runway, segments, churn, product affinity) | Managers and above; Staff Performance by ref is admins and above | The report's summary and up to 25 rows |
| My performance | Everyone | The asker's own figures only, including their own commission |
| Staff Performance | Managers and above | People the asker may see (a manager sees cashiers and themselves) |
| Needs a look | Managers and above | Flags about people the asker outranks: who, what, amount, state |
| Price overrides | Managers and above | Under-list sales by person, product and reason |
| Would have flagged | Admins and the owner | What the price guard would have flagged |
| Stock levels | Everyone | Product name, SKU, barcode, count and out/low/ok at their location |
| Staff targets | Everyone | The targets in force |

On top of the role checks, every result is cleaned before it is sent:

- **customers' phone numbers, email addresses and addresses are never sent**,
  for any role (whole fields removed, and anything in free text that looks like
  a phone number or email address replaced with "[removed]");
- **cost prices, margins and profit are never sent for a cashier.**

Customer **names** can appear in manager-and-above Evidence (for example the
lifetime value report), as they do on those pages.

## What arcarna keeps

One row per question in `ask_questions`: who asked, their role, when, which
look-ups ran, token counts, the estimated cost in pounds and how it ended
(answered, refused, cut short, error, stopped). The question itself is kept
**for admins and the owner only**, with phone numbers, emails, card numbers
and postcodes removed first. A customer's name typed into a question cannot be
detected automatically, so staff are asked not to type customer details.
**The answer is never kept**, and the conversation lives only on the device
(it is gone when the page is reloaded).

Admins and the owner see the recent questions in Settings › Integrations ›
Ask arcarna. Changes to the monthly limit and exchange rate are logged in the
admin audit log.

## Cost controls

- A per-person limit: 10 questions in 10 minutes.
- A monthly limit per shop in pounds (default £25), estimated from Claude's
  published price ($5 per million input tokens, $25 per million output tokens;
  cache writes 1.25x and cache reads 0.1x the input price) at the shop's
  dollar-to-pound rate (default 0.79). Once the month's estimate reaches the
  limit, new questions are refused until next month or until an admin raises
  it.
