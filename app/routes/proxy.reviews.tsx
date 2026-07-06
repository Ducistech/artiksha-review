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
  attachReviewImages,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
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

  // Accept JSON, urlencoded, and multipart (with photo uploads).
  let payload: Record<string, unknown> = {};
  const imageFiles: File[] = [];
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (v instanceof File) {
        if (k === "images" && v.size > 0) imageFiles.push(v);
      } else {
        payload[k] = v;
      }
    }
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

  // Validate uploaded photos (type + size + count).
  const accepted = imageFiles.slice(0, MAX_IMAGES);
  for (const f of accepted) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.type)) errors.images = "Photos must be JPG, PNG, or WebP";
    else if (f.size > MAX_IMAGE_BYTES) errors.images = "Each photo must be under 5 MB";
  }
  if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

  if (honeypot) return json({ ok: true, moderated: true }); // pretend success for bots

  const settings = await getSettings(session.shop);
  const status = settings.autoPublish ? "published" : "pending";

  const review = await createCustomerReview({
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

  if (accepted.length) {
    const images = await Promise.all(
      accepted.map(async (f) => ({
        contentType: f.type,
        data: new Uint8Array(await f.arrayBuffer()),
      })),
    );
    await attachReviewImages(session.shop, review.id, images);
  }

  return json({
    ok: true,
    moderated: status === "pending",
    message:
      status === "pending"
        ? "Thanks! Your review was submitted and will appear after a quick review."
        : "Thanks! Your review is now live.",
  });
};
