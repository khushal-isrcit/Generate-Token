/* eslint-disable no-undef, react/prop-types */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { readSelectedScopes } from "../lib/selected-scopes-cookie.server";
import { findMissingScopes } from "../lib/token-scopes";

const STOREFRONT_TOKEN_TITLE = "Easy Api Token Storefront";
const STOREFRONT_SCOPE_PREFIXES = [
  "unauthenticated_read_",
  "unauthenticated_write_",
];

const STOREFRONT_TOKENS_QUERY = `#graphql
  query StorefrontAccessTokens {
    shop {
      storefrontAccessTokens(first: 10) {
        edges {
          node {
            id
            title
            accessToken
            createdAt
            accessScopes {
              handle
            }
          }
        }
      }
    }
  }
`;

const CREATE_STOREFRONT_TOKEN_MUTATION = `#graphql
  mutation CreateStorefrontAccessToken($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) {
      storefrontAccessToken {
        id
        title
        accessToken
        createdAt
        accessScopes {
          handle
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin, session, scopes } = await authenticate.admin(request);
  const selectedScopes = await readSelectedScopes(request);
  const scopeDetails = await scopes.query();
  const missingScopes = findMissingScopes(
    selectedScopes,
    scopeDetails.granted,
  );
  const optionalGrantedScopes = scopeDetails.granted.filter((scope) =>
    scopeDetails.optional.includes(scope),
  );
  const storefrontGrantedScopes = scopeDetails.granted.filter(isStorefrontScope);
  const scopesToRevoke = optionalGrantedScopes.filter(
    (scope) => !selectedScopes.includes(scope),
  );

  if (scopesToRevoke.length > 0) {
    await scopes.revoke(scopesToRevoke);
  }

  const storefrontToken =
    storefrontGrantedScopes.length > 0
      ? await ensureStorefrontToken(admin)
      : null;

  return {
    accessToken: session.accessToken,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    grantedScopes: scopeDetails.granted.sort((left, right) =>
      left.localeCompare(right),
    ),
    missingScopes,
    stats: {
      admin: scopeDetails.granted.filter((scope) => !isStorefrontScope(scope))
        .length,
      storefront: storefrontGrantedScopes.length,
      total: scopeDetails.granted.length,
    },
    storefrontToken,
  };
};

export const action = async ({ request }) => {
  const { scopes } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestedScopes = formData
    .getAll("scopes")
    .map((scope) => String(scope).trim())
    .filter(Boolean);

  if (requestedScopes.length > 0) {
    await scopes.request(requestedScopes);
  }

  return null;
};

export default function App() {
  const {
    accessToken,
    apiKey,
    grantedScopes,
    missingScopes,
    stats,
    storefrontToken,
  } = useLoaderData();
  const fetcher = useFetcher();

  useEffect(() => {
    if (missingScopes.length === 0 || fetcher.state !== "idle") {
      return;
    }

    const formData = new FormData();
    missingScopes.forEach((scope) => formData.append("scopes", scope));
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, missingScopes]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-page heading="Access token dashboard">
        <div
          style={{
            display: "grid",
            gap: "1rem",
          }}
        >
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          >
            <MetricCard
              label="Total scopes"
              tone="success"
              value={String(stats.total)}
            />
            <MetricCard
              label="Admin scopes"
              tone="info"
              value={String(stats.admin)}
            />
            <MetricCard
              label="Storefront scopes"
              tone="caution"
              value={String(stats.storefront)}
            />
          </s-grid>

          {missingScopes.length > 0 ? (
            <s-banner heading="Requesting additional scopes" tone="info">
              {missingScopes.join(", ")}
            </s-banner>
          ) : null}

          <s-grid
            gap="base"
            gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))"
          >
            <TokenCard
              helper="Server-side Admin API token for this installed shop."
              label="Admin API token"
              scopes={grantedScopes.filter((scope) => !isStorefrontScope(scope))}
              tone="success"
              token={accessToken}
            />
            <TokenCard
              helper="Storefront access token generated from this app installation."
              label="Storefront token"
              scopes={storefrontToken?.accessScopes ?? []}
              status={storefrontToken ? "Ready" : "Unavailable"}
              statusTone={storefrontToken ? "success" : "critical"}
              tone="caution"
              token={storefrontToken?.accessToken ?? ""}
            />
          </s-grid>

          <s-section heading="Granted scopes">
            <s-box
              background="subdued"
              border="base"
              borderRadius="base"
              padding="base"
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                {grantedScopes.map((scope) => (
                  <s-badge color="base" key={scope} tone="info">
                    {scope}
                  </s-badge>
                ))}
              </div>
            </s-box>
          </s-section>
        </div>
      </s-page>
    </AppProvider>
  );
}

function MetricCard({ label, tone, value }) {
  return (
    <s-box
      background="subdued"
      border="base"
      borderRadius="base"
      padding="base"
    >
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong" tone={tone}>
          {value}
        </s-text>
      </s-stack>
    </s-box>
  );
}

function TokenCard({
  helper,
  label,
  scopes,
  status = "Live",
  statusTone = "success",
  tone,
  token,
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!token) return;

    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <s-section heading={label}>
      <s-box
        background="subdued"
        border="base"
        borderRadius="base"
        padding="base"
      >
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <s-badge tone={statusTone}>{status}</s-badge>
            <s-button
              disabled={!token}
              onClick={handleCopy}
              tone={tone}
              variant="secondary"
            >
              {copied ? "Copied" : "Copy"}
            </s-button>
          </div>

          <s-text color="subdued">{helper}</s-text>

          <div
            style={{
              background: "#0b1220",
              borderRadius: "12px",
              color: "#f8fafc",
              overflow: "hidden",
              padding: "0.9rem 1rem",
            }}
          >
            <div
              style={{
                color: "#94a3b8",
                fontSize: "0.72rem",
                letterSpacing: "0.08em",
                marginBottom: "0.4rem",
                textTransform: "uppercase",
              }}
            >
              Token value
            </div>
            <div
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, SF Mono, Consolas, monospace",
                fontSize: "0.92rem",
                overflowWrap: "anywhere",
              }}
            >
              {token || "No storefront token available for the current scopes."}
            </div>
          </div>

          <div>
            <s-text type="strong">Token scopes</s-text>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              {scopes.length > 0 ? (
                scopes.map((scope) => (
                  <s-badge color="base" key={scope} tone="auto">
                    {scope}
                  </s-badge>
                ))
              ) : (
                <s-text color="subdued">No scopes available.</s-text>
              )}
            </div>
          </div>
        </div>
      </s-box>
    </s-section>
  );
}

async function ensureStorefrontToken(admin) {
  const existingToken = await findStorefrontToken(admin);

  if (existingToken) {
    return existingToken;
  }

  const response = await admin.graphql(CREATE_STOREFRONT_TOKEN_MUTATION, {
    variables: {
      input: {
        title: STOREFRONT_TOKEN_TITLE,
      },
    },
  });
  const payload = await response.json();
  const result = payload.data?.storefrontAccessTokenCreate;

  if (result?.userErrors?.length > 0) {
    throw new Error(result.userErrors.map((error) => error.message).join(", "));
  }

  return mapStorefrontToken(result?.storefrontAccessToken);
}

async function findStorefrontToken(admin) {
  const response = await admin.graphql(STOREFRONT_TOKENS_QUERY);
  const payload = await response.json();
  const edges = payload.data?.shop?.storefrontAccessTokens?.edges ?? [];
  const matchingToken = edges
    .map((edge) => mapStorefrontToken(edge.node))
    .find((token) => token?.title === STOREFRONT_TOKEN_TITLE);

  return matchingToken ?? null;
}

function mapStorefrontToken(token) {
  if (!token) {
    return null;
  }

  return {
    accessScopes: (token.accessScopes ?? []).map((scope) => scope.handle),
    accessToken: token.accessToken,
    createdAt: token.createdAt,
    id: token.id,
    title: token.title,
  };
}

function isStorefrontScope(scope) {
  return STOREFRONT_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix));
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
