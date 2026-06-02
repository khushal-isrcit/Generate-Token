/* eslint-disable no-undef */
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { readSelectedScopes } from "../lib/selected-scopes-cookie.server";

export const loader = async ({ request }) => {
  const { session, scopes } = await authenticate.admin(request);
  const selectedScopes = await readSelectedScopes(request);
  const grantedScopes = (await scopes.query()).granted;
  const missingScopes = selectedScopes.filter(
    (scope) => !grantedScopes.includes(scope),
  );

  if (missingScopes.length > 0) {
    await scopes.request(missingScopes);
  }

  // eslint-disable-next-line no-undef
  return {
    accessToken: session.accessToken,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const { accessToken, apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-page heading="Generated token">
        <textarea
          readOnly
          rows={10}
          style={{
            border: "1px solid #c9cccf",
            borderRadius: "10px",
            fontFamily: "monospace",
            padding: "0.75rem",
            width: "100%",
          }}
          value={accessToken}
        />
      </s-page>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
