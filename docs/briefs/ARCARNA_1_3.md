# arcarna 1.3

Tidying found while the shop uses the system, plus the 8 October 2026 order-form handoff. One piece at a time. Production deploy is a separate step.

The database move off Neon is **not** part of 1.3. It stays a separate plan.

## This slice — quantities and Create order

Shipped in this change:

- A quantity can be typed, including 100, 500 and 1000. The line total updates as soon as the number is valid. The box can be empty while it is being edited. A bad quantity stays on the line with an error and blocks Create order. Minus and plus step from the last valid number, so 1000 then plus is 1001.
- The payment button says **Create order** for cash, card, transfer, credit, gift card and a split. Personal use still says **Log personal use**. One line under the payment choices says what that choice does.
- Empty search is Light Blue. A filled price or quantity is the darker Truth Blue with white text. After a payment choice, the others are charcoal and still selectable.

## Still to do, in this order

1. **One form, not two steps.** Products, fulfilment, customer and payment on one screen, with the board still visible behind a larger order overlay. The current “Continue to payment” step is still there so existing sales keep working.
2. **Date and time pickers** open from the field and the icon, and a resumed draft does not add another 30 minutes.
3. **Customer history.** View all past orders for the selected customer, then open the real order and come back to the draft. Managers and admins. This was also asked before the handoff.
4. **Actual profit.** One labelled total: takings minus stock cost minus order expenses minus overheads. The margins report is goods margin only. Profit Truths already has the fuller sum under “Bottom line”.
5. **Change the customer** on an order that is still open (left as walk-in, or the wrong person). Completed orders, credit and points wait.
6. **Autosaved drafts** on the server, with a Drafts list on the board. Closing the form must not lose the lines.
7. **Order numbers** starting 440400001 and invoice numbers starting 440000001, allocated on the server, without renumbering anything already issued. Check the live counters before seeding.
8. **Design-system note** for the rest of the empty, filled, selected, invalid and disabled states once the one-form layout exists.

The handoff HTML (`arcarna-order-review-v4.html`) is the picture. Its density, colour and layout menus are review tools and must not become settings in the till.
