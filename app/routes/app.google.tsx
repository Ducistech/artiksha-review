// Admin — Google Business Profile connection.
// Connect (OAuth), pick which business location to import from, run a sync,
// and disconnect. Imported reviews land in the Reviews tab as published Google reviews.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit, useActionData } from "@remix-run/react";
import {
  Page,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  Select,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getConnection,
  listLocations,
  selectLocation,
  syncGoogleReviews,
  disconnectGoogle,
  type GLocation,
} from "../google.server";
import { signState } from "../lib/oauthState.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const conn = await getConnection(session.shop);

  let locations: GLocation[] = [];
  let listError: string | null = null;
  if (conn && !conn.locationName) {
    try {
      locations = await listLocations(session.shop);
    } catch (e) {
      listError = String(e).slice(0, 300);
    }
  }

  return {
    connected: !!conn,
    state: signState(session.shop),
    hasCredentials: !!process.env.GOOGLE_CLIENT_ID,
    conn: conn
      ? {
          locationName: conn.locationName,
          locationTitle: conn.locationTitle,
          lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
          lastSyncError: conn.lastSyncError,
        }
      : null,
    locations,
    listError,
  };
};

type ActionResult = { ok: boolean; message: string | null; error: string | null };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    if (intent === "selectLocation") {
      const name = String(form.get("locationName"));
      const locations = await listLocations(session.shop);
      const loc = locations.find((l) => l.name === name);
      if (!loc) return { ok: false, message: null, error: "Location not found" };
      await selectLocation(session.shop, loc);
      const result = await syncGoogleReviews(session.shop);
      return {
        ok: true,
        message: `Location saved. Imported ${result.imported} new reviews (${result.total} total).`,
        error: null,
      };
    }
    if (intent === "sync") {
      const result = await syncGoogleReviews(session.shop);
      return {
        ok: true,
        message: `Imported ${result.imported} new reviews (${result.total} total).`,
        error: null,
      };
    }
    if (intent === "disconnect") {
      await disconnectGoogle(session.shop);
      return { ok: true, message: "Google disconnected.", error: null };
    }
  } catch (e) {
    return { ok: false, message: null, error: String(e).slice(0, 400) };
  }
  return { ok: false, message: null, error: "unknown_intent" };
};

// Google gates the Business Profile APIs behind an access request; until it's granted
// the API returns 429 (quota ~0) or 403 PERMISSION_DENIED / SERVICE_DISABLED. Detect
// that so we can show a calm "approval pending" note instead of a scary raw error.
function isApprovalPending(msg?: string | null): boolean {
  if (!msg) return false;
  return /\b429\b|quota exceeded|\b403\b|permission_denied|has not been used|serviceusage|accessnotconfigured|service_disabled/i.test(
    msg,
  );
}

const APPROVAL_MESSAGE =
  "Google is still enabling Business Profile API access for your project. This is a one-time " +
  "approval that can take a few days after you submit Google's API access request form. Once it's " +
  "granted, just click Sync again — you won't need to reconnect.";

