import db from "../db.server";

export type ReviewStatus = "pending" | "published" | "spam" | "hidden";
export type ReviewSource = "customer" | "google";

/** Shape returned to the storefront — strips PII (email) and internal fields. */
export interface PublicReview {
  id: string;
  source: ReviewSource;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  reply: string | null;
  verified: boolean;
  photoUrls: string[];
  date: string | null;
}

function toPublic(r: {
  id: string;
  source: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  reply: string | null;
  verified: boolean;
  photoUrls: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): PublicReview {
  return {
    id: r.id,
    source: r.source as ReviewSource,
    authorName: r.authorName,
    rating: r.rating,
    title: r.title,
    body: r.body,
    reply: r.reply,
    verified: r.verified,
    photoUrls: r.photoUrls ? safeParseArray(r.photoUrls) : [],
    date: (r.reviewedAt ?? r.createdAt)?.toISOString() ?? null,
  };
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Published reviews for a product (customer) plus store-wide Google reviews if enabled. */
export async function getPublishedReviews(
  shop: string,
  productId: string | null,
  opts: { includeGoogle?: boolean } = {},
): Promise<{ reviews: PublicReview[]; summary: { count: number; average: number } }> {
  const where: Record<string, unknown> = { shop, status: "published" };

  if (productId) {
    // product-specific customer reviews OR store-wide Google reviews
    where.OR = [
      { productId, source: "customer" },
      ...(opts.includeGoogle === false ? [] : [{ source: "google" }]),
    ];
  } else if (opts.includeGoogle === false) {
    where.source = "customer";
  }

  const rows = await db.review.findMany({
    where: where as never,
    orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const reviews = rows.map(toPublic);
  const count = reviews.length;
  const average =
    count === 0 ? 0 : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10;
  return { reviews, summary: { count, average } };
}

/** Create a customer-submitted review (moderated: status defaults to pending unless autoPublish). */
export async function createCustomerReview(input: {
  shop: string;
  productId: string;
  productHandle?: string | null;
  authorName: string;
  authorEmail?: string | null;
  rating: number;
  title?: string | null;
  body: string;
  verified?: boolean;
  status: ReviewStatus;
}) {
  return db.review.create({
    data: {
      shop: input.shop,
      source: "customer",
      status: input.status,
      productId: input.productId,
      productHandle: input.productHandle ?? null,
      authorName: input.authorName.slice(0, 120),
      authorEmail: input.authorEmail ?? null,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      title: input.title?.slice(0, 160) ?? null,
      body: input.body.slice(0, 5000),
      verified: input.verified ?? false,
      reviewedAt: new Date(),
    },
  });
}

/** Admin list with filters + counts by status. */
export async function listReviewsForAdmin(
  shop: string,
  filter: { status?: ReviewStatus | "all"; source?: ReviewSource | "all"; q?: string } = {},
) {
  const where: Record<string, unknown> = { shop };
  if (filter.status && filter.status !== "all") where.status = filter.status;
  if (filter.source && filter.source !== "all") where.source = filter.source;
  if (filter.q) {
    where.OR = [
      { authorName: { contains: filter.q } },
      { body: { contains: filter.q } },
      { title: { contains: filter.q } },
    ];
  }

  const [rows, counts] = await Promise.all([
    db.review.findMany({ where: where as never, orderBy: { createdAt: "desc" }, take: 500 }),
    db.review.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count._all;
  return { rows, byStatus };
}

export async function setReviewStatus(shop: string, id: string, status: ReviewStatus) {
  // scope by shop so one store can never moderate another's rows
  return db.review.updateMany({ where: { id, shop }, data: { status } });
}

export async function deleteReview(shop: string, id: string) {
  return db.review.deleteMany({ where: { id, shop } });
}

export async function replyToReview(shop: string, id: string, reply: string) {
  return db.review.updateMany({ where: { id, shop }, data: { reply: reply.slice(0, 2000) } });
}

export async function getSettings(shop: string) {
  return db.shopSetting.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

// --- Review image uploads (stored in-DB, served by the app's /image/:id route) ---
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB each
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Persist uploaded photos for a review and set its photoUrls to app-served absolute URLs. */
export async function attachReviewImages(
  shop: string,
  reviewId: string,
  images: { contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<string[]> {
  if (!images.length) return [];
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const urls: string[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const row = await db.reviewImage.create({
      data: { shop, reviewId, contentType: img.contentType, data: img.data },
    });
    urls.push(`${base}/image/${row.id}`);
  }
  await db.review.update({ where: { id: reviewId }, data: { photoUrls: JSON.stringify(urls) } });
  return urls;
}

/** Fetch one image's bytes for the public /image/:id route. */
export async function getReviewImage(id: string) {
  return db.reviewImage.findUnique({
    where: { id },
    select: { contentType: true, data: true },
  });
}
