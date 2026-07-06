# arcarna — Privacy Policy

**Version:** 1.0 (draft) · **Last updated:** [DATE]

> ⚠️ **Legal review required.** This is a working draft prepared to reflect how the arcarna system actually handles data. It is **not** legal advice and has **not** been reviewed by a qualified solicitor. Before publishing or relying on it, have it reviewed by a data-protection lawyer, complete every **[BRACKETED]** placeholder, and confirm it against your registrations (e.g. UK ICO) and your actual sub-processor contracts. Placeholders left unfilled are not safe to publish.

---

## 1. Who we are

This policy explains how **[LEGAL ENTITY NAME]** ("arcarna", "we", "us"), operator of the arcarna platform, handles personal data. 

- **Registered address:** [ADDRESS]
- **Contact for privacy matters:** [PRIVACY EMAIL]
- **Data protection contact / DPO (if appointed):** [NAME / EMAIL]
- **ICO registration number (UK):** [NUMBER]

arcarna is a point-of-sale and business-intelligence platform used by independent businesses ("**merchants**") to run their shops. This policy covers personal data we handle as part of providing that service.

## 2. Two roles: controller and processor

Data protection law distinguishes the party that decides *why and how* data is processed (the **controller**) from the party that processes it *on the controller's behalf* (the **processor**). In arcarna these roles apply as follows:

- **For a merchant's own customers' data** (the shoppers a merchant sells to — their names, contact details, purchase history, loyalty points, credit balances): the **merchant is the controller**, and **arcarna is the processor**, handling that data only to provide the service and on the merchant's instructions. If you are a shopper and want to exercise your rights over your data, contact the merchant you shop with; we will assist them.
- **For merchant account and staff data** (the businesses and staff who sign up to and use arcarna — account details, login identity, roles, usage): **arcarna is the controller**.

This policy describes both. Where a section applies to only one role, it says so.

## 3. What data we handle

### 3.1 Merchant accounts and staff (arcarna as controller)
- Identity and contact: name, email, and authentication identity managed by our authentication provider.
- Role and permissions, organisation and location assignments.
- Business profile you enter: trading name, address, company/VAT number, contact details, branding, bank/payment details shown on invoices.
- Operational usage needed to run and secure the service (e.g. shift records attributed to a cashier, audit logs of access-control actions).

### 3.2 A merchant's customers (arcarna as processor, on the merchant's behalf)
- Customer records: name, phone, email, address, receipt-email preference, category/tier.
- Transaction history: orders, line items, totals, refunds, invoices.
- Loyalty: points balance and ledger, tier.
- Credit ("tick") balances owed.
- Where the merchant uses WhatsApp: message content and conversation metadata exchanged with that customer.

### 3.3 Payment data
arcarna records the **payment method used** (cash, card, transfer, credit, gift card) as a label. arcarna does **not** capture, store or process full payment-card numbers; card payments are taken on the merchant's own card terminal/processor. [CONFIRM this matches your actual setup and state your card processor if applicable.]

### 3.4 Technical data
- Log and security data (e.g. request identifiers, error reports, rate-limiting data).
- Data stored on the device by the Progressive Web App (offline order queue and cached app data) to allow offline trading; this syncs to our servers when the device reconnects.

## 4. Why we process it, and our legal bases

| Purpose | Data | Lawful basis (UK GDPR) |
|---------|------|------------------------|
| Provide the arcarna service to merchants | Account, staff, operational data | Contract |
| Process merchant customers' data to run the shop | Customer, transaction, loyalty, credit data | Processor acting on the merchant's basis (the merchant determines the basis — typically contract or legitimate interests) |
| Secure the service, prevent abuse, keep audit logs | Technical, security, audit data | Legitimate interests; legal obligation |
| Communicate about the service | Account contact data | Contract; legitimate interests |
| Send transactional emails (receipts, invoices) on a merchant's behalf | Customer contact data | Processor, on the merchant's basis |
| Meet legal/accounting/tax obligations | Transaction and account records | Legal obligation |

