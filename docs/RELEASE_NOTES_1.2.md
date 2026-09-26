# arcarna 1.2: release notes

For everyone who works in the shop, and for the owner. Grouped by who it affects. Every page named here is in the menu under the Centre shown in brackets. **v1.2.1**, a hardening round with two small new features, is covered in its own section right after this introduction; everything below it is unchanged from v1.2.

The first time you sign in after an update, a short **What's new** window lists the changes for your role. Each new page also shows a short tour the first time you reach it (once per account, on every device). **Replay tour** in the menu shows it again: on a page with one of these features on screen it replays that feature's tour, and on any other page it replays the Centre's tour.

---

## v1.2.1: a hardening round, plus two small features

A follow-up to v1.2, a few days later: figures checked against the shop's own data, a security sweep, hard use testing, and every page checked on desktop and phone. Nothing here needs any setup.

### For everyone
- **"This customer already owes" shows at the till.** Start an order for a customer with a Credit List balance — the till, the Operations board's order form and phone orders all show it — and a notice gives the amount, how many tabs it is spread over and the oldest one's date, with a reminder to record any payment. **Take a payment** sits right there for cash or card, part or in full. It never stops the sale.
- **Delivery fee, on its own line.** Add the shop's delivery fee to a delivery order with one tap; the amount can be changed or removed on that order. It is never folded into a product's price: it shows as its own line on the receipt and invoice, and its own figure in the Truths Centre. It is left out of commission and margin unless an admin turns that on.
- Refunding a sale now always gives back what the customer actually paid — including its share of a promotion or points discount — and never more than the sale actually took. A refund on a tick sale that was never paid, or a Card (link) payment still pending, is refused with a plain reason instead of paying cash out of the drawer.
- A handful of small things staff would have hit are fixed: a double-tapped refund could refund the same item twice; the last unit could be sold at two tills at once; a very large or oddly typed amount gave a confusing error instead of a clear one.

### For managers and admins
- A promotion (only a manager or above can create one) that takes an item below its minimum or below cost no longer shows in **Truths Centre → Would have flagged**. An item that was already underpriced before the promotion still does.
- Keying in a forgotten sale still lands it on the day it happened, in every figure, as before — up to 7 days back. It now also raises a **Signal** to managers and admins naming the date, since that day's frozen close from its own 06:00 does not know about the late entry until the owner's figures check is next run.
- A settled sale can no longer be deleted once its drawer has been counted and closed; refund it instead, or reopen the shift first.
- Every Centre page was checked on both a computer and a phone screen: dead links, pages that scrolled sideways, buttons too small to tap or hidden behind others, and a handful of console errors are all fixed.
- A security sweep checked every route with two separate businesses and every role: an admin of one business could delete or take over another business's staff, and a couple of smaller holes (a script-injection spot in the receipt preview, cross-site form submissions) were closed.

### For the owner
- A read-only script, `scripts/reconcile-figures.ts`, checks the shop's live figures against a recount of the raw sales and refunds and lists anything that does not add up, in plain English. It changes nothing; run it any time, e.g. `npx tsx scripts/reconcile-figures.ts --days 30`.
- Set the shop's real delivery fee in Settings (it starts at a guess of £3.00).
- A database lock-up that could very occasionally show "Failed to update order" when completing a tick sale is fixed.

## Everyone

### arcarna is arranged into Centres
- The main menu lists the Centres: Control, Operations, Stock, Truths, Customer, Finance and Settings. You only see the Centres your role can open. Pick one and the menu switches to its pages, with **← Main menu** to go back.
- On a computer the menu opens when you point at it and tucks away when you move off. The **pin** keeps it open beside the page on that device. Tablets and phones tap to open, as before.
- The small heading above each page's title names its Centre.
- New orders are taken on the **Operations board** (Operations Centre). Old links to the till and to Create order open it on the order pane.

### My run: deliveries on your phone (Operations Centre › My run)
- Your deliveries that are ready or out for delivery, in your order. Drag a stop, or use the up and down arrows, to change the order. It is kept for today.
- Each stop shows the order code, the customer's name, the address and postcode, notes, the number of items, any amount unpaid on tick, and the due time.
- **Navigate** opens directions: Apple Maps on an iPhone, Google Maps otherwise.
- Tick the stops you are taking (or **Select all**), then **Start run**. They move to out for delivery.
- **Call** appears once a stop is out for delivery. It shows the customer's number to you, the person the delivery is assigned to, only while it is out. Every time it is shown is logged.
- **Delivered** completes the order. **Couldn't deliver** asks for a reason (No answer, Wrong address, Refused, or Other with a note). The order goes back to ready and managers get a Signal.
- No signal? The last loaded run stays on screen. Delivered and Couldn't deliver taps are kept on the phone and sent when you are back online. Start run and Call need a connection.
- Managers can pick whose run to look at.

