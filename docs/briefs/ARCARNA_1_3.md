# arcarna 1.3

Tidying found while the shop uses the system, plus the 8 October 2026 order-form handoff. One piece at a time. Production deploy is a separate step.

The database move off Neon is **not** part of 1.3. It stays a separate plan.

## On the till now

One order screen, in a larger window over the Operations Centre board. A strip of the board stays visible on the left and keeps updating. **Back to board** tucks the window away. On a phone the Board and New order tabs stay as they are. Products are on the left when the window is wide, and customer, fulfilment and payment are on the right. The total and **Create order** stay at the bottom. There is no Continue to payment step. The line count and the item count are shown separately. Top sellers stay one sideways row, with previous and next controls.

Also shipped:

- A quantity can be typed, including 100, 500 and 1000. The line total updates as soon as the number is valid. The box can be empty while it is being edited. A bad quantity stays on the line with an error and blocks Create order. Minus and plus step from the last valid number, so 1000 then plus is 1001.
- The payment button says **Create order** for cash, card, transfer, credit, gift card and a split. Personal use still says **Log personal use**. One line under the payment choices says what that choice does.
- Empty search is Light Blue. A filled price or quantity is the darker Truth Blue with white text. After a payment choice, the others are charcoal and still selectable.
- Order date and due time open from the field or the icon. A +minutes choice is saved as a clock time in the shop’s timezone, so it is not added again later. A future day asks for a clock time instead. A time that has already passed is named.
- Managers and admins see **View all past orders** on the selected customer. The list loads in pages. Opening an order remembers the sale being built, and Back to the order puts it back.
- **Actual profit** on Profit Truths is takings, minus stock cost, minus order expenses, minus overheads. The same figure is on the Truths widget and, for admins, on Control Centre for today. Weekly Margin is named **Margin on goods** and does not take expenses off.
- A manager can **Change customer** on an open order (Walk-in to a name, or the wrong person to the right one). Finished orders, credit already opened, and orders that used points stay as they are.
- An unfinished order is saved on the server for the person using the till, about half a second after a change. The header says Saving, Saved, Waiting to sync, or Could not save. **Drafts** on the board opens one again. Discard is explicit. A draft does not take payment, move stock, or issue an invoice. If the same draft is saved from another till, this till asks which copy to keep. A gift card code is not stored in the draft. This browser also keeps a copy for this person and this shop if the save does not get through.

## Still to do, in this order

1. **Order numbers** starting 440400001 and invoice numbers starting 440000001, allocated on the server, without renumbering anything already issued. Until then, past orders show the start of the existing reference.
2. **Design-system note** for the rest of the empty, filled, selected, invalid and disabled states.

The handoff HTML (`arcarna-order-review-v4.html`) is the picture. Its density, colour and layout menus are review tools and must not become settings in the till.
