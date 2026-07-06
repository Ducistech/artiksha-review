// GDPR: customers/data_request — a shopper asked what data we hold on them.
// We only store what a customer typed into a review (name/email/text). Log the
// request; the merchant fulfils it. Any customer-supplied email is matched here.

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  const email = (payload as { customer?: { email?: string } })?.customer?.email;

  const matches = email
    ? await db.review.findMany({
        where: { shop, authorEmail: email },
        select: { id: true, rating: true, title: true, body: true, createdAt: true },
      })
    : [];

  console.log(`[${topic}] ${shop}: found ${matches.length} review(s) for data request`);
  // Production: deliver `matches` to the merchant / requester per your privacy policy.
  return new Response(JSON.stringify({ reviews: matches }), {
    headers: { "Content-Type": "application/json" },
  });
};
