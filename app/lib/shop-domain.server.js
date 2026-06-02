export function normalizeShopDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function isValidMyShopifyDomain(value) {
  const shop = normalizeShopDomain(value);

  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}
