// App Proxy endpoint — reached from the storefront at:
//   /apps/artiksha-reviews/reviews   (see [app_proxy] in shopify.app.toml)
//
// GET  ?productId=123           -> published reviews + summary for a product (JSON)
// POST { productId, name, ... } -> submit a customer review (moderated by default)
//
// authenticate.public.appProxy verifies Shopify's signed proxy request, so we can
// trust `session.shop`. Requests are same-origin to the storefront -> no CORS needed.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  createCustomerReview,
  getPublishedReviews,
  getSettings,
} from "../models/review.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "no_session" }, 401);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const settings = await getSettings(session.shop);
  const { reviews, summary } = await getPublishedReviews(session.shop, productId, {
    includeGoogle: settings.showGoogleReviews,
  });
  return json({ summary, reviews });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "no_session" }, 401);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Accept both JSON and urlencoded form posts.
  let payload: Record<string, unknown> = {};
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const form = await request.formData();
    payload = Object.fromEntries(form.entries());
  }

  const productId = String(payload.productId || "").trim();
  const authorName = String(payload.name || "").trim();
  const body = String(payload.body || "").trim();
  const rating = Number(payload.rating);
  const title = payload.title ? String(payload.title).trim() : null;
  const email = payload.email ? String(payload.email).trim() : null;
  const productHandle = payload.productHandle ? String(payload.productHandle).trim() : null;
  // Honeypot: bots fill hidden fields. Silently accept-and-drop to not tip them off.
  const honeypot = String(payload.website || "").trim();

  const errors: Record<string, string> = {};
  if (!productId) errors.productId = "Missing product";
  if (authorName.length < 2) errors.name = "Please enter your name";
  if (body.length < 5) errors.body = "Please write a short review";
  if (!(rating >= 1 && rating <= 5)) errors.rating = "Please pick a star rating";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Invalid email";
  if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

  if (honeypot) return json({ ok: true, moderated: true }); // pretend success for bots

  const settings = await getSettings(session.shop);
  const status = settings.autoPublish ? "published" : "pending";

  await createCustomerReview({
    shop: session.shop,
    productId,
    productHandle,
    authorName,
    authorEmail: email,
    rating,
    title,
    body,
    status,
  });

  return json({
    ok: true,
    moderated: status === "pending",
    message:
      status === "pending"
        ? "Thanks! Your review was submitted and will appear after a quick review."
        : "Thanks! Your review is now live.",
  });
};
