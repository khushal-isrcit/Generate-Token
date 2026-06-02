/* eslint-disable react/prop-types, no-undef */
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import {
  ADMIN_SCOPE_OPTIONS,
  STOREFRONT_SCOPE_OPTIONS,
  parseScopes,
} from "../../lib/token-scopes";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return {
    configuredScopes: parseScopes(process.env.SCOPES),
    showForm: Boolean(login),
  };
};

export default function App() {
  const { configuredScopes, showForm } = useLoaderData();
  const defaultScopes = new Set(configuredScopes);
  const adminRows = buildScopeRows(ADMIN_SCOPE_OPTIONS, "Admin API");
  const storefrontRows = buildScopeRows(
    STOREFRONT_SCOPE_OPTIONS,
    "Storefront API",
  );

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <div className={styles.installPanel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.kicker}>Easy Api Token</p>
                  <h2 className={styles.panelTitle}>Connect a Shopify store</h2>
                </div>
              </div>

              <label className={styles.label}>
                <span className={styles.fieldLabel}>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="store-name.myshopify.com"
                  required
                />
                <span className={styles.fieldHint}>
                  Example: `my-shop-domain.myshopify.com`
                </span>
              </label>

              <div className={styles.scopeLayout}>
                <ScopeSection
                  defaultScopes={defaultScopes}
                  rows={adminRows}
                  title="Admin API scopes"
                  tone="admin"
                />
                <ScopeSection
                  defaultScopes={defaultScopes}
                  rows={storefrontRows}
                  tone="storefront"
                  title="Storefront API scopes"
                />
              </div>

              <div className={styles.actionRow}>
                <p className={styles.actionNote}>
                  Required scopes from app config are always included. Your
                  selections control the optional scope request after install.
                </p>
                <button className={styles.button} type="submit">
                  Install app
                </button>
              </div>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}

function ScopeSection({ defaultScopes, title, rows, tone }) {
  return (
    <section className={styles.scopeSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionText}>
            {tone === "admin"
              ? "Merchant and back-office permissions used by the Admin API."
              : "Unauthenticated storefront permissions used by headless and storefront clients."}
          </p>
        </div>
        <span
          className={`${styles.sectionBadge} ${
            tone === "admin" ? styles.adminBadge : styles.storefrontBadge
          }`}
        >
          {rows.length} groups
        </span>
      </div>
      <div className={styles.scopeList}>
        {rows.map((row) => (
          <div className={styles.scopeItem} key={row.key}>
            <input
              className={styles.checkbox}
              id={row.key}
              defaultChecked={row.scopes.every((scope) =>
                defaultScopes.has(scope),
              )}
              name="scopes"
              type="checkbox"
              value={row.scopes.join(",")}
            />
            <label className={styles.scopeContent} htmlFor={row.key}>
              <span className={styles.scopeLabel}>{row.label}</span>
              <span className={styles.scopeMeta}>
                {row.api} • {row.scopes.join(", ")}
              </span>
            </label>
          </div>
        ))}
      </div>
    </section>
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

  return [...grouped.entries()]
    .map(([base, scopes]) => ({
      api: apiLabel,
      key: `${apiLabel}-${base}`,
      label: formatScopeLabel(base),
      scopes: scopes.sort(sortScopes),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
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
