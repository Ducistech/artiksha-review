// Google OAuth callback. Verifies the signed state, exchanges the code for tokens,
// stores the connection, then bounces the merchant back into the embedded app.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { exchangeCodeAndStore } from "../google.server";
import { verifyState } from "../lib/oauthState.server";

function returnPage(shop: string, message: string, ok: boolean) {
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/google`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Google</title>
     <style>body{font-family:system-ui,sans-serif;max-width:520px;margin:16vh auto;text-align:center;padding:0 20px}
     a{display:inline-block;margin-top:20px;padding:10px 18px;background:#008060;color:#fff;border-radius:8px;text-decoration:none}
     .x{color:#b00}</style></head>
     <body><h2 class="${ok ? "" : "x"}">${message}</h2>
     <a href="${appUrl}" target="_top">Return to app</a></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop = verifyState(state);

  if (!shop) {
    return new Response("Invalid or expired authorization state.", { status: 400 });
  }
  if (err) {
    return returnPage(shop, `Google authorization was cancelled (${err}).`, false);
  }
  if (!code) {
    return returnPage(shop, "Missing authorization code from Google.", false);
  }

  try {
    await exchangeCodeAndStore(shop, code);
    return returnPage(shop, "Google connected ✓", true);
  } catch (e) {
    return returnPage(shop, `Could not connect Google: ${String(e).slice(0, 200)}`, false);
  }
};
