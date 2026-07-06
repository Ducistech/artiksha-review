# Deploy Artiksha Reviews to Render

This gives the app **one fixed HTTPS URL**, which fixes everything the dev tunnel didn't:
the embedded admin, the storefront App Proxy (review submit), and the Google OAuth redirect.

Prereqs: a **GitHub** account and a **Render** account (both free). The repo is already
initialised locally with a first commit and a `render.yaml` blueprint + `Dockerfile`.

---

## 1. Push the code to GitHub
Create an **empty private repo** on GitHub (e.g. `artiksha-reviews-app`), then:
```bash
cd C:/Claude/artiksha-reviews-app
git remote add origin https://github.com/<you>/artiksha-reviews-app.git
git push -u origin master
```
(`.env` is gitignored, so your secrets are NOT pushed — you'll set them in Render instead.)

## 2. Create the services on Render (Blueprint)
1. Render dashboard → **New → Blueprint**.
2. Connect your GitHub and pick the repo. Render reads `render.yaml` and proposes:
   - a **Postgres** database `artiksha-reviews-db` (free)
   - a **web service** `artiksha-reviews` (Docker, free)
3. Click **Apply**. The DB provisions and the first build starts.
   > The web service will build fine but won't be fully functional until step 3's env vars are set.

## 3. Set environment variables (web service → Environment)
`DATABASE_URL` and `SCOPES` are set automatically by the blueprint. Add these:

| Key | Value |
|---|---|
| `SHOPIFY_API_KEY` | your app's **Client ID** (from Shopify Dev Dashboard → your app → API credentials) |
| `SHOPIFY_API_SECRET` | your app's **Client secret** (same page) |
| `GOOGLE_CLIENT_ID` | `1089593780604-a3re8136k8sibn3osn4be2mb7pfbre2i.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | (the `GOCSPX-…` value in your local `.env`) |

Leave `SHOPIFY_APP_URL` and `GOOGLE_REDIRECT_URI` for the next step (you need the URL first).

> ⚠️ Pick **one** Shopify app and use its Client ID + secret consistently. The `--reset` earlier
> created a second app — decide which one to keep. Easiest: run `shopify app config link` locally,
> choose the app, and use the `client_id` it writes to `shopify.app.toml` as `SHOPIFY_API_KEY`.

## 4. Grab the URL, then finish the URL-dependent settings
After the first deploy, Render shows the service URL, e.g. **`https://artiksha-reviews.onrender.com`**
(if that name was taken, it'll differ — use whatever Render assigned).

Set the last two env vars on Render → **Save** (triggers a redeploy):
| Key | Value |
|---|---|
| `SHOPIFY_APP_URL` | `https://artiksha-reviews.onrender.com` |
| `GOOGLE_REDIRECT_URI` | `https://artiksha-reviews.onrender.com/auth/google/callback` |

## 5. Point the Shopify app at the Render URL
Edit `shopify.app.toml` (locally) so these all use the Render URL:
```toml
application_url = "https://artiksha-reviews.onrender.com"

[auth]
redirect_urls = [ "https://artiksha-reviews.onrender.com/auth/callback",
                  "https://artiksha-reviews.onrender.com/auth/shopify/callback" ]

[app_proxy]
url = "https://artiksha-reviews.onrender.com/proxy"
subpath = "artiksha-reviews"
prefix = "apps"
```
Then push the config to the app:
```bash
shopify app deploy
```
(This registers the URLs, the App Proxy, and the theme extension against the app.)

## 6. Add the redirect URI in Google Cloud
Google Cloud Console → **APIs & Services → Credentials → your OAuth client → Authorized redirect URIs**
→ add **exactly** `https://artiksha-reviews.onrender.com/auth/google/callback` → Save.

## 7. Install + verify
1. Install the app on the store from the Dev Dashboard (or open it in the store admin) — this now
   loads the **real** app (Reviews + Google tabs), not the placeholder page.
2. **Reviews tab** → moderate; **Google tab → Connect Google** → pick location → sync.
3. **Storefront:** Online Store → Themes → Customize → product template → Add block → Apps →
   **Artiksha Reviews**. Submitting a review now hits the live proxy and works.

## 8. (Optional) Seed demo reviews into the live DB
On Render → the Postgres service → copy the **External Database URL**, then locally:
```bash
DATABASE_URL="<render-external-database-url>" SEED_SHOP="<your-store>.myshopify.com" npm run seed
```

---

### Notes
- **Free tier**: the web service sleeps after ~15 min idle (first hit after is a slow cold start),
  and free Postgres expires after ~30 days. Fine for testing; upgrade for production.
- **Migrations** run automatically on each deploy (`docker-start` → `prisma migrate deploy`).
- **Secrets**: they live only in Render's env + your local `.env` (gitignored). Rotate the Google
  secret later if you like — it was shared in chat during setup.
- If the admin still won't load after this, check the Render **Logs** tab and paste me any error.
