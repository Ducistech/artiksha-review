// Signed, short-lived state token for the Google OAuth round-trip.
// Minted only inside the authenticated embedded admin (where `shop` is trusted),
// so the callback can safely map the Google grant back to the right shop.

import crypto from "node:crypto";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET is required to sign OAuth state");
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signState(shop: string): string {
  const payload = b64url(JSON.stringify({ shop, ts: Date.now() }));
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): string | null {
  if (!state || !state.includes(".")) return null;
  const [payload, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const { shop, ts } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof shop !== "string" || typeof ts !== "number") return null;
    if (Date.now() - ts > TTL_MS) return null;
    return shop;
  } catch {
    return null;
  }
}
