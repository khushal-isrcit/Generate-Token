import { useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  ADMIN_SCOPE_OPTIONS,
  STOREFRONT_SCOPE_OPTIONS,
  parseScopes,
} from "../lib/token-scopes";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const adminScopes = formData.getAll("adminScopes").map(String);
  const storefrontScopes = formData.getAll("storefrontScopes").map(String);

  let storefrontToken = null;
  let errors = [];

  if (storefrontScopes.length > 0) {
    const response = await admin.graphql(
      `#graphql
        mutation createStorefrontAccessToken($input: StorefrontAccessTokenInput!) {
          storefrontAccessTokenCreate(input: $input) {
            storefrontAccessToken {
              accessToken
              title
            }
            userErrors {
              message
            }
          }
        }`,
      {
        variables: {
          input: {
            title: "Generated Storefront Token",
          },
        },
      },
    );

    const responseJson = await response.json();
    const payload = responseJson.data?.storefrontAccessTokenCreate;
    const graphQLErrors =
      responseJson.errors?.map((error) => error.message) || [];
    const userErrors =
      payload?.userErrors?.map((error) => error.message) || [];
    errors = [...graphQLErrors, ...userErrors];
    storefrontToken = payload?.storefrontAccessToken || null;
  }

  return {
    adminToken: adminScopes.length > 0 ? session.accessToken : null,
    errors,
    status: errors.length > 0 ? "error" : "success",
    storefrontToken,
  };
};