### Card (link): the customer pays on their own phone (till)
Only shown once the owner has set up Stripe (see "What the owner must set up").
- At Pay, choose **Card (link)**. It can also be one row of a split payment.
- The sale is recorded, then a large QR code for exactly the amount due appears, with a link you can copy. If WhatsApp is set up and a customer is on the sale, **Send by WhatsApp** sends the link. You never see their number.
- The customer pays by card on their phone and the sale marks itself paid when Stripe confirms. Until then the Operations board shows **Awaiting card payment**.
- **Cancel link**, or the link running out, lets you take the payment another way (cash, card or transfer).
- Card (link) takings show as card, and on their own line on the shift's Z report. Refunds for these payments are made in Stripe, not in arcarna.

### Label printing on a Niimbot B1
- Pair the printer once on each till in **Settings › System › Devices · Label printer**. That card also prints a test label.
- **Print label** on an order's details on the Operations board prints an order label: order code, customer name only, delivery or collection, due time, number of items and a QR code that opens the order.
- Managers also get a label button on each product in **Products**: name, price and barcode. Never cost.
- Labels are 50 × 30 mm. Printing uses Bluetooth from the browser, which only some browsers have. Use **Chrome** (or Edge) on a computer, or the free **Bluefy** app on an iPhone or iPad. Safari cannot print labels. The page says what to do on the device you are using.

### Every sale recorded once, offline too
- Each sale carries its own reference, so a sale retried after a slow connection is never recorded twice.
- A sale made offline is kept and sent later. The offline line shows how many are waiting and how many failed.
- You cannot sign out while sales are still unsent. A manager can sign the till out anyway, and that is logged.
- Sales the server refuses go to **Needs attention** (Operations Centre, managers) to retry, edit or discard. None are dropped silently.

