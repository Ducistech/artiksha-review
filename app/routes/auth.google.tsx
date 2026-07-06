// Kicks off Google OAuth. Opened top-level (target=_top) from the embedded admin
// with a signed `state` minted in app.google.tsx. Just verifies + redirects to Google.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getAuthUrl } from "../google.server";
import { verifyState } from "../lib/oauthState.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const shop = verifyState(state);
  if (!shop) {
    return new Response("Invalid or expired authorization state. Please retry from the app.", {
      status: 400,
    });
  }
  return redirect(getAuthUrl(state as string));
};
