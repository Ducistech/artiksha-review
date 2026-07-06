import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Button,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [pending, published, google, conn] = await Promise.all([
    db.review.count({ where: { shop: session.shop, status: "pending" } }),
    db.review.count({ where: { shop: session.shop, status: "published" } }),
    db.review.count({ where: { shop: session.shop, source: "google" } }),
    db.googleConnection.findUnique({ where: { shop: session.shop } }),
  ]);
  return { pending, published, google, googleConnected: !!conn?.locationName };
};

export default function Index() {
  const { pending, published, google, googleConnected } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Artiksha Reviews" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Reviews at a glance
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                  <Stat label="Pending approval" value={pending} tone="attention" />
                  <Stat label="Published" value={published} tone="success" />
                  <Stat label="From Google" value={google} />
                </InlineGrid>
                <InlineStack gap="200">
                  <Button url="/app/reviews" variant="primary">
                    Moderate reviews
                  </Button>
                  <Button url="/app/google">
                    {googleConnected ? "Google connected" : "Connect Google"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Show reviews on your storefront
                </Text>
                <Text as="p">
                  Add the <b>Product reviews</b> block to your product template in the theme editor
                  (Online Store → Themes → Customize → a product page → Add block → Apps →
                  Product reviews). Customers can then read reviews and submit their own; new
                  submissions land in the Reviews tab for your approval.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <BlockStack gap="100" inlineAlign="start">
        <Text as="span" tone="subdued">
          {label}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="heading2xl">
            {String(value)}
          </Text>
          {tone && value > 0 ? (
            <Badge tone={tone as never}>{tone === "attention" ? "needs review" : "live"}</Badge>
          ) : null}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
