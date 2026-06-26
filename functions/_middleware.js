export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Only intercept HTML page requests, skip static assets, API endpoints,
  // and the operator-facing dashboard (we don't want tracking cookies set
  // when an admin checks metrics).
  const isPageRequest = !url.pathname.match(
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json|webp|avif|mp4|webm|pdf|xml|txt|robots)$/i
  ) && !url.pathname.startsWith('/tracker')
    && !url.pathname.startsWith('/analytics')
    && !url.pathname.startsWith('/scripts/')
    && !url.pathname.startsWith('/webhook/')
    && !url.pathname.startsWith('/checkout-session')
    && !url.pathname.startsWith('/api/')
    && !url.pathname.startsWith('/dash');

  if (!isPageRequest) {
    return next();
  }

  // --- Extract tracking parameters from URL ---
  // CRITICAL: Use raw query string extraction, NOT url.searchParams.get().
  // searchParams.get() URL-decodes the value, but Meta expects the exact
  // raw fbclid as it appears in the URL.
  const fbclid = getRawParam(url.search, 'fbclid');
  const gclid = getRawParam(url.search, 'gclid');
  const msclkid = getRawParam(url.search, 'msclkid');

  // --- Extract UTM parameters ---
  // Primary: from the URL of the current request. Fallback: from the
  // Referer header. Needed because cross-subdomain init pings (e.g.
  // <img src="tk.example.com/init"> on quiz.example.com) hit /init
  // without UTMs, but the referrer carries them.
  const refererHeader = request.headers.get('referer') || '';
  let refererUrl = null;
  if (refererHeader) {
    try { refererUrl = new URL(refererHeader); } catch (e) { /* ignore */ }
  }
  const utmFrom = (k) => url.searchParams.get(k) || (refererUrl ? refererUrl.searchParams.get(k) : null) || '';
  const utmSource = utmFrom('utm_source');
  const utmMedium = utmFrom('utm_medium');
  const utmCampaign = utmFrom('utm_campaign');
  const utmContent = utmFrom('utm_content');
  const utmTerm = utmFrom('utm_term');

  // --- Read existing cookies ---
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let sessionId = cookies['_krob_sid'] || '';
  let externalId = cookies['_krob_eid'] || '';
  let existingFbc = cookies['_fbc'] || '';
  let existingFbp = cookies['_fbp'] || '';

  // --- Generate identifiers if missing ---
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = crypto.randomUUID();
  if (!externalId) externalId = crypto.randomUUID();

  // --- Compute sub_domain_index per Meta SDK spec ---
  // Index = number of labels in the ETLD+1 minus 1.
  //   example.com     → 2 → index 1
  //   example.com.br  → 3 → index 2  (country-code second-level domain)
  // Computed from the Host header so the same code works for every recipient
  // without configuration. Falls back to 1 if the host can't be parsed.
  const SUB_DOMAIN_INDEX = computeSubDomainIndex(request.headers.get('host') || '');

  // --- Build _fbc from fbclid ---
  let fbc = existingFbc;
  if (fbclid) {
    const existingPayload = existingFbc ? extractFbcPayload(existingFbc) : '';
    if (!existingFbc || existingPayload !== fbclid) {
      fbc = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${fbclid}`;
    }
  }

  // --- Generate _fbp if missing ---
  let fbp = existingFbp;
  if (!fbp) {
    fbp = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${Math.floor(Math.random() * 9000000000) + 1000000000}`;
  }

  // --- Capture request metadata ---
  const clientIp = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const referrer = request.headers.get('referer') || '';
  const now = Math.floor(Date.now() / 1000);

  // --- Serve the page FIRST, then write to D1 in background ---
  const response = await next();

  // --- Set HTTP cookies ---
  // Domain=.<eTLD+1> so cookies travel across subdomains (e.g. tk.example.com
  // setting cookies that the lead page on quiz.example.com can read).
  // SameSite=None required because cross-site requests (the iframe-init or
  // fetch from another subdomain) must carry the cookie.
  const maxAge = 34560000; // 400 days
  const parentDomain = computeParentDomain(request.headers.get('host') || '');
  const domainAttr = parentDomain ? `Domain=${parentDomain}; ` : '';
  const cookieBase = `${domainAttr}Path=/; Max-Age=${maxAge}; SameSite=None; Secure`;

  const newHeaders = new Headers(response.headers);
  newHeaders.append('Set-Cookie', `_krob_sid=${sessionId}; ${cookieBase}`);
  newHeaders.append('Set-Cookie', `_krob_eid=${externalId}; ${cookieBase}`);
  newHeaders.append('Set-Cookie', `_fbp=${fbp}; ${cookieBase}`);

  if (fbc) {
    newHeaders.append('Set-Cookie', `_fbc=${fbc}; ${cookieBase}`);
  }

  // CORS for cross-subdomain XHR/fetch (e.g. quiz.example.com → tk.example.com).
  // Echo back the Origin if it's on the same eTLD+1, otherwise omit (fail safe).
  const origin = request.headers.get('origin') || '';
  if (origin && parentDomain && origin.endsWith(parentDomain.replace(/^\./, ''))) {
    newHeaders.set('Access-Control-Allow-Origin', origin);
    newHeaders.set('Access-Control-Allow-Credentials', 'true');
    newHeaders.set('Vary', 'Origin');
  }

  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });

  // --- D1 UPSERT (background, non-blocking) ---
  context.waitUntil(
    (async () => {
      try {
        if (env.DB) {
          await env.DB.prepare(`
            INSERT INTO sessions (session_id, external_id, fbclid, gclid, msclkid, fbc, fbp, ip_address, user_agent, referrer, landing_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              fbclid = CASE WHEN excluded.fbclid != '' THEN excluded.fbclid ELSE sessions.fbclid END,
              gclid = CASE WHEN excluded.gclid != '' THEN excluded.gclid ELSE sessions.gclid END,
              msclkid = CASE WHEN excluded.msclkid != '' THEN excluded.msclkid ELSE sessions.msclkid END,
              fbc = CASE WHEN excluded.fbc != '' THEN excluded.fbc ELSE sessions.fbc END,
              utm_source = CASE WHEN excluded.utm_source != '' THEN excluded.utm_source ELSE sessions.utm_source END,
              utm_medium = CASE WHEN excluded.utm_medium != '' THEN excluded.utm_medium ELSE sessions.utm_medium END,
              utm_campaign = CASE WHEN excluded.utm_campaign != '' THEN excluded.utm_campaign ELSE sessions.utm_campaign END,
              utm_content = CASE WHEN excluded.utm_content != '' THEN excluded.utm_content ELSE sessions.utm_content END,
              utm_term = CASE WHEN excluded.utm_term != '' THEN excluded.utm_term ELSE sessions.utm_term END,
              updated_at = excluded.updated_at
          `).bind(sessionId, externalId, fbclid, gclid, msclkid, fbc, fbp, clientIp, userAgent, referrer, url.toString(), utmSource, utmMedium, utmCampaign, utmContent, utmTerm, now, now).run();
        }
      } catch (e) {
        console.error('Middleware D1 error:', e.message);
      }
    })()
  );

  return newResponse;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=');
  });
  return cookies;
}

