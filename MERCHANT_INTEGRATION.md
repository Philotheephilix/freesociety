# Merchant Integration — Request Template

Errand is a permission-gated MCP commerce hub. Any company with a job an AI
agent should be able to do — but no MCP integration for it — can request one.
You open a **pull-request-style integration request**; our developers scope it,
build it into the hub, and your service's tools appear namespaced as
`<service>__*`, behind the same permission gate and pre-purchase spend cap as
everything else.

Building the integration is **free**. The only charge is **1% of Bitrefill's
commission** on settled transactions — no per-seat fee, no build fee.

## How to submit

1. **Copy the template below** into a new Markdown file and fill **every**
   section. The clearer the request, the faster it ships.
2. **Open it as a pull request** against this repo under `integrations/requests/`
   (e.g. `integrations/requests/acme-telecom.md`), or send it to the contact in
   the README if you prefer not to open a PR.
3. **Review.** We confirm feasibility, scope, and fit with the hub's safety model.
4. **Build.** Our developers implement the integration against your Acceptance
   test.
5. **Ship.** The new `<service>__*` tools appear on the hub via
   `notifications/tools/list_changed`; your agents call them like any other
   passthrough tool.

## What each section decides

| Section | How we use it |
| --- | --- |
| **Service & access** | Whether we wrap an MCP server or hand-write REST tools (like Bitrefill's four). |
| **The gap** | Confirms there is real missing capability — the reason the integration exists. |
| **Actions** | Each action becomes one namespaced passthrough tool (`<service>__<action>`). |
| **Money movement** | How the spend cap and permission gate apply. |
| **Fulfillment & claim** | Whether the cloud-device redemption step is needed. |
| **Acceptance** | The end-to-end test we ship against. |

---

## Template — copy and fill every section

```md
# Merchant Integration Request: <Company / Service name>

## 1. Summary
<One or two lines: who you are and the single job an agent should automate.
 Example: "Acme Telecom — let an agent top up any Acme prepaid SIM by phone
 number, paid in USDC, with no human in the loop.">

## 2. Service & access
- Service name:     <the external platform or merchant>
- Category:         <gift cards | mobile top-up | utilities | food | travel | other>
- Region(s):        <countries/markets this applies to, e.g. IN, US, EU>
- API / docs URL:   <link to the upstream API docs, or "none — app/web only">
- Integration type: <MCP server | REST API | app-only (cloud-device automation)>
- Auth model:       <API key | OAuth2 (DCR/CIMD) | session token | per-user login>
- Who holds creds:  <merchant-issued key we store, or each end-user logs in>
- Rate limits:      <calls/min, quotas, or "unknown">

## 3. The gap (why this needs building)
<What can an agent NOT do today through any existing tool? Name the missing
 capability precisely. If part of the flow has NO programmatic path — like
 Swiggy Money gift cards that are delivered but can only be redeemed inside the
 app — call that out: it's exactly what Errand's cloud-device claim step solves.>

## 4. Actions an agent needs (each becomes one passthrough tool)
<List every discrete operation. Each maps to a namespaced tool
 `<service>__<action>`. Give inputs → result for each.>

- `<service>__search`       — inputs: { query, region? }          → result: products + prices
- `<service>__create_order` — inputs: { productId, quantity, ... } → result: order id + amount due
- `<service>__get_status`   — inputs: { orderId }                  → result: fulfillment/redemption status
- `<service>__<action>`     — inputs: { ... }                      → result: ...

## 5. Money movement
- Does this move money?      <yes / no>
- Rail:                      <USDC on Base via Bitrefill invoice | x402 web-service pay |
                              direct ERC-20 transfer | fiat via merchant API>
- Currency & settlement:     <e.g. priced in INR, paid in USDC on Base>
- What the spend cap gates:  <which action triggers the pre-purchase cap check, and on
                              what amount — the cap is enforced BEFORE any invoice exists>
- Idempotency:               <how a retry is made safe; money-moving calls never auto-retry>

## 6. Fulfillment & claim
<How does the purchased thing reach the end user? Instant API delivery? A code
 that must be redeemed in an app (needs the cloud Android device)? A physical
 shipment? Describe the end-to-end "done" state.>

## 7. Acceptance test (our end-to-end definition of done)
<The single concrete result that proves it works. This becomes the e2e test we
 ship against. Example: "buy a ₹100 Acme top-up for +91XXXXXXXXXX; the number's
 balance reflects ₹100 within 5 minutes; the invoice settles in USDC on Base.">

## 8. Constraints & notes
<KYC/compliance, regional restrictions, min/max denominations, sandbox
 availability, anything that changes how we build or test.>

## 9. Contact
- Company:   <legal name>
- Contact:   <name + email>
- Volume:    <rough expected monthly transaction volume, for capacity planning>
```

---

## A filled example — Swiggy Money (the reference integration)

```md
# Merchant Integration Request: Swiggy Money (India)

## 1. Summary
Swiggy — let an agent top up a user's Swiggy Money wallet end to end so it can
pay for Instamart orders, with no human at checkout.

## 2. Service & access
- Service name:     Swiggy Money gift cards (via Bitrefill) + Swiggy Instamart
- Category:         gift cards + food/grocery
- Region(s):        IN
- API / docs URL:   Bitrefill v2 API (cards); Swiggy MCP (Instamart)
- Integration type: REST API (Bitrefill) + MCP server (Swiggy) + app-only claim
- Auth model:       Bitrefill API key; Swiggy OAuth (DCR)
- Who holds creds:  per-user: each account connects its own Swiggy login
- Rate limits:      standard Bitrefill limits

## 3. The gap
Bitrefill DELIVERS a Swiggy Money gift card but there is no API or website path
to redeem it into the wallet — redemption only exists inside the Swiggy Android
app. So an agent can buy the card but cannot finish the job.

## 4. Actions an agent needs
- bitrefill__searchProducts  — { query, country } → products + denominations
- bitrefill__createInvoice   — { items, paymentMethod: "usdc_base" } → invoice + deposit address
- bitrefill__getInvoice      — { id } → payment + delivery status
- (claim)                    — redeem the delivered voucher inside the Swiggy app

## 5. Money movement
- Moves money: yes
- Rail: USDC on Base, via a Bitrefill crypto invoice; paid by a jaw_send_calls transfer
- Currency: card priced in INR, paid in USDC on Base
- Cap gates: the invoice amount, checked BEFORE createInvoice
- Idempotency: invoice id; the transfer is never auto-retried

## 6. Fulfillment & claim
Voucher is delivered by Bitrefill, then redeemed automatically on an allocated
cloud Android device running the Swiggy app — turning the code into wallet balance.

## 7. Acceptance test
Buy a ₹100 Swiggy Money card; pay the invoice in USDC on Base; the voucher is
redeemed on the cloud device and Swiggy Money balance increases by ₹100.

## 8. Constraints & notes
Swiggy cards can take time to deliver; redemption confirmation is best-effort
(screenshot evidence). Denominations: 50/100/250/500/1000/2000/5000/10000 INR.

## 9. Contact
- Company: Errand (reference integration)
- Contact: team@errand.example
- Volume: demo
```
