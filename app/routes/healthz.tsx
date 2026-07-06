// Plain health check for Render (no Shopify auth, no DB) — returns 200 as soon as
// the server is up, so the platform marks the deploy healthy.
export const loader = async () => new Response("ok", { status: 200 });