export default function GoogleAdmin() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  function post(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    submit(fd, { method: "post" });
  }

  return (
    <Page title="Google reviews" subtitle="Import your existing Google Business Profile reviews.">
      <TitleBar title="Google reviews" />
      <BlockStack gap="400">
        {actionData?.ok && actionData.message ? (
          <Banner tone="success">{actionData.message}</Banner>
        ) : null}
        {actionData && !actionData.ok ? (
          isApprovalPending(actionData.error) ? (
            <Banner tone="info" title="Google approval pending">
              <p>{APPROVAL_MESSAGE}</p>
            </Banner>
          ) : (
            <Banner tone="critical">{actionData.error}</Banner>
          )
        ) : null}

        {!data.hasCredentials ? (
          <Banner tone="warning" title="Google API credentials not configured">
            <p>
              Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{" "}
              <code>GOOGLE_REDIRECT_URI</code> in the app environment, then reload. See SETUP.md.
            </p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Connection
              </Text>
              {data.connected ? <Badge tone="success">Connected</Badge> : <Badge>Not connected</Badge>}
            </InlineStack>

            {!data.connected ? (
              <BlockStack gap="200">
                <Text as="p">
                  Connect your Google account to import the reviews on your Google Business listing.
                  You'll authorize with the Google account that manages the business.
                </Text>
                {/* top-level nav so Google's consent screen isn't blocked inside the admin iframe */}
                <InlineStack>
                  <Button
                    variant="primary"
                    disabled={!data.hasCredentials}
                    url={`/auth/google?state=${encodeURIComponent(data.state)}`}
                    target="_top"
                  >
                    Connect Google
                  </Button>
                </InlineStack>
              </BlockStack>
            ) : data.conn?.locationName ? (
              <BlockStack gap="300">
                <Text as="p">
                  Importing from <b>{data.conn.locationTitle || data.conn.locationName}</b>.
                </Text>
                <Text as="p" tone="subdued">
                  {data.conn.lastSyncedAt
                    ? `Last synced ${new Date(data.conn.lastSyncedAt).toLocaleString()}`
                    : "Not synced yet"}
                </Text>
                {data.conn.lastSyncError ? (
                  isApprovalPending(data.conn.lastSyncError) ? (
                    <Banner tone="info" title="Google approval pending">
                      <p>{APPROVAL_MESSAGE}</p>
                    </Banner>
                  ) : (
                    <Banner tone="critical">Last sync error: {data.conn.lastSyncError}</Banner>
                  )
                ) : null}
                <InlineStack gap="200">
                  <Button variant="primary" loading={busy} onClick={() => post({ intent: "sync" })}>
                    Sync now
                  </Button>
                  <Button tone="critical" disabled={busy} onClick={() => post({ intent: "disconnect" })}>
                    Disconnect
                  </Button>
                </InlineStack>
              </BlockStack>
            ) : (
              <BlockStack gap="300">
                <Text as="p">Choose which business location to import reviews from:</Text>
                {data.listError ? (
                  isApprovalPending(data.listError) ? (
                    <Banner tone="info" title="Google approval pending">
                      <p>{APPROVAL_MESSAGE}</p>
                    </Banner>
                  ) : (
                    <Banner tone="critical">Couldn't list locations: {data.listError}</Banner>
                  )
                ) : data.locations.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No manageable locations found on this Google account.
                  </Text>
                ) : (
                  <LocationPicker
                    locations={data.locations}
                    busy={busy}
                    onPick={(name) => post({ intent: "selectLocation", locationName: name })}
                  />
                )}
                <Button tone="critical" disabled={busy} onClick={() => post({ intent: "disconnect" })}>
                  Disconnect
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              How Google import works
            </Text>
            <List>
              <List.Item>Only reviews from the location you own/manage are imported.</List.Item>
              <List.Item>Google reviews import as <b>published</b> and show store-wide on product pages.</List.Item>
              <List.Item>You can still Hide or Delete any imported review from the Reviews tab — a re-sync won't bring back one you removed.</List.Item>
              <List.Item>Google's public Places API only exposes 5 reviews; this owner-authorized import gets them all.</List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function LocationPicker({
  locations,
  busy,
  onPick,
}: {
  locations: GLocation[];
  busy: boolean;
  onPick: (name: string) => void;
}) {
  const options = locations.map((l) => ({ label: l.title || l.name, value: l.name }));
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  return (
    <Box>
      <InlineStack gap="200" blockAlign="end">
        <Box minWidth="280px">
          <Select
            label="Business location"
            options={options}
            onChange={setSelected}
            value={selected}
          />
        </Box>
        <Button variant="primary" loading={busy} onClick={() => selected && onPick(selected)}>
          Save & import
        </Button>
      </InlineStack>
    </Box>
  );
}
