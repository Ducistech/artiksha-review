# Artiksha Reviews — Setup & Deploy

A custom Shopify app that (1) imports your **Google Business Profile** reviews, (2) lets
customers **submit reviews** on product pages, and (3) gives you an **admin dashboard** to
approve reviews and **delete fakes**.

## What's in the box
- `app/routes/app._index.tsx` — dashboard (counts + links).
- `app/routes/app.reviews.tsx` — moderation: publish / hide / spam / **delete** / reply.
- `app/routes/app.google.tsx` + `auth.google*.tsx` — connect Google, pick a location, sync.
- `app/routes/proxy.reviews.tsx` — storefront App Proxy (list + submit).
- `app/google.server.ts` — Google Business Profile OAuth + review import.
- `app/models/review.server.ts` — review data access (strips PII for storefront).
- `extensions/reviews-widget/` — theme app block for the product page (list + submit form).
- `prisma/schema.prisma` — `Review`, `GoogleConnection`, `ShopSetting` models.
- GDPR webhooks: `webhooks.customers.data_request/redact`, `webhooks.shop.redact`.

## Prerequisites
- Node 20.19+ or 22.12+ (you have v22.13).
- A **Shopify Partner** account + a development store (or the live store for a custom app).
- **Shopify CLI**: `npm i -g @shopify/cli@latest` (not required to build, but needed for `dev`/`deploy`).
- A **Google Cloud** project (for the Google import).

## 1. Install
```bash
cd C:/Claude/artiksha-reviews-app
npm install
cp .env.example .env      # then fill in values (see below)
npm run setup             # prisma generate + migrate (creates dev.sqlite)
```

## 2. Register the app with Shopify
```bash
npm run config:link       # creates/links the app in your Partner account, fills client_id + application_url
```
This rewrites `shopify.app.toml` with your real `client_id` and `application_url`. Re-check that the
`[app_proxy]` block still reads:
```
url = "<application_url>/proxy"
subpath = "artiksha-reviews"
prefix = "apps"
```
Then `npm run deploy` to push config + the theme extension.

## 3. Google Business Profile API
The public Places API only returns **5** reviews and forbids storing them, so we use the
owner-authorized **Business Profile API** to import them all.

1. In **Google Cloud Console** → *APIs & Services* → **Enable APIs**, enable:
   - *My Business Account Management API*
   - *My Business Business Information API*
   - *Google My Business API* (the v4 API that hosts the reviews endpoint)
   > These APIs are access-gated: submit the **GBP API access request form** and wait for approval
   > (often a few days). Until approved, calls return 403 and the sync will show an error — expected.
2. *APIs & Services* → *Credentials* → **Create OAuth client ID** → type **Web application**.
   - Authorized redirect URI = `<application_url>/auth/google/callback`
   - Put the client id/secret + that redirect URI into `.env` (`GOOGLE_*`).
3. OAuth consent screen: add the `.../auth/business.manage` scope and your Google account as a
   test user (or publish the consent screen).

## 4. Run in dev
```bash
npm run dev               # Shopify CLI: tunnels, installs on your dev store, hot-reloads
```

### Optional: sample data to see the widget immediately
```bash
# Seeds 5 published + 1 pending review. Use the domain the app is installed on:
SEED_SHOP=your-store.myshopify.com npm run seed
```
The 3 Google reviews are store-wide (show on every product page); the customer reviews target two
real Artiksha product ids (Station Clock + Trio), and one PENDING review demonstrates the moderation
queue. Re-running is idempotent. Defaults to `tmkm5k-gk.myshopify.com` if `SEED_SHOP` is unset.
- Open the app in the store admin. Go to **Google reviews** → **Connect Google** → pick your
  business location → it imports and publishes your Google reviews.
- Go to **Online Store → Themes → Customize → a product template → Add block → Apps →
  Artiksha Reviews** to place the storefront widget. Submit a test review; approve it under **Reviews**.

## 5. Deploy to production
This app needs a public HTTPS host + a persistent DB.
- **DB:** SQLite is fine for a single small instance; for anything real switch `prisma` `datasource`
  to Postgres (e.g. Fly.io/Railway/Render/Neon) and set the connection string.
- **Host:** the included `Dockerfile` runs `npm run docker-start` (migrate + serve). Deploy to
  Fly.io / Render / Railway. Set all env vars there. Set `application_url` (and the Google redirect)
  to the production URL, then `npm run deploy`.
- For **App Store distribution** you'll also complete Shopify's app review (the GDPR webhooks here
  are already wired). For a **single-store custom app**, distribution can be set to custom and you skip review.

## Notes & choices
- **Customer reviews are moderated by default** (`ShopSetting.autoPublish = false`) — they sit in
  *Pending* until you approve, so nothing shows publicly without your say-so.
- **Delete vs Hide:** *Delete* is permanent (for fakes/spam). *Hide* keeps the row but pulls it from
  the storefront. A Google re-sync will **not** resurrect a review you deleted/hid.
- **PII:** reviewer email is stored for your reference + order-matching but is **never** sent to the
  storefront (`models/review.server.ts` `toPublic` omits it).
- **Spam control:** a honeypot field + server-side validation; add rate-limiting / captcha before
  going high-traffic.
- **"Verified buyer":** scaffolded (`verified` flag) but order-matching isn't implemented — add
  `read_orders` scope and match `authorEmail` to a paid order in `proxy.reviews.tsx` to enable it.
