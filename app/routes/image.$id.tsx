// Serves a review photo by id. Public (no Shopify auth) so both the storefront widget
// and the embedded admin can render it via an absolute app URL. Ids are unguessable cuids;
// photos are non-sensitive user review images.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getReviewImage } from "../models/review.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) return new Response("Not found", { status: 404 });

  const img = await getReviewImage(id);
  if (!img) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(img.data), {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
