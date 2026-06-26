// Cross-subdomain cookie initializer.
//
// Pages sites on other subdomains include `<img src="https://tk.<root>/init">`
// in their HTML so the tracking middleware runs once per visit and sets
// `_krob_sid` / `_fbp` / `_krob_eid` / `_fbc` cookies on `Domain=.<root>` —
// making them readable from every subdomain.
//
// The middleware does the actual work (cookies, sessions row). This handler
// just returns a clean 204 No Content + a 1x1 transparent GIF so Lighthouse
// / browser dev tools don't log a 404. The middleware response wraps this
// and adds the Set-Cookie headers.

const ONE_PIXEL_GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

export async function onRequest() {
  return new Response(ONE_PIXEL_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}