### Problem? button
- **Problem?** is in the header and on the till. Pick what happened (Too slow, Can't find it, Did the wrong thing, Error message, Other) and add a note if you like. Please don't type customer details.
- It sends the screen, your role, the device name, the version and whether you were online. When it is fixed, you get a "fixed in version …" Signal.
- Name each device once in **Settings › System › This device** (Till 1 to 6, Counter tablet, Phone 1 to 6).

### My performance (Operations Centre › My performance)
- Your own figures for any period: orders, value brought in, commission, speed, targets and badges. Nobody else's figures are shown, and there is no ranking.
- A team median appears only when the team has 4 or more people. Today's figures are provisional.
- The figures are a guide. No pay decision is made from them alone. See `docs/staff-performance-notice.md`.

### Other changes
- Signals now go to the people they concern, and each person has their own read state: clearing one on your account leaves it on everyone else's.
- Loyalty points, tier discounts and promotions are worked out the same way at the till and on the server, so what is recorded is what the customer was charged.
- Personal use sales at the till work again.
- A new shop's VAT rate now starts at 0%. Existing shops keep their rate, and order edits use the shop's own rate.

---

## Cashiers and drivers

- **Customer details stay private.** You see a customer's name, tier and points. Phone and email are masked, for example ••4821 and j•••@gmail.com, so you can tell two customers apart but not contact them. You can still type in a new customer's details.
- **Delivery address on the order.** A Delivery sale needs an address and postcode on the order itself. All staff see it while the order is live.
- **Finding a customer by phone.** Type their full number: an exact match finds them. There are no partial matches.
- **Stock levels** (Stock Centre) shows how many of each product your location has. It is read-only and has no cost prices.
- **Your order history** is today plus the orders you took or completed in the last seven days.
- **Credit List and Invoices** are now for managers and above.
- **Price guard.** When the owner switches it on, a price below an item's lowest price shows one amber line. You can still sell at that price: choose a reason at Pay and a manager sees it. You never see cost.

---

## Managers

### Needs a look (Operations Centre › Needs a look)
- One inbox for sales below the minimum or below cost, refunds the refund rules pick out, weekly patterns, and contact-details requests.
- Each item can be marked **Acknowledged**, **Explained** or **Escalated**, with a note. Escalating tells the people above you. Nothing here was blocked.
- Managers see items about cashiers. Items about a manager go to admins only.
- The top line counts items left unreviewed for more than 7 days.

### Staff Performance and Order Timing (Truths Centre, also under Finance)
- **Staff Performance** replaces Staff KPI. It shows one row per person for any dates, compared with the period before, with filters for location, role, fulfilment and channel. It counts the same completed orders as sales Evidence, so the rows plus Admin cover and Unattributed add up to the sales you took.
- There are six views: **Volume, Value, Quality, Benefit, Speed** and **Fairness**. Value brought in is split like commission: 100% when one person did the whole order, otherwise 90% to whoever completed it and 10% to whoever keyed it in. **Net benefit** is margin less discount, price-exception cost and personal use. It is not profit.
- Pick a person to see their 8-week trend and their orders.
- **Order Timing** shows how fast orders move and where they wait. Group it by fulfilment, by who claimed, completed or keyed in the order, or by hour, day or channel.
- Per-person figures are marked **Provisional** at first. Check them against the team totals before acting on them.
- **Staff targets** (Truths Centre) shows the targets. Only admins can change them.
- Each Monday after the 06:00 close, a weekly staff digest is built for each person at the moment it is sent, covering only what their role may see. It is emailed when email is set up, and a Signal says it is ready.

### Customer contact details (Customer Centre › Customers)
- Phone and email are masked for managers too. Only admins see contact details.
- **Contact** on a customer offers **Message the customer instead** first. arcarna sends an approved WhatsApp message (order ready, delivery update, payment reminder, or "please call us on" the shop's number), and nobody sees the number.
- If you really need the details, request them there. Give a reason (complaint, refund or return, delivery problem, lost property, debt chase, or other), a note of at least 15 characters and the fields you want. An admin approves or declines. An unanswered request lapses after 48 hours.
- Once approved, you have 24 hours on that one customer. Each field is shown only when you tap it, and every tap is logged. You can end the access early.
- When editing a customer, the phone box is **Replace number**: you can type a new number but not read the old one.
- **Credit List** has **Send payment reminder**. Invoices have **Email invoice to customer** when email is set up.

### Prices
- **Minimum price** on each product. Until you set one, it follows the sale price. A minimum above the sale price is refused. Managers and admins can edit it.
- **Price history** on a product shows every sale price, minimum and cost change: who made it, when, and the old and new values.
- **Set minimum price** changes many products at once: follow the sale price, sale price less a %, cost plus a %, or a fixed £. You see a preview first.
- **Price overrides** (Truths Centre) breaks underpriced sales down by cashier, product and reason.

### Elsewhere
- The Truths Centre opens on **Truths at a glance**: the widgets an admin chose, each stating its time window. **Reports** are now called **Evidence**, and the Evidence guide lists every piece of Evidence and what it shows.
- **Suppliers** moved to the Stock Centre. Each supplier's products show the supplier price beside the product's cost, with a flag when they differ by more than 2% or one is missing.
- Cost prices, Evidence and Truths are for managers and above. They never reach a cashier, not even in the data.
- Manager edits to an order show Subtotal, VAT and Total and keep the order's discounts. Cash tab repayments count towards expected cash and have their own line on the Z report.

---

## Admins (and the owner)

- **Contact-details requests** arrive as a Signal and in **Needs a look**: **Approve for 24 hours** or **Decline**, and **Revoke access** later if needed. Each customer's **Contact** has an **Access history** tab: every reveal, call, replaced number, export, request and message.
- **Price guard at the till** (Settings › General) is **off** to start. While off, the till shows nothing and underpriced sales are recorded silently for **Would have flagged** (Truths Centre). Turn it on for the amber line, the reason at Pay and Signals. Every change is logged.
- **Signals and refund rules** (Settings › General): when managers hear about sales below the minimum (straight away or twice a day), and which refunds go to Needs a look. The defaults are a cash refund over £50, a refund more than 14 days after the sale, and a refund on the same cashier's sale within 24 hours. Refunds are never blocked.
- **Staff targets** are set by admins only. Changes are logged and versioned.
- **Problem? inbox** (Truths Centre) lists what staff reported. Marking one fixed tells the reporter.
- **Preview as** (in the header, on a computer) shows arcarna as a cashier or manager would see it.
- **Customer privacy notice and complaints contact** (Settings › General) is shown on the shop site and on receipts once it is filled in.
- Exports are for admins only, and every export is logged.

### The owner only
- **Customer data access** (Settings Centre) lists every look at customers' contact details across the shop. You also get a weekly Signal summarising it.
- **Friction Truths** (Truths Centre) shows where staff get stuck: screens, active time, messages, slow calls and device health, by role and never by person. It says "Not enough data yet" for the first weeks. Every Monday you get the five worst or fastest-rising screens.

---

## Ask arcarna (the AI assistant)

Ask arcarna is in this build, but it stays **off and hidden** until the owner adds an Anthropic API key (see below).

- Open it from the **speech-bubble ? icon in the header** (labelled "Ask arcarna" on wide screens) or **Ask arcarna** in the Truths Centre. Ask in plain English, e.g. "How am I doing this week?" or "Which products sold below minimum this week?". Suggested questions for your role are shown to get you started.
- It answers from the shop's own Evidence and reports, and **only what your role can already see**:
  - Cashiers get their own performance, their targets and stock levels. They never get cost, margin or other people's figures.
  - Managers get Needs a look (only for people they outrank), staff performance and the Evidence they can open.
  - No role gets a customer's phone, email or address through it.
  - Ask about something outside your role and it says so instead of guessing.
- It is **read-only**: it cannot change a sale, a price or anything else.
- Each answer lists the Evidence it used, with links. Check important figures there.
- Answers stream in as they are written. **Stop** ends one early. The conversation is cleared when the page reloads.
- Questions are sent to Anthropic's API to be answered. Anthropic does not train on API data by default. If Claude declines a question, it is retried once on another Claude model.
- For admins, **Settings › Integrations › Ask arcarna** shows:
  - whether it is set up;
  - this month's spend against the monthly cap (default **£25**; £0 pauses it);
  - the dollar-to-pound rate used for estimates;
  - recent questions: who asked, when, what it looked at and the estimated cost. The answer is not stored, and phone numbers, emails, card numbers and postcodes are removed from the stored question.
- Each person can ask 10 questions in any 10 minutes.
- Please don't type customer details into a question.
- Privacy details: `docs/ask-arcarna-privacy.md`.

---

## What the owner must set up

| For | What to do |
|---|---|
| **Card (link)** | Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the server's `.env` and restart arcarna. **Settings › Payment › Card (link) with Stripe** shows the exact lines, the webhook address to register in Stripe (`…/api/stripe/webhook`) and the events to send (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`). Until both are set, Card (link) is hidden at the till. |
| **Ask arcarna** | Add `ANTHROPIC_API_KEY` to the server's `.env` (optionally `ARCARNA_AI_MODEL`, default `claude-opus-5`, and `ARCARNA_AI_EFFORT`, default `medium`) and restart. Accept Anthropic's Data Processing Addendum and list Anthropic as a processor in the privacy notice (see `docs/ask-arcarna-privacy.md`). Check the £25 monthly cap in Settings › Integrations. It stays hidden until the key is set. |
| **Niimbot label printer** | On each till that prints: open arcarna in Chrome (computer) or Bluefy (iPhone), go to **Settings › System**, **Pair a printer** and print a test label. Pairing is remembered on that device only. |
| **WhatsApp messages** | Message the customer instead, Send payment reminder and Send by WhatsApp use approved WhatsApp templates only. In **Settings › Integrations › WhatsApp Business**, **Sync templates**, then submit them for approval in Meta's WhatsApp Manager. This includes the new `please_call_us` template. Unapproved templates are refused. Fill in the shop's phone number in **Settings › General** so "please call us" can name it. From 1 October 2026, each message costs about £0.016. |
| **Delivery fee** | Set the real price in Settings (Delivery fee). It defaults to £3.00. |
| **Figures check** | Run `npx tsx scripts/reconcile-figures.ts --days 30` any time — read-only, and lists anything that does not add up. |
| **Email invoices** | Set `RESEND_API_KEY` (and the sending address) on the server. Until then, Email invoice is turned off and says why. |
| **Price guard** | Leave it off for the silent recording period, then turn it on in **Settings › General**. |
| **Staff targets** | Set them in **Staff targets**. The first 4 weeks are amber only. |
| **Device names** | On each till, tablet and phone: **Settings › System › This device**. |
| **Privacy notices** | Publish `docs/staff-privacy-notice.md` and `docs/staff-performance-notice.md` to staff. Fill in the customer privacy notice in **Settings › General**. |

## Not in this release
- Refunds of Card (link) payments are made in Stripe, not arcarna.
- Voice: the old voice assistant no longer saves orders; it opens a draft in the till. A new voice assistant will be built on Ask arcarna later.
- Screen recordings of chosen screens ("improvement studies") are prepared but switched off.
