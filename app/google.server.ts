// Google Business Profile integration.
//
// Fetches the store's OWN Google reviews (owner-authorised via OAuth) and imports
// them as source="google" Review rows. This is the only Google API path that returns
// *all* reviews for a location — the public Places API caps at 5 and forbids storage.
//
// Requires a Google Cloud project with these APIs enabled + quota approved:
//   - My Business Account Management API
//   - My Business Business Information API
//   - Google My Business API (v4 — hosts the reviews endpoint)
// OAuth scope: https://www.googleapis.com/auth/business.manage
//
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (…/auth/google/callback)

import db from "./db.server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATIONS_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4"; // reviews still live on the v4 API

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

/** Step 1 — build the consent URL. `state` carries the shop so the callback knows who to attach to. */
export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // we need a refresh token
    prompt: "consent", // force refresh_token issuance on re-consent
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Step 2 — exchange the auth code for tokens and persist the connection. */
export async function exchangeCodeAndStore(shop: string, code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const expires = new Date(Date.now() + (tok.expires_in - 60) * 1000);

  return db.googleConnection.upsert({
    where: { shop },
    update: {
      accessToken: tok.access_token,
      ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
      tokenExpires: expires,
      lastSyncError: null,
    },
    create: {
      shop,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? "",
      tokenExpires: expires,
    },
  });
}

/** Return a valid access token, refreshing if expired. */
async function getAccessToken(shop: string): Promise<string> {
  const conn = await db.googleConnection.findUnique({ where: { shop } });
  if (!conn) throw new Error("Google is not connected for this shop");
  if (conn.tokenExpires && conn.tokenExpires.getTime() > Date.now() + 30_000) {
    return conn.accessToken;
  }
  if (!conn.refreshToken) throw new Error("No refresh token — reconnect Google");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  const expires = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await db.googleConnection.update({
    where: { shop },
    data: { accessToken: tok.access_token, tokenExpires: expires },
  });
  return tok.access_token;
}

async function gGet<T>(shop: string, url: string): Promise<T> {
  const token = await getAccessToken(shop);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status} on ${url}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface GLocation {
  name: string; // "locations/123"
  title: string;
  accountName: string;
}

/** List the business locations the connected Google account can manage (so the owner can pick one). */
export async function listLocations(shop: string): Promise<GLocation[]> {
  const accounts = await gGet<{ accounts?: { name: string }[] }>(shop, ACCOUNTS_URL);
  const out: GLocation[] = [];
  for (const acct of accounts.accounts ?? []) {
    // readMask is required by the Business Information API
    const url = `${LOCATIONS_BASE}/${acct.name}/locations?readMask=name,title&pageSize=100`;
    const locs = await gGet<{ locations?: { name: string; title: string }[] }>(shop, url);
    for (const l of locs.locations ?? []) {
      out.push({ name: l.name, title: l.title, accountName: acct.name });
    }
  }
  return out;
}

export async function selectLocation(shop: string, loc: GLocation) {
  await db.googleConnection.update({
    where: { shop },
    data: { accountName: loc.accountName, locationName: loc.name, locationTitle: loc.title },
  });
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface GReview {
  reviewId?: string;
  name?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string };
}

/** Fetch all reviews for the selected location, paging through results. */
async function fetchAllGoogleReviews(shop: string): Promise<GReview[]> {
  const conn = await db.googleConnection.findUnique({ where: { shop } });
  if (!conn?.accountName || !conn?.locationName) {
    throw new Error("Select a Google business location first");
  }
  const out: GReview[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${REVIEWS_BASE}/${conn.accountName}/${conn.locationName}/reviews?pageSize=50` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const page = await gGet<{ reviews?: GReview[]; nextPageToken?: string }>(shop, url);
    out.push(...(page.reviews ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Import Google reviews into the Review table (idempotent on externalId).
 * New Google reviews are published immediately (they're already public on Google);
 * the merchant can still hide/delete any of them from the admin.
 */
export async function syncGoogleReviews(shop: string): Promise<{ imported: number; total: number }> {
  let reviews: GReview[];
  try {
    reviews = await fetchAllGoogleReviews(shop);
  } catch (e) {
    await db.googleConnection.update({
      where: { shop },
      data: { lastSyncError: String(e).slice(0, 500), lastSyncedAt: new Date() },
    });
    throw e;
  }

  let imported = 0;
  for (const r of reviews) {
    const externalId = r.reviewId ?? r.name;
    if (!externalId) continue;
    const rating = STAR[r.starRating ?? ""] ?? 0;
    if (!rating) continue; // skip star-less "comment only" edge cases

    const data = {
      shop,
      source: "google" as const,
      status: "published",
      authorName: r.reviewer?.displayName?.slice(0, 120) || "Google user",
      rating,
      body: (r.comment ?? "").slice(0, 5000),
      reply: r.reviewReply?.comment ?? null,
      reviewedAt: r.createTime ? new Date(r.createTime) : null,
      photoUrls: r.reviewer?.profilePhotoUrl ? JSON.stringify([r.reviewer.profilePhotoUrl]) : null,
    };

    const existing = await db.review.findUnique({
      where: { shop_source_externalId: { shop, source: "google", externalId } },
    });
    if (existing) {
      // refresh mutable fields but NEVER resurrect a review the merchant hid/removed
      await db.review.update({
        where: { id: existing.id },
        data: { body: data.body, reply: data.reply, rating: data.rating },
      });
    } else {
      await db.review.create({ data: { ...data, externalId } });
      imported++;
    }
  }

  await db.googleConnection.update({
    where: { shop },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
  return { imported, total: reviews.length };
}

export async function getConnection(shop: string) {
  return db.googleConnection.findUnique({ where: { shop } });
}

export async function disconnectGoogle(shop: string) {
  return db.googleConnection.deleteMany({ where: { shop } });
}