export default function Index() {
  useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const formRef = useRef(null);
  const [adminScopes, setAdminScopes] = useState([]);
  const [storefrontScopes, setStorefrontScopes] = useState([]);
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const selectedScopes = useMemo(
    () => [...new Set([...adminScopes, ...storefrontScopes])],
    [adminScopes, storefrontScopes],
  );

  const toggleScope = (scope, _selected, setSelected) => {
    setSelected((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  };

  const handleGenerate = async () => {
    if (selectedScopes.length === 0) {
      shopify.toast.show("Select at least one API scope");
      return;
    }

    fetcher.submit(formRef.current, { method: "POST" });
  };

  return (
    <s-page heading="Token generator">
      <fetcher.Form method="post" ref={formRef}>
        <div style={{ marginBottom: "1.5rem" }}>
          <ScopeBlock
            apiLabel="Admin API"
            name="adminScopes"
            options={ADMIN_SCOPE_OPTIONS}
            onSelectAll={() => setAdminScopes([...ADMIN_SCOPE_OPTIONS])}
            onClearAll={() => setAdminScopes([])}
            selected={adminScopes}
            setSelected={setAdminScopes}
            title="Admin API"
            toggleScope={toggleScope}
          />
        </div>
        <div>
          <ScopeBlock
            apiLabel="Storefront API"
            name="storefrontScopes"
            options={STOREFRONT_SCOPE_OPTIONS}
            onSelectAll={() => setStorefrontScopes([...STOREFRONT_SCOPE_OPTIONS])}
            onClearAll={() => setStorefrontScopes([])}
            selected={storefrontScopes}
            setSelected={setStorefrontScopes}
            title="Storefront API"
            toggleScope={toggleScope}
          />
        </div>

        <div style={{ marginBlock: "1rem" }}>
          <s-button
            onClick={handleGenerate}
            {...(isLoading ? { loading: true } : {})}
          >
            Generate token
          </s-button>
        </div>
      </fetcher.Form>

      {fetcher.data?.adminToken ? (
        <TokenOutput title="Admin token" token={fetcher.data.adminToken} />
      ) : null}

      {fetcher.data?.storefrontToken?.accessToken ? (
        <TokenOutput
          title="Storefront token"
          token={fetcher.data.storefrontToken.accessToken}
        />
      ) : null}

      {fetcher.data?.errors?.length ? (
        <Message text={fetcher.data.errors.join(" | ")} tone="critical" />
      ) : null}
    </s-page>
  );
}

function ScopeBlock({
  title,
  name,
  options,
  apiLabel,
  selected,
  toggleScope,
  setSelected,
  onSelectAll,
  onClearAll,
}) {
  const rows = buildScopeRows(options, apiLabel);

  return (
    <s-section heading={title}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #d9e1e4",
          borderRadius: "14px",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
          marginTop: "0.75rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "#f7f9fb",
            borderBottom: "1px solid #d9e1e4",
            color: "#41545d",
            display: "grid",
            fontSize: "0.85rem",
            fontWeight: 700,
            gap: "1rem",
            gridTemplateColumns: "150px 1fr 2.2fr",
            padding: "0.9rem 1rem",
          }}
        >
          <span>API</span>
          <span>Resource</span>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <span>Scopes</span>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "0.75rem",
              }}
            >
              <button
                onClick={onSelectAll}
                style={headerButtonStyle}
                type="button"
              >
                Select all
              </button>
              <button
                onClick={onClearAll}
                style={headerButtonStyle}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            maxHeight: "520px",
            overflowY: "auto",
            scrollbarColor: "#c4d1d7 #f4f7f8",
          }}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              style={{
                borderBottom: "1px solid #e6edef",
                color: "#1f2d35",
                display: "grid",
                gap: "1rem",
                gridTemplateColumns: "150px 1fr 2.2fr",
                padding: "0.95rem 1rem",
              }}
            >
              <div style={{ color: "#61757e", fontSize: "0.95rem" }}>
                {row.api}
              </div>
              <div
                style={{
                  color: "#1d2d35",
                  fontSize: "0.98rem",
                  fontWeight: 600,
                  lineHeight: 1.35,
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.45rem",
                }}
              >
                {row.scopes.map((scope) => (
                  <label
                    key={scope}
                    style={{
                      alignItems: "center",
                      color: "#40545c",
                      display: "flex",
                      gap: "0.55rem",
                    }}
                  >
                    <input
                      checked={selected.includes(scope)}
                      name={name}
                      onChange={() => toggleScope(scope, selected, setSelected)}
                      type="checkbox"
                      value={scope}
                    />
                    <code
                      style={{
                        color: "#21343d",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "0.92rem",
                      }}
                    >
                      {scope}
                    </code>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </s-section>
  );
}

function buildScopeRows(options, apiLabel) {
  const grouped = new Map();

  for (const scope of options) {
    const base = getScopeBase(scope);

    if (!grouped.has(base)) {
      grouped.set(base, []);
    }

    grouped.get(base).push(scope);
  }

  return [...grouped.entries()].map(([base, scopes]) => ({
    api: apiLabel,
    key: `${apiLabel}-${base}`,
    label: formatScopeLabel(base),
    scopes: scopes.sort(sortScopes),
  }));
}

function getScopeBase(scope) {
  const prefixes = [
    "unauthenticated_read_",
    "unauthenticated_write_",
    "read_",
    "write_",
  ];

  for (const prefix of prefixes) {
    if (scope.startsWith(prefix)) {
      return scope.slice(prefix.length);
    }
  }

  return scope;
}

function formatScopeLabel(base) {
  const labels = {
    all_orders: "All Orders",
    app_proxy: "App Proxy",
    assigned_fulfillment_orders: "Assigned Fulfillment",
    cart_transforms: "Cart Transform API",
    checkout_and_accounts_configurations:
      "Checkout and Accounts Configurations",
    checkout_branding_settings: "Checkout Branding Settings",
    customer_tags: "Customer Tags",
    delivery_customizations: "Delivery Customizations",
    draft_orders: "Draft Orders",
    gift_cards: "Gift Cards",
    legal_policies: "Legal Policies",
    marketing_events: "Marketing Events",
    metaobject_definitions: "Metaobject Definitions",
    online_store_navigation: "Online Store Navigation",
    order_edits: "Order Edits",
    payment_customizations: "Payment Customizations",
    payment_terms: "Payment Terms",
    price_rules: "Price Rules",
    product_inventory: "Product Inventory",
    product_listings: "Product Listings",
    product_pickup_locations: "Product Pickup Locations",
    product_tags: "Product Tags",
    script_tags: "Script Tags",
    selling_plans: "Selling Plans",
    validations: "Cart and Checkout Validations",
  };

  if (labels[base]) {
    return labels[base];
  }

  return base
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sortScopes(left, right) {
  const rank = (value) => {
    if (value.includes("_read_") || value.startsWith("read_")) return 0;
    if (value.includes("_write_") || value.startsWith("write_")) return 1;
    return 2;
  };

  return rank(left) - rank(right) || left.localeCompare(right);
}

const headerButtonStyle = {
  background: "#ffffff",
  border: "1px solid #c9d6db",
  borderRadius: "999px",
  color: "#31444d",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 600,
  padding: "0.35rem 0.7rem",
};

function TokenOutput({ title, token }) {
  return (
    <s-section heading={title}>
      <textarea
        readOnly
        rows={5}
        style={{
          border: "1px solid #c9cccf",
          borderRadius: "10px",
          fontFamily: "monospace",
          padding: "0.75rem",
          width: "100%",
        }}
        value={token}
      />
    </s-section>
  );
}

function Message({ text, tone }) {
  const background = tone === "critical" ? "#fff1f1" : "#fff8e1";

  return (
    <div
      style={{
        background,
        border: "1px solid #d8d8d8",
        borderRadius: "10px",
        marginTop: "1rem",
        padding: "0.75rem",
      }}
    >
      {text}
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
