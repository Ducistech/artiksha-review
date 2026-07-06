# Artiksha Reviews

A custom Shopify app for Artiksha that:

1. **Imports Google reviews** — pulls all reviews from your Google Business Profile (owner-authorized
   via OAuth; the public Places API only exposes 5).
2. **Collects customer reviews** — a product-page widget (theme app block) where shoppers read and
   submit reviews.
3. **Moderation dashboard** — approve customer reviews and **permanently delete fakes/spam** from the
   embedded admin. Reviews are held for approval by default; nothing goes live without you.

## Stack
Shopify Remix app template · Prisma (SQLite dev / Postgres prod) · Polaris admin UI · App Proxy for
the storefront API · a theme app extension for the widget · Google Business Profile API for import.

## Quick start
```bash
npm install
cp .env.example .env      # fill in Shopify + Google credentials
npm run setup             # prisma generate + migrate
npm run config:link       # link to your Partner app (fills client_id/application_url)
npm run dev               # run locally on your dev store
```
Full instructions — including the Google Cloud API setup and production deploy — are in
**[SETUP.md](./SETUP.md)**.

## Layout
```
app/
  models/review.server.ts        review data access (PII-safe storefront shape)
  google.server.ts               Google Business Profile OAuth + import
  lib/oauthState.server.ts       signed OAuth state (shop binding)
  routes/
    app._index.tsx               dashboard
    app.reviews.tsx              moderation (publish/hide/spam/delete/reply)
    app.google.tsx               connect Google + sync
    auth.google.tsx / .callback  Google OAuth round-trip
    proxy.reviews.tsx            storefront App Proxy (GET list / POST submit)
    webhooks.customers.*         GDPR data_request / redact
    webhooks.shop.redact.tsx     GDPR shop erase
extensions/reviews-widget/       theme app block (product page widget)
prisma/schema.prisma             Review, GoogleConnection, ShopSetting
```

Status: **scaffold complete and building** (typecheck + production build pass). Needs the merchant
steps in SETUP.md (Partner app registration, Google Cloud OAuth, hosting) before it can serve live.
