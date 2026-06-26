# Lastlink

Brazilian sales platform. Webhook adapter at
`functions/webhook/lastlink/[slug].js`.

Reference doc: <https://support.lastlink.com/pt-BR/articles/12587805-documentacao-de-webhook-da-lastlink>

## What this adapter does

Listens at `/webhook/lastlink/<LASTLINK_WEBHOOK_SLUG>` and processes
`Purchase_Order_Confirmed` events. All other events (refunds, chargebacks,
abandoned carts, subscription lifecycle) are acknowledged with a 200 +
`skipped` reason so Lastlink stops retrying — they're not processed in v1.

## Required env vars

| Name | Where it comes from | Format |
|---|---|---|
| `LASTLINK_WEBHOOK_SLUG` | Generated locally by `add-sales-platform` skill | UUID v4 lowercase |
| `LASTLINK_WEBHOOK_TOKEN` | Lastlink dashboard → Product → Integrações → Webhook → Token | 32-char hex |
| `LASTLINK_TOKEN_HEADER` (optional) | Locks the adapter to a specific header name once known | e.g. `authorization` or `x-lastlink-token` |

## Configuring the webhook on Lastlink

1. Lastlink dashboard → **Produtos** → select your product → **Integrações**
2. Find **Lastlink - Webhook** → click **Ativar**
3. Copy the **Token** shown on screen — paste as `LASTLINK_WEBHOOK_TOKEN` in
   Cloudflare Pages → Settings → Environment variables (Production, Encrypt)
4. **Nome do webhook**: anything (e.g. `Tracking Stack — Production`)
5. **URL**: `https://<your-domain>/webhook/lastlink/<LASTLINK_WEBHOOK_SLUG>`
6. **Eventos**: select at least `Purchase_Order_Confirmed`. Optional:
   `Payment_Refund`, `Payment_Chargeback` (currently skipped, but Lastlink
   stops retrying once we 200 them).
7. **Testar** → confirm Cloudflare Pages logs show the test request reaching
   the adapter (token check may fail on first test — see "Token header
   discovery" below).
8. **Salvar**.

## Tracker code (`trk`) plumbing

Lastlink supports UTM params on the checkout URL and echoes them back in
`Data.Utm.*`. We use **`UtmContent`** as the `trk` channel:

- Sales page builds checkout URL: `https://lastlink.com/p/<offer>/?utm_source=<src>&utm_medium=<med>&utm_content=<TRK_UUID>`
- Lastlink stores the UTMs against the buyer
- On purchase, webhook payload includes `Data.Utm.UtmContent === <TRK_UUID>`
- Adapter passes `parsed.trk = utm.UtmContent` to `_core.js` for lookup in
  `checkout_sessions`

If you have a Hotmart-style `xcod` need (multiple custom slots), the other
UTM fields (`UtmSource`, `UtmMedium`, `UtmCampaign`, `UtmTerm`) are also
captured into `parsed.platformUtm` and persisted to `purchase_log`, but
only `UtmContent` is the canonical `trk` channel.

## Payload shape (what we read)

```jsonc
{
  "Id": "<event-uuid>",
  "IsTest": false,
  "Event": "Purchase_Order_Confirmed",
  "CreatedAt": "2026-04-25T20:00:00Z",
  "Data": {
    "Buyer": { "Email": "…", "Name": "…", "PhoneNumber": "…" },
    "Purchase": {
      "PaymentId": "<transaction-uuid>",       // → transaction_id (UNIQUE)
      "Price": { "Value": 37.00, "Currency": "BRL" },
      "Payment": { "PaymentMethod": "credit_card|pix|bankslip" }
    },
    "Products": [{ "Id": "<product-uuid>", "Name": "…", "Price": 37.00 }],
    "Utm": {
      "UtmSource": "…",
      "UtmMedium": "…",
      "UtmCampaign": "…",
      "UtmContent": "<TRK_UUID>",              // ← our trk
      "UtmTerm": "…"
    }
  }
}
```

Other fields (`Seller`, `Commissions`, `Subscriptions`, `Offer`,
`DeviceInfo`, `BankSlip`) are present in the payload but ignored by v1 of
the adapter. Add them only when a downstream integration needs them.

## Token header discovery

Lastlink's public docs do not specify which HTTP header carries the token.
The adapter accepts the most common conventions out of the box:
`authorization` (with optional `Bearer ` prefix), `x-lastlink-token`,
`x-webhook-token`, `x-token`.

If a real Lastlink request uses a different header, the adapter logs all
auth-like headers it saw (with values redacted) to Cloudflare Pages logs
under "Lastlink token mismatch". After identifying the actual header, lock
the adapter to it by setting `LASTLINK_TOKEN_HEADER=<header-name>` in the
Pages environment variables — the adapter will then check ONLY that header.

## Money

`Data.Purchase.Price.Value` is documented as a `number`. Lastlink uses
**reais (decimal)**, not cents — `37.00` = R$ 37.00. This is opposite of
Kiwify (`charge_amount` is integer cents). If a future payload arrives with
values that look like cents (e.g. R$ 37 product with `Value: 3700`), flag
in monitoring and update the adapter.

## Refunds

`Payment_Refund` is currently skipped. To process refunds end-to-end
(reverse Meta CAPI / GA4 conversions), extend the adapter to handle the
event by:
1. Reading `Data.Purchase.PaymentId` from the refund event
2. Looking up the original `purchase_log` row by `transaction_id`
3. Marking it as refunded and dispatching CAPI/GA4 reversal events

This belongs to a future `harden-tracking` extension; v1 deliberately
keeps the adapter minimal.

## Idempotency

Lastlink retries aggressively on non-200 responses. The
`purchase_log.transaction_id` UNIQUE index dedupes retries — a duplicate
`Data.Purchase.PaymentId` causes `_core.js` to return early with
`{ ok: true, deduped: true }` and no fan-out to ad platforms.

The adapter also returns 200 + `skipped` for unrecognized events to avoid
wasted retries on events we don't care about.