We do not sell personal data. We do not use merchant customers' data for our own marketing.

## 5. Who we share data with (sub-processors)

We use trusted service providers to run arcarna. Each processes personal data only as needed to provide their service to us, under contract. Current sub-processors:

| Provider | Purpose | Data involved |
|----------|---------|---------------|
| [Clerk] | Authentication / sign-in | Staff/account identity and login |
| [Resend] | Transactional email (receipts, invoices) | Recipient email and message content |
| [Meta / WhatsApp Business] | Messaging (if the merchant enables it) | WhatsApp message content and metadata |
| [Neon / PostgreSQL host] | Primary database | All stored data |
| [Cloudflare R2] | Encrypted off-site backups | Backup copies of stored data |
| [Sentry] (if enabled) | Error monitoring | Technical/error data |
| [Hosting/VPS provider] | Server hosting | All processed data in transit/at rest |

[Maintain this list accurately; it is a legal requirement to disclose sub-processors. Add each provider's own privacy/DPA reference.]

We may also disclose data where required by law, to establish or defend legal claims, or to protect the rights and safety of users.

## 6. International transfers

Some providers in §5 may process data outside the UK/EEA. Where they do, transfers are protected by an appropriate safeguard (e.g. UK International Data Transfer Agreement / Addendum, EU Standard Contractual Clauses, or an adequacy decision). [CONFIRM the mechanism for each provider and state it here.]

## 7. How long we keep data

- **Merchant customer data (as processor):** kept for as long as the merchant's account is active and the merchant instructs, then deleted or returned on termination per our agreement with the merchant.
- **Account and transaction records:** retained as needed to provide the service and to meet legal, tax and accounting obligations (typically [6–7] years for financial records).
- **Admin audit logs:** retained **7 years** to satisfy access-control forensics and compliance.
- **Backups:** retained on a rolling basis (currently [30] days) and then overwritten.
- **Offline device data:** cleared when a user signs out or the browser data is cleared.

[Confirm each period with your accountant/lawyer.]

## 8. Your rights

Depending on your relationship to the data, you have rights under UK GDPR including: access, rectification, erasure, restriction, portability, objection, and rights regarding automated decision-making.

- **Shoppers:** contact the merchant you shop with (the controller). We will support the merchant in fulfilling your request.
- **Merchants and staff:** contact us at [PRIVACY EMAIL].

You also have the right to complain to the UK Information Commissioner's Office (ICO) at ico.org.uk.

arcarna does not make solely automated decisions that produce legal or similarly significant effects about individuals. Its analytics (e.g. customer segments) are decision-support for the merchant, who remains the decision-maker.

## 9. How we protect data

- Encryption in transit (TLS) and encrypted backups.
- Strict per-merchant data isolation — one merchant's data is never returned to another.
- Access controls and role-based permissions; multi-factor authentication for privileged accounts.
- Security headers, rate limiting, and append-only audit logging of access-control actions.
- Secrets held only in the server environment; production configuration validated at start-up.

No system is perfectly secure, but we take appropriate technical and organisational measures proportionate to the risk. In the event of a personal data breach, we will meet our notification obligations (including notifying the ICO within 72 hours where required, and affected individuals where the risk is high).

## 10. Cookies and similar technologies

arcarna uses only the storage necessary to run the application and keep you signed in (including local device storage for offline trading and authentication tokens). We do not use third-party advertising cookies. [If any analytics/marketing cookies are added, list them and provide a consent mechanism.]

## 11. Children

arcarna is a business tool and is not directed at children. We do not knowingly process children's data through it.

## 12. Changes to this policy

We may update this policy. We will post the new version with an updated date and, for material changes, notify account holders.

## 13. Contact

Questions or requests: **[PRIVACY EMAIL]**, or write to us at **[ADDRESS]**.

---

*Draft prepared to match the arcarna system's actual data handling. Complete all placeholders and obtain qualified legal review before use.*
