// -----------------------------------------------------------------------------
// Lastlink webhook adapter.
//
// URL shape: /webhook/lastlink/<LASTLINK_WEBHOOK_SLUG>
// The per-recipient UUID stored in env.LASTLINK_WEBHOOK_SLUG gates the endpoint.
// The platform-issued token in env.LASTLINK_WEBHOOK_TOKEN is checked against
// the request headers as a second layer.
//
// Platform specifics (per Lastlink docs, support.lastlink.com article 12587805):
//   - Method: HTTP POST, Content-Type: application/json.
//   - Token: shown in the platform UI under each webhook, but the doc does
//     not specify the header name. We accept any of the common conventions
//     (Authorization, X-Lastlink-Token, X-Webhook-Token) and, when none
//     match, log all incoming headers so the operator can identify it from
//     a "Testar" request. Set LASTLINK_TOKEN_HEADER (optional) to lock down
//     to a specific header once known.
//   - Paid event: `Event === 'Purchase_Order_Confirmed'`. Lastlink also fires
//     `Purchase_Request_Confirmed` (intent), `Payment_Refund`,
//     `Payment_Chargeback`, etc — we only process `Purchase_Order_Confirmed`
//     in v1; the others are skipped with a 200 (so Lastlink stops retrying)
//     and a `skipped` reason in the body for the operator to inspect.
//   - Idempotency: `Data.Purchase.PaymentId` is the unique transaction UUID;
//     the `purchase_log.transaction_id` UNIQUE index dedupes retries.
//   - Tracker plumbing: Lastlink supports UTM params on the checkout URL and
//     echoes them back in `Data.Utm.*`. We use `UtmContent` as the `trk`
//     channel (sales pages must append `?utm_content=<trk>` to the
//     lastlink.com checkout URL). `Data.Utm` also feeds platformUtm.
//   - Money: `Data.Purchase.Price.Value` is documented as `number`. Lastlink
//     historically uses reais (e.g. 37.00 = R$ 37.00), NOT cents. Treat as
//     reais; if a future payload arrives with values that look like cents
//     (>10x expected price), flag in monitoring.
// -----------------------------------------------------------------------------

import { processPurchase } from '../_core.js';
import { guardSlug, timingSafeEqual } from '../_utils.js';

const PROCESSED_EVENTS = new Set(['Purchase_Order_Confirmed']);

function checkLastlinkToken(request, env) {
  const expected = env.LASTLINK_WEBHOOK_TOKEN;
  if (!expected) return { ok: false, reason: 'LASTLINK_WEBHOOK_TOKEN not set' };

  const lockedHeader = env.LASTLINK_TOKEN_HEADER;
  const candidates = lockedHeader
    ? [lockedHeader]
    : ['authorization', 'x-lastlink-token', 'x-webhook-token', 'x-token'];

  for (const headerName of candidates) {
    const raw = request.headers.get(headerName);
    if (!raw) continue;
    const stripped = raw.replace(/^Bearer\s+/i, '').trim();
    if (timingSafeEqual(stripped, expected) || timingSafeEqual(raw.trim(), expected)) {
      return { ok: true, header: headerName };
    }
  }
  return { ok: false, reason: 'no matching token in expected headers' };
}

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const slugFailure = guardSlug(params.slug, env.LASTLINK_WEBHOOK_SLUG);
  if (slugFailure) return slugFailure;

  const auth = checkLastlinkToken(request, env);
  if (!auth.ok) {
    const debugHeaders = {};
    for (const [k, v] of request.headers.entries()) {
      if (/(token|auth|signature|secret)/i.test(k)) {
        debugHeaders[k] = v.length > 10 ? `${v.slice(0, 6)}…${v.slice(-2)}` : '<short>';
      }
    }
    console.error('Lastlink token mismatch:', auth.reason, 'auth-like headers seen:', debugHeaders);
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const rawPayload = await request.json();
    const eventName = rawPayload.Event || '';
    const data = rawPayload.Data || {};

    if (!PROCESSED_EVENTS.has(eventName)) {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'event not processed by adapter', event: eventName }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const buyer = data.Buyer || {};
    const purchase = data.Purchase || {};
    const products = Array.isArray(data.Products) ? data.Products : [];
    const utm = data.Utm || {};

    const priceObj = purchase.Price || {};
    const valueInReais = Number.isFinite(priceObj.Value) ? priceObj.Value : 0;
    const currency = priceObj.Currency || 'BRL';

    const firstProduct = products[0] || {};
    const productIdStr = String(firstProduct.Id || '');

    const items = products.map((p) => ({
      productId: String(p.Id || ''),
      name: p.Name || '',
      price: {
        value: Number.isFinite(p.Price) ? p.Price : 0,
        currency,
      },
    }));

    const parsed = {
      platform: 'lastlink',
      trk: utm.UtmContent || '',
      email: buyer.Email || '',
      name: buyer.Name || '',
      phone: buyer.PhoneNumber || '',
      value: valueInReais,
      currency,
      transactionId: purchase.PaymentId || '',
      productId: productIdStr,
      productName: firstProduct.Name || '',
      items,
      platformUtm: {
        utm_source: utm.UtmSource || '',
        utm_medium: utm.UtmMedium || '',
        utm_campaign: utm.UtmCampaign || '',
        utm_content: utm.UtmContent || '',
        utm_term: utm.UtmTerm || '',
      },
    };

    const result = await processPurchase({ parsed, env, context });

    return new Response(
      JSON.stringify({ ok: true, event_id: result.eventId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Lastlink webhook error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