function getRawParam(search, name) {
  const match = (search || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
  return match ? match[1] : '';
}

function extractFbcPayload(fbc) {
  if (!fbc) return '';
  const parts = fbc.split('.');
  return parts.length >= 4 ? parts[3] : '';
}

// Country-code second-level domains where the ETLD+1 has three labels.
// A full public-suffix list is too heavy for an edge worker; this covers
// the common cases. Anything not listed defaults to the 2-label assumption
// (example.com → index 1), which is correct for .com / .net / .org / etc.
const CC_TLDS = new Set([
  'com.br', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.ve', 'com.ec',
  'com.au', 'com.pt', 'com.pl', 'com.tr', 'com.ua', 'com.ru',
  'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'com.ph', 'com.vn',
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.id',
]);

function computeSubDomainIndex(host) {
  if (!host) return 1;
  const hostname = host.split(':')[0].toLowerCase();
  const parts = hostname.split('.');
  if (parts.length < 2) return 0;
  const lastTwo = parts.slice(-2).join('.');
  // Known country-code 2-label TLD → ETLD+1 has 3 labels → index 2
  if (CC_TLDS.has(lastTwo)) return 2;
  // Standard case: example.com → ETLD+1 has 2 labels → index 1
  return 1;
}

// Returns the leading-dot parent (eTLD+1) of the host, e.g. "example.com" →
// ".example.com" so cookies set on tk.example.com are also readable on
// quiz.example.com. Returns "" for IP addresses or single-label
// hosts (cookies stay scoped to the host in that case).
function computeParentDomain(host) {
  if (!host) return '';
  const hostname = host.split(':')[0].toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || !hostname.includes('.')) return '';
  const parts = hostname.split('.');
  if (parts.length < 2) return '';
  const lastTwo = parts.slice(-2).join('.');
  const labels = CC_TLDS.has(lastTwo) ? 3 : 2;
  if (parts.length < labels) return '';
  return '.' + parts.slice(-labels).join('.');
}
