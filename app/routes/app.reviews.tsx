// Admin — Reviews moderation dashboard.
// List every review (customer + Google), filter by status/source, and
// Publish / Hide / Mark-spam / Delete. Deleting a fake review is a hard delete.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Button,
  ButtonGroup,
  Text,
  InlineStack,
  BlockStack,
  Tabs,
  EmptyState,
  Box,
  Modal,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  listReviewsForAdmin,
  setReviewStatus,
  deleteReview,
  replyToReview,
  type ReviewStatus,
} from "../models/review.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") as ReviewStatus | "all") || "pending";
  const { rows, byStatus } = await listReviewsForAdmin(session.shop, { status });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      productId: r.productId,
      authorName: r.authorName,
      rating: r.rating,
      title: r.title,
      body: r.body,
      reply: r.reply,
      verified: r.verified,
      createdAt: r.createdAt.toISOString(),
    })),
    byStatus,
    status,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id"));

  switch (intent) {
    case "publish":
      await setReviewStatus(session.shop, id, "published");
      break;
    case "hide":
      await setReviewStatus(session.shop, id, "hidden");
      break;
    case "spam":
      await setReviewStatus(session.shop, id, "spam");
      break;
    case "delete":
      await deleteReview(session.shop, id);
      break;
    case "reply":
      await replyToReview(session.shop, id, String(form.get("reply") || ""));
      break;
    default:
      return { ok: false, error: "unknown_intent" };
  }
  return { ok: true };
};

const STATUS_TABS: { id: ReviewStatus | "all"; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "published", label: "Published" },
  { id: "spam", label: "Spam" },
  { id: "hidden", label: "Hidden" },
  { id: "all", label: "All" },
];

function statusBadge(status: string) {
  const tone =
    status === "published"
      ? "success"
      : status === "pending"
        ? "attention"
        : status === "spam"
          ? "critical"
          : undefined;
  return <Badge tone={tone as never}>{status}</Badge>;
}

export default function ReviewsAdmin() {
  const { rows, byStatus, status } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [replyFor, setReplyFor] = useState<{ id: string; text: string } | null>(null);

  const selectedTab = Math.max(
    0,
    STATUS_TABS.findIndex((t) => t.id === status),
  );

  function act(intent: string, id: string, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    submit(fd, { method: "post" });
  }

  function confirmDelete(id: string, author: string) {
    if (window.confirm(`Delete this review by ${author}? This permanently removes it (use for fakes/spam).`)) {
      act("delete", id);
    }
  }

  const tabs = STATUS_TABS.map((t) => ({
    id: t.id,
    content: `${t.label}${byStatus[t.id] ? ` (${byStatus[t.id]})` : ""}`,
    panelID: `panel-${t.id}`,
  }));

  return (
    <Page title="Reviews" subtitle="Approve customer reviews and remove fakes. Google reviews import as published.">
      <TitleBar title="Reviews" />
      <Card padding="0">
        <Tabs
          tabs={tabs}
          selected={selectedTab}
          onSelect={(i) => {
            const next = new URLSearchParams(searchParams);
            next.set("status", String(STATUS_TABS[i].id));
            setSearchParams(next);
          }}
        >
          {rows.length === 0 ? (
            <Box padding="800">
              <EmptyState heading="No reviews here yet" image="">
                <p>Customer reviews appear here for approval. Connect Google to import your existing reviews.</p>
              </EmptyState>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "review", plural: "reviews" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "Review" },
                { title: "Rating" },
                { title: "Source" },
                { title: "Status" },
                { title: "Actions" },
              ]}
            >
              {rows.map((r, index) => (
                <IndexTable.Row id={r.id} key={r.id} position={index}>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="bold">
                        {r.authorName}
                        {r.verified ? " · verified buyer" : ""}
                      </Text>
                      {r.title ? (
                        <Text as="span" fontWeight="semibold">
                          {r.title}
                        </Text>
                      ) : null}
                      <Text as="span" tone="subdued">
                        {r.body.length > 180 ? r.body.slice(0, 180) + "…" : r.body}
                      </Text>
                      {r.reply ? (
                        <Text as="span" tone="subdued">
                          ↳ Reply: {r.reply}
                        </Text>
                      ) : null}
                      {r.productId ? (
                        <Text as="span" tone="subdued" variant="bodySm">
                          Product {r.productId}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge>{r.source === "google" ? "Google" : "Customer"}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(r.status)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <ButtonGroup>
                      {r.status !== "published" ? (
                        <Button size="slim" disabled={busy} onClick={() => act("publish", r.id)}>
                          Publish
                        </Button>
                      ) : (
                        <Button size="slim" disabled={busy} onClick={() => act("hide", r.id)}>
                          Hide
                        </Button>
                      )}
                      <Button size="slim" disabled={busy} onClick={() => setReplyFor({ id: r.id, text: r.reply || "" })}>
                        Reply
                      </Button>
                      {r.status !== "spam" ? (
                        <Button size="slim" tone="critical" disabled={busy} onClick={() => act("spam", r.id)}>
                          Spam
                        </Button>
                      ) : null}
                      <Button
                        size="slim"
                        tone="critical"
                        variant="primary"
                        disabled={busy}
                        onClick={() => confirmDelete(r.id, r.authorName)}
                      >
                        Delete
                      </Button>
                    </ButtonGroup>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Tabs>
      </Card>

      {replyFor ? (
        <Modal
          open
          onClose={() => setReplyFor(null)}
          title="Reply to review"
          primaryAction={{
            content: "Save reply",
            onAction: () => {
              act("reply", replyFor.id, { reply: replyFor.text });
              setReplyFor(null);
            },
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setReplyFor(null) }]}
        >
          <Modal.Section>
            <TextField
              label="Your public reply"
              value={replyFor.text}
              onChange={(v) => setReplyFor({ ...replyFor, text: v })}
              multiline={3}
              autoComplete="off"
            />
          </Modal.Section>
        </Modal>
      ) : null}

      <Box padding="400">
        <InlineStack align="center">
          <Text as="span" tone="subdued">
            Deleting is permanent — use it for fake or spam reviews. To temporarily remove a real review, use Hide.
          </Text>
        </InlineStack>
      </Box>
    </Page>
  );
}
