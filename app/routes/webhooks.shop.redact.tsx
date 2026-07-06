// GDPR: shop/redact — 48h after uninstall, erase all of the shop's data.

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await db.$transaction([
    db.review.deleteMany({ where: { shop } }),
    db.googleConnection.deleteMany({ where: { shop } }),
    db.shopSetting.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  console.log(`[${topic}] ${shop}: all shop data erased`);
  return new Response();
};
