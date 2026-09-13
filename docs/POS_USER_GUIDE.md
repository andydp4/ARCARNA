# POS user guide

## Taking an order — it's now inside the Operations Centre

There is no longer a separate till page. Taking an order and working the
board are the same screen: go to **Operations** in the sidebar (`/operations`)
— on a tablet or desktop wide enough, the order form sits in its own pane
beside the board; on a phone, tap the **New order** tab next to **Board**.
The old `Create Order` and `POS` links still work, they just land you here
automatically.

Everything about building a sale — the product grid, scanning, the cart,
payment — works exactly as before inside that pane. What's new is on the
payment step, next to fulfilment:

- **Due** chips (+5, +10, +15, +30, +45, +60 minutes, or a specific time) —
  set the promise you're giving the customer. Delivery pre-selects +45
  minutes; phone and WhatsApp orders pre-select +30. A pre-order (a date in
  the future) requires a time.
- **Channel** chips — Walk-in, Phone, or WhatsApp, so an order taken over the
  phone doesn't look identical to a counter sale in reports.
- **Looked after by** — who's dealing with this order. It defaults to
  whoever is keyed in and on shift at the right station, but you can hand it
  to someone else here before the sale even completes.

After you place the sale, the form resets and the new card flashes on the
board behind it for a few seconds so you can see where it landed.

## Working the board

Every order — till, phone, WhatsApp, website — is a card in **Collection** or
**Delivery**. Colour is the first thing to read: blue is on time, a second
lighter blue is ready, orange is delayed, red is late or the customer's here
waiting, and green is done. Each card has one big primary button for what
happens next — **Take it**, **Ready**, **Handed over**, **Out for
delivery**, **Delivered** — so completing an order is one tap, not a
drill-in. Everything else (hold, delay, pass to someone, rate the
collection, order details) is behind the **⋯** menu on the card.

## Alerts

Instead of a shared notification bell, you now get **personal** alerts on a
pulsing rail down the side of the board: an order assigned to you, one about
to come due, one that's now late, or a customer waiting. Each pulse comes
with a short chime (tap anywhere once at the start of your shift to allow
sound) and a line read out by screen readers, so you don't have to be
staring at the screen to notice. Tap an alert to jump straight to its card;
it clears itself once you deal with the order, or you can acknowledge it by
hand.

## Barcode scanner setup

Arcarna treats USB and Bluetooth **keyboard-wedge** scanners as a fast keyboard that types a barcode and sends Enter.

### Configure the scanner

1. Set the scanner to **keyboard wedge** mode (most retail scanners default to this).
2. Use a **suffix** of Enter/Return after each scan.
3. Avoid prefixes that inject into form fields unless required by your hardware.

### Using scans on the order form

- Scan while focus is **outside** search or quantity inputs → product adds to cart and plays a success beep.
- Scan while focus is **inside** a text field → characters go to that field normally (no cart add).
- Unknown barcode → fail beep and product search prefills with the scanned code.

### Test without hardware

Paste a 6+ character code and press Enter quickly, or use a scanner emulator that sends keystrokes with < 30ms gaps between characters.
