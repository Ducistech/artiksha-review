// GDPR: customers/redact — erase a shopper's personal data.
// Null out the PII (name/email) on their reviews but keep the anonymised rating/text
// so aggregate scores stay intact.

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  const email = (payload as { customer?: { email?: string } })?.customer?.email;

  if (email) {
    await db.review.updateMany({
      where: { shop, authorEmail: email },
      data: { authorName: "Anonymous", authorEmail: null },
    });
  }
  console.log(`[${topic}] ${shop}: redacted reviews for the requested customer`);
  return new Response();
};
