export const ADMIN_SCOPE_OPTIONS = [
  "read_all_orders",
  "write_app_proxy",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
  "read_cart_transforms",
  "write_cart_transforms",
  "read_checkout_branding_settings",
  "write_checkout_branding_settings",
  "read_checkout_and_accounts_configurations",
  "write_checkout_and_accounts_configurations",
  "read_content",
  "write_content",
  "read_customers",
  "write_customers",
  "read_delivery_customizations",
  "write_delivery_customizations",
  "read_discounts",
  "write_discounts",
  "read_draft_orders",
  "write_draft_orders",
  "read_files",
  "write_files",
  "read_fulfillments",
  "write_fulfillments",
  "read_gift_cards",
  "write_gift_cards",
  "read_inventory",
  "write_inventory",
  "read_legal_policies",
  "read_locales",
  "write_locales",
  "read_locations",
  "write_locations",
  "read_markets",
  "write_markets",
  "read_marketing_events",
  "write_marketing_events",
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_order_edits",
  "write_order_edits",
  "read_orders",
  "write_orders",
  "read_payment_customizations",
  "write_payment_customizations",
  "read_payment_terms",
  "write_payment_terms",
  "read_price_rules",
  "write_price_rules",
  "read_products",
  "write_products",
  "read_reports",
  "read_returns",
  "write_returns",
  "read_script_tags",
  "write_script_tags",
  "read_shipping",
  "write_shipping",
  "read_themes",
  "write_themes",
  "read_translations",
  "write_translations",
  "read_validations",
  "write_validations",
];

export const STOREFRONT_SCOPE_OPTIONS = [
  "unauthenticated_read_checkouts",
  "unauthenticated_write_checkouts",
  "unauthenticated_read_customers",
  "unauthenticated_write_customers",
  "unauthenticated_read_customer_tags",
  "unauthenticated_read_content",
  "unauthenticated_read_metaobjects",
  "unauthenticated_read_product_inventory",
  "unauthenticated_read_product_listings",
  "unauthenticated_read_product_pickup_locations",
  "unauthenticated_read_product_tags",
  "unauthenticated_read_selling_plans",
];

export function parseScopes(value) {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
}

export function findMissingScopes(requestedScopes, grantedScopes) {
  const granted = new Set(grantedScopes);

  return requestedScopes.filter((scope) => !granted.has(scope));
}
