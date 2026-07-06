// Seed sample reviews into the dev DB so the storefront widget + admin have content.
//
//   npm run seed                       -> uses SEED_SHOP or the Artiksha store domain
//   SEED_SHOP=my-store.myshopify.com npm run seed
//
// Idempotent: re-running upserts the same rows (keyed on shop+source+externalId).
// The Google reviews use productId=null so they show store-wide on EVERY product page;
// the customer reviews target two real Artiksha product ids (edit PRODUCTS below to taste).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SHOP = process.env.SEED_SHOP || "tmkm5k-gk.myshopify.com";

// Real Artiksha products (so customer reviews land on an actual PDP). Adjust if you like.
const PRODUCTS = {
  stationClock: { id: "7842069545034", handle: "deer-retro-station-double-sided-wall-clock-decor-for-vintage-charm" },
  trio: { id: "7991581278282", handle: "the-charging-trio-a-symbol-of-power-and-prosperity" },
};

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const SEEDS = [
  // --- Store-wide Google reviews (productId null -> visible on every product page) ---
  {
    externalId: "seed-g-1", source: "google", status: "published",
    authorName: "Priya Nair", rating: 5,
    body: "Ordered a wall clock for our new flat — the finish is genuinely premium and delivery was well packed. Got compliments from every guest!",
    reviewedAt: daysAgo(9), reply: "Thank you so much, Priya! So glad it found a good home. 🙏",
  },
  {
    externalId: "seed-g-2", source: "google", status: "published",
    authorName: "Rahul Mehta", rating: 5,
    body: "Beautiful craftsmanship and the COD option made it easy to trust the first order. Will buy again.",
    reviewedAt: daysAgo(21),
  },
  {
    externalId: "seed-g-3", source: "google", status: "published",
    authorName: "Ananya Verma", rating: 4,
    body: "Lovely piece, slightly smaller than I imagined but looks elegant on the wall. Good support over WhatsApp.",
    reviewedAt: daysAgo(34),
  },

  // --- Customer reviews on the Station Clock ---
  {
    externalId: "seed-c-1", source: "customer", status: "published",
    productId: PRODUCTS.stationClock.id, productHandle: PRODUCTS.stationClock.handle,
    authorName: "Vikram S.", authorEmail: "vikram@example.com", verified: true, rating: 5,
    title: "Stunning centrepiece", body: "The gold-black station clock is even better in person. Silent movement, feels solid.",
    reviewedAt: daysAgo(5),
  },
  {
    externalId: "seed-c-2", source: "customer", status: "published",
    productId: PRODUCTS.stationClock.id, productHandle: PRODUCTS.stationClock.handle,
    authorName: "Meera K.", authorEmail: "meera@example.com", rating: 4,
    title: "Great quality", body: "Arrived on time and packaging was excellent. Took one star only because I wanted a larger size.",
    reviewedAt: daysAgo(12),
  },
  // --- One PENDING customer review, to demonstrate the moderation queue ---
  {
    externalId: "seed-c-3", source: "customer", status: "pending",
    productId: PRODUCTS.trio.id, productHandle: PRODUCTS.trio.handle,
    authorName: "Test Buyer", authorEmail: "pending@example.com", rating: 5,
    title: "Awaiting your approval", body: "This one is PENDING — approve or delete it from the Reviews tab to see moderation in action.",
    reviewedAt: daysAgo(1),
  },
];

async function main() {
  for (const s of SEEDS) {
    await db.review.upsert({
      where: { shop_source_externalId: { shop: SHOP, source: s.source, externalId: s.externalId } },
      update: {
        status: s.status, authorName: s.authorName, rating: s.rating,
        title: s.title ?? null, body: s.body, reply: s.reply ?? null,
        productId: s.productId ?? null, productHandle: s.productHandle ?? null,
        verified: s.verified ?? false, reviewedAt: s.reviewedAt,
      },
      create: {
        shop: SHOP, externalId: s.externalId, source: s.source, status: s.status,
        productId: s.productId ?? null, productHandle: s.productHandle ?? null,
        authorName: s.authorName, authorEmail: s.authorEmail ?? null,
        rating: s.rating, title: s.title ?? null, body: s.body, reply: s.reply ?? null,
        verified: s.verified ?? false, reviewedAt: s.reviewedAt,
      },
    });
  }
  const counts = await db.review.groupBy({ by: ["status"], where: { shop: SHOP }, _count: { _all: true } });
  console.log(`Seeded reviews for ${SHOP}:`);
  for (const c of counts) console.log(`  ${c.status}: ${c._count._all}`);
  console.log("\nGoogle reviews (store-wide) show on every product page; customer reviews on:");
  console.log(`  ${PRODUCTS.stationClock.id} (published) and ${PRODUCTS.trio.id} (1 pending).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
