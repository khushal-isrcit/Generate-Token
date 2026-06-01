const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const REDIRECT_URI =
  process.env.SHOPIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const CALLBACK_URL = new URL(REDIRECT_URI);

const APP_CONFIG = loadAppConfig();
let pendingInstall = null;

printIntro();

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/") {
    sendHtml(res, renderHomePage());
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/install") {
    const form = await readFormBody(req);
    const selectedScopes = normalizeScopes(form.getAll("scopes"));
    const shop = normalizeShop(form.get("shop") || APP_CONFIG.shop);
    const createStorefrontToken = form.get("createStorefrontToken") === "on";
    const storefrontTokenTitle =
      String(form.get("storefrontTokenTitle") || "").trim() ||
      "Generated Storefront Token";
    const requestExpiringToken = form.get("requestExpiringToken") === "on";

    if (!shop) {
      sendHtml(res, renderHomePage("A shop is required."));
      return;
    }

    if (!selectedScopes.length) {
      sendHtml(res, renderHomePage("Select at least one scope."));
      return;
    }

    const state = crypto.randomBytes(16).toString("hex");

    pendingInstall = {
      createStorefrontToken,
      requestExpiringToken,
      scopes: selectedScopes,
      shop,
      state,
      storefrontTokenTitle,
    };

    const authUrl =
      `https://${shop}.myshopify.com/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(APP_CONFIG.clientId)}` +
      `&scope=${encodeURIComponent(selectedScopes.join(","))}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}`;

    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === CALLBACK_URL.pathname) {
    await handleCallback(requestUrl, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Selector: http://localhost:${PORT}`);
  console.log(`Callback: ${REDIRECT_URI}\n`);
});

async function handleCallback(requestUrl, res) {
  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const hmac = requestUrl.searchParams.get("hmac");

  if (!pendingInstall) {
    sendHtml(
      res,
      renderMessagePage(
        "No pending install request found. Restart the script and try again.",
      ),
      400,
    );
    return;
  }

  if (!code || !returnedState || !hmac) {
    sendHtml(
      res,
      renderMessagePage("Missing required Shopify callback parameters."),
      400,
    );
    return;
  }

  if (returnedState !== pendingInstall.state) {
    sendHtml(res, renderMessagePage("Invalid OAuth state."), 400);
    return;
  }

  if (!isValidHmac(requestUrl, APP_CONFIG.clientSecret)) {
    sendHtml(res, renderMessagePage("Invalid HMAC signature."), 400);
    return;
  }

  try {
    const tokenData = await exchangeCodeForAccessToken(
      pendingInstall.shop,
      code,
      pendingInstall.requestExpiringToken,
    );

    if (!tokenData.access_token) {
      throw new Error(
        `Token exchange failed: ${JSON.stringify(tokenData, null, 2)}`,
      );
    }

    console.log("\n=== OFFLINE ADMIN ACCESS TOKEN ===");
    console.log(tokenData.access_token);
    console.log("==================================");
    console.log(`Shop: ${pendingInstall.shop}`);
    console.log(`Requested scopes: ${pendingInstall.scopes.join(", ")}`);
    console.log(`Granted scopes: ${tokenData.scope || "(not returned)"}`);

    if (tokenData.expires_in) {
      console.log(
        `Access token expires in ${tokenData.expires_in} seconds (${tokenData.expires_in / 60} minutes).`,
      );
    } else {
      console.log("Token type: non-expiring offline token");
    }

    if (tokenData.refresh_token) {
      console.log(`Refresh token: ${tokenData.refresh_token}`);
      console.log(
        `Refresh token expires in ${tokenData.refresh_token_expires_in} seconds.`,
      );
    }

    console.log("\nSave these in your environment if you need them:");
    console.log(`SHOPIFY_ACCESS_TOKEN=${tokenData.access_token}`);

    if (tokenData.refresh_token) {
      console.log(`SHOPIFY_REFRESH_TOKEN=${tokenData.refresh_token}`);
    }

    let storefrontResult = null;

    if (pendingInstall.createStorefrontToken) {
      storefrontResult = await createStorefrontToken(
        pendingInstall.shop,
        tokenData.access_token,
        pendingInstall.storefrontTokenTitle,
      );

      if (storefrontResult.errors.length > 0) {
        console.log("\nStorefront token generation failed:");
        storefrontResult.errors.forEach((error) => console.log(`- ${error}`));
      } else if (storefrontResult.token) {
        console.log("\n=== STOREFRONT ACCESS TOKEN ===");
        console.log(storefrontResult.token.accessToken);
        console.log("================================");
        console.log(`Title: ${storefrontResult.token.title}`);
        console.log(
          `Scopes: ${storefrontResult.token.accessScopes
            .map((scope) => scope.handle)
            .join(", ")}`,
        );
      }
    }

    sendHtml(
      res,
      renderSuccessPage(
        pendingInstall,
        tokenData,
        storefrontResult,
      ),
    );
  } catch (error) {
    console.error("\n[!] Error:", error.message || error);
    sendHtml(res, renderMessagePage(error.message || String(error)), 500);
  } finally {
    pendingInstall = null;
  }
}

function loadAppConfig() {
  const envData = loadCliEnv();
  const tomlData = loadTomlAppData();
  const projectData = loadProjectData();

  const clientId =
    process.env.SHOPIFY_CLIENT_ID ||
    envData.SHOPIFY_API_KEY ||
    tomlData.clientId;
  const clientSecret =
    process.env.SHOPIFY_CLIENT_SECRET || envData.SHOPIFY_API_SECRET || "";
  const configuredScopes = normalizeScopes(
    process.env.SHOPIFY_SCOPES ||
      envData.SCOPES ||
      tomlData.requiredScopes.join(","),
  );
  const optionalScopes = normalizeScopes(tomlData.optionalScopes.join(","));
  const shop = normalizeShop(
    process.env.SHOPIFY_SHOP || projectData.shop || "",
  );

  if (!clientId) {
    throw new Error("Unable to determine Shopify client ID from this project.");
  }

  if (!clientSecret) {
    throw new Error(
      "Unable to determine Shopify client secret. `shopify app env show` did not return SHOPIFY_API_SECRET.",
    );
  }

  return {
    clientId,
    clientSecret,
    configuredScopes,
    optionalScopes,
    shop,
  };
}

function loadCliEnv() {
  try {
    const output = execSync("shopify app env show", {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        const [key, ...valueParts] = line.split("=");
        if (!key || valueParts.length === 0) return acc;
        acc[key.trim()] = valueParts.join("=").trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
}

function loadTomlAppData() {
  const filePath = path.join(ROOT_DIR, "shopify.app.toml");
  const content = fs.readFileSync(filePath, "utf8");

  const clientId = matchTomlString(content, /^client_id\s*=\s*"([^"]+)"/m);
  const requiredScopes = splitScopeList(
    matchTomlString(
      content,
      /^\s*scopes\s*=\s*"([^"]*)"/m,
    ),
  );
  const optionalScopes = splitScopeList(
    matchTomlString(
      content,
      /^\s*optional_scopes\s*=\s*"([^"]*)"/m,
    ),
  );

  return {
    clientId,
    optionalScopes,
    requiredScopes,
  };
}

function loadProjectData() {
  try {
    const filePath = path.join(ROOT_DIR, ".shopify", "project.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const firstEntry = Object.values(data)[0];

    return {
      shop: firstEntry?.dev_store_url || "",
    };
  } catch {
    return { shop: "" };
  }
}

function matchTomlString(content, regex) {
  return content.match(regex)?.[1] || "";
}

function splitScopeList(value) {
  return normalizeScopes(value).map((scope) => scope.trim());
}

function normalizeScopes(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);

  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeShop(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/, "");
}

function printIntro() {
  console.log("\nShopify token generator");
  console.log(`App key: ${APP_CONFIG.clientId}`);
  console.log(`Default shop: ${APP_CONFIG.shop || "(set it in the form)"}`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
  console.log(`Configured scopes in app: ${APP_CONFIG.configuredScopes.join(", ")}`);
  console.log("\nOpen the selector in your browser and choose the scopes you want.\n");
}

function isValidHmac(requestUrl, clientSecret) {
  const message = [...requestUrl.searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", clientSecret)
    .update(message, "utf8")
    .digest("hex");

  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(requestUrl.searchParams.get("hmac"), "utf8");

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function exchangeCodeForAccessToken(shop, code, requestExpiringToken) {
  const body = new URLSearchParams({
    client_id: APP_CONFIG.clientId,
    client_secret: APP_CONFIG.clientSecret,
    code,
  });

  if (requestExpiringToken) {
    body.set("expiring", "1");
  }

  const response = await fetch(
    `https://${shop}.myshopify.com/admin/oauth/access_token`,
    {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data, null, 2));
  }

  return data;
}

async function createStorefrontToken(shop, adminAccessToken, title) {
  const response = await fetch(
    `https://${shop}.myshopify.com/admin/api/2025-10/graphql.json`,
    {
      body: JSON.stringify({
        query: `#graphql
          mutation createStorefrontAccessToken($input: StorefrontAccessTokenInput!) {
            storefrontAccessTokenCreate(input: $input) {
              storefrontAccessToken {
                accessToken
                title
                accessScopes {
                  handle
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
        variables: {
          input: { title },
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminAccessToken,
      },
      method: "POST",
    },
  );

  const data = await response.json();
  const payload = data.data?.storefrontAccessTokenCreate;
  const graphQLErrors = data.errors?.map((error) => error.message) || [];
  const userErrors = payload?.userErrors?.map((error) => error.message) || [];

  return {
    errors: [...graphQLErrors, ...userErrors],
    token: payload?.storefrontAccessToken || null,
  };
}

async function readFormBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderHomePage(errorMessage = "") {
  const configuredSet = new Set([
    ...APP_CONFIG.configuredScopes,
    ...APP_CONFIG.optionalScopes,
  ]);

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Shopify Token Generator</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #f6f6f7; color: #202223; }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 60px; }
        .hero, .panel { background: #fff; border: 1px solid #e1e3e5; border-radius: 16px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
        .hero { margin-bottom: 20px; }
        .grid { display: grid; gap: 20px; }
        .grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
        .scope-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
        .scope { display: flex; gap: 10px; align-items: start; padding: 12px; border: 1px solid #e1e3e5; border-radius: 12px; background: #fbfbfb; }
        .scope code { display: block; font-size: 13px; margin-bottom: 4px; }
        .hint { color: #6d7175; font-size: 14px; }
        .warning { background: #fff5ea; border: 1px solid #ffd79d; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }
        .error { background: #fff1f1; border-color: #e4a2a2; }
        .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #edf3ff; margin: 4px 6px 0 0; font-size: 13px; }
        .pill.on { background: #eaf7ee; }
        .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
        button { background: #111827; color: #fff; border: 0; border-radius: 10px; padding: 12px 16px; cursor: pointer; }
        button.secondary { background: #fff; color: #111827; border: 1px solid #d2d5d8; }
        input[type=text] { width: 100%; padding: 12px; border: 1px solid #c9cccf; border-radius: 10px; box-sizing: border-box; }
        h1, h2, h3 { margin-top: 0; }
        .section-title { margin: 28px 0 12px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="hero">
          <h1>Shopify OAuth token generator</h1>
          <p class="hint">This page reads your app key, app secret, dev store, and current configured scopes directly from this project. Select the scopes you want, then install the app to generate an Admin token and optionally a Storefront token.</p>
          ${
            errorMessage
              ? `<div class="warning error">${escapeHtml(errorMessage)}</div>`
              : ""
          }
          <div>
            <div><strong>App key:</strong> ${escapeHtml(APP_CONFIG.clientId)}</div>
            <div><strong>Default shop:</strong> ${escapeHtml(APP_CONFIG.shop || "(not found)")}</div>
            <div><strong>Redirect URI:</strong> ${escapeHtml(REDIRECT_URI)}</div>
          </div>
          <div style="margin-top: 14px;">
            <strong>Already configured in this app:</strong><br />
            ${[...configuredSet]
              .map(
                (scope) =>
                  `<span class="pill on">${escapeHtml(scope)}</span>`,
              )
              .join("") || '<span class="hint">No scopes found in app config.</span>'}
          </div>
        </div>

        <form method="post" action="/install">
          <div class="grid grid-3">
            <div class="panel">
              <h3>Install details</h3>
              <label class="hint">Shop</label>
              <input type="text" name="shop" value="${escapeHtml(APP_CONFIG.shop)}" placeholder="your-store" />
              <div style="margin-top: 12px;">
                <label><input type="checkbox" name="requestExpiringToken" /> Request expiring offline token</label>
              </div>
              <div style="margin-top: 8px;">
                <label><input type="checkbox" name="createStorefrontToken" /> Also create a Storefront token after Admin token exchange</label>
              </div>
              <div style="margin-top: 12px;">
                <label class="hint">Storefront token title</label>
                <input type="text" name="storefrontTokenTitle" value="Generated Storefront Token" />
              </div>
            </div>

            <div class="panel" style="grid-column: span 2;">
              <h3>Quick actions</h3>
              <div class="actions">
                <button type="button" class="secondary" onclick="toggleAll(true)">Select all</button>
                <button type="button" class="secondary" onclick="toggleAll(false)">Clear all</button>
                <button type="button" class="secondary" onclick="toggleCategory('authenticated', true)">Select all Admin</button>
                <button type="button" class="secondary" onclick="toggleCategory('unauthenticated', true)">Select all Storefront</button>
                <button type="button" class="secondary" onclick="toggleCategory('customer', true)">Select all Customer</button>
                <button type="button" class="secondary" onclick="selectConfigured()">Select configured app scopes</button>
              </div>
              <p class="hint">Shopify will grant only scopes that your app type and app configuration actually allow. Selecting everything here doesn’t bypass Shopify permissions or Partner Dashboard approvals.</p>
            </div>
          </div>

          ${renderScopeSection(
            "Authenticated Admin / Payments / Web Pixel scopes",
            "authenticated",
            AUTHENTICATED_SCOPES,
            configuredSet,
          )}
          ${renderScopeSection(
            "Unauthenticated Storefront scopes",
            "unauthenticated",
            UNAUTHENTICATED_SCOPES,
            configuredSet,
          )}
          ${renderScopeSection(
            "Customer Account scopes",
            "customer",
            CUSTOMER_SCOPES,
            configuredSet,
          )}

          <div class="panel" style="margin-top: 20px;">
            <button type="submit">Generate token</button>
          </div>
        </form>
      </div>
      <script>
        const configuredScopes = ${JSON.stringify([...configuredSet])};

        function toggleAll(checked) {
          document.querySelectorAll('input[name="scopes"]').forEach((input) => {
            input.checked = checked;
          });
        }

        function toggleCategory(category, checked) {
          document.querySelectorAll('input[data-category="' + category + '"]').forEach((input) => {
            input.checked = checked;
          });
        }

        function selectConfigured() {
          const configured = new Set(configuredScopes);
          document.querySelectorAll('input[name="scopes"]').forEach((input) => {
            input.checked = configured.has(input.value);
          });
        }
      </script>
    </body>
  </html>`;
}

function renderScopeSection(title, category, scopes, configuredSet) {
  return `
    <div class="panel section-title">
      <h2>${escapeHtml(title)}</h2>
      <div class="scope-grid">
        ${scopes
          .map((scope) => {
            const checked = configuredSet.has(scope.handle) ? "checked" : "";
            const configured = configuredSet.has(scope.handle)
              ? '<span class="pill on">configured</span>'
              : "";

            return `<label class="scope">
              <input type="checkbox" name="scopes" data-category="${escapeHtml(
                category,
              )}" value="${escapeHtml(scope.handle)}" ${checked} />
              <span>
                <code>${escapeHtml(scope.handle)}</code>
                <div>${escapeHtml(scope.description)}</div>
                <div style="margin-top: 6px;">${configured}</div>
              </span>
            </label>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderSuccessPage(selection, tokenData, storefrontResult) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Token created</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #f6f6f7; color: #202223; }
        .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 60px; }
        .panel { background: #fff; border: 1px solid #e1e3e5; border-radius: 16px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 20px; }
        textarea { width: 100%; box-sizing: border-box; min-height: 110px; padding: 12px; border: 1px solid #c9cccf; border-radius: 10px; font-family: monospace; }
        .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #eaf7ee; margin: 4px 6px 0 0; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="panel">
          <h1>Token created</h1>
          <p>Shop: ${escapeHtml(selection.shop)}</p>
          <p>Requested scopes:</p>
          <div>${selection.scopes
            .map((scope) => `<span class="pill">${escapeHtml(scope)}</span>`)
            .join("")}</div>
        </div>
        <div class="panel">
          <h2>Admin token</h2>
          <textarea readonly>${escapeHtml(tokenData.access_token)}</textarea>
          <p>Granted scopes: ${escapeHtml(tokenData.scope || "(not returned)")}</p>
          <p>Type: ${
            tokenData.expires_in
              ? `expiring offline token (${tokenData.expires_in} seconds)`
              : "non-expiring offline token"
          }</p>
          ${
            tokenData.refresh_token
              ? `<p>Refresh token: <code>${escapeHtml(tokenData.refresh_token)}</code></p>`
              : ""
          }
        </div>
        ${
          selection.createStorefrontToken
            ? `<div class="panel">
                <h2>Storefront token</h2>
                ${
                  storefrontResult?.errors?.length
                    ? `<p>${escapeHtml(storefrontResult.errors.join(" | "))}</p>`
                    : storefrontResult?.token
                      ? `<textarea readonly>${escapeHtml(
                          storefrontResult.token.accessToken,
                        )}</textarea>
                         <p>Title: ${escapeHtml(storefrontResult.token.title)}</p>
                         <p>Scopes: ${escapeHtml(
                           storefrontResult.token.accessScopes
                             .map((scope) => scope.handle)
                             .join(", "),
                         )}</p>`
                      : "<p>No Storefront token returned.</p>"
                }
              </div>`
            : ""
        }
      </div>
    </body>
  </html>`;
}

function renderMessagePage(message) {
  return `<!doctype html>
  <html>
    <body style="font-family: Arial, sans-serif; padding: 32px;">
      <h2>Shopify token generator</h2>
      <p>${escapeHtml(message)}</p>
      <p><a href="/">Back</a></p>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const AUTHENTICATED_SCOPES = [
  { handle: "read_all_orders", description: "Read all orders beyond the default 60 day window. Partner approval required." },
  { handle: "write_app_proxy", description: "Use app proxies." },
  { handle: "read_assigned_fulfillment_orders", description: "Read assigned fulfillment orders." },
  { handle: "write_assigned_fulfillment_orders", description: "Write assigned fulfillment orders." },
  { handle: "read_merchant_managed_fulfillment_orders", description: "Read merchant managed fulfillment orders." },
  { handle: "write_merchant_managed_fulfillment_orders", description: "Write merchant managed fulfillment orders." },
  { handle: "read_third_party_fulfillment_orders", description: "Read third party fulfillment orders." },
  { handle: "write_third_party_fulfillment_orders", description: "Write third party fulfillment orders." },
  { handle: "read_marketplace_fulfillment_orders", description: "Read marketplace fulfillment orders." },
  { handle: "read_cart_transforms", description: "Read cart transform functions." },
  { handle: "write_cart_transforms", description: "Write cart transform functions." },
  { handle: "read_checkout_branding_settings", description: "Read checkout branding settings." },
  { handle: "write_checkout_branding_settings", description: "Write checkout branding settings." },
  { handle: "read_checkout_and_accounts_configurations", description: "Read checkout and customer account configurations." },
  { handle: "write_checkout_and_accounts_configurations", description: "Write checkout and customer account configurations." },
  { handle: "read_content", description: "Read articles, blogs, comments, and pages." },
  { handle: "write_content", description: "Write articles, blogs, comments, and pages." },
  { handle: "read_online_store_pages", description: "Read online store pages." },
  { handle: "read_customer_events", description: "Read customer events." },
  { handle: "write_pixels", description: "Write web pixels." },
  { handle: "read_customer_merge", description: "Read customer merge previews and requests." },
  { handle: "write_customer_merge", description: "Write customer merge requests." },
  { handle: "read_customer_payment_methods", description: "Read customer payment methods. Partner approval required." },
  { handle: "read_customers", description: "Read customers, segments, companies, and company locations." },
  { handle: "write_customers", description: "Write customers, segments, companies, and company locations." },
  { handle: "read_delivery_customizations", description: "Read delivery customizations." },
  { handle: "write_delivery_customizations", description: "Write delivery customizations." },
  { handle: "read_discounts", description: "Read discount data." },
  { handle: "write_discounts", description: "Write discount data." },
  { handle: "read_draft_orders", description: "Read draft orders." },
  { handle: "write_draft_orders", description: "Write draft orders." },
  { handle: "read_files", description: "Read files." },
  { handle: "write_files", description: "Write files." },
  { handle: "read_fulfillments", description: "Read fulfillments." },
  { handle: "write_fulfillments", description: "Write fulfillments." },
  { handle: "read_gift_cards", description: "Read gift cards." },
  { handle: "write_gift_cards", description: "Write gift cards." },
  { handle: "read_inventory", description: "Read inventory levels and items." },
  { handle: "write_inventory", description: "Write inventory levels and items." },
  { handle: "read_legal_policies", description: "Read legal policies." },
  { handle: "read_locales", description: "Read locales." },
  { handle: "write_locales", description: "Write locales." },
  { handle: "read_locations", description: "Read locations." },
  { handle: "write_locations", description: "Write locations." },
  { handle: "read_markets", description: "Read markets." },
  { handle: "write_markets", description: "Write markets." },
  { handle: "read_marketing_events", description: "Read marketing events and activities." },
  { handle: "write_marketing_events", description: "Write marketing events and activities." },
  { handle: "read_merchant_approval_signals", description: "Read merchant approval signals." },
  { handle: "read_metaobject_definitions", description: "Read metaobject definitions." },
  { handle: "write_metaobject_definitions", description: "Write metaobject definitions." },
  { handle: "read_metaobjects", description: "Read metaobjects." },
  { handle: "write_metaobjects", description: "Write metaobjects." },
  { handle: "read_online_store_navigation", description: "Read online store navigation and redirects." },
  { handle: "write_online_store_navigation", description: "Write online store navigation and redirects." },
  { handle: "read_order_edits", description: "Read order edits." },
  { handle: "write_order_edits", description: "Write order edits." },
  { handle: "read_orders", description: "Read orders, abandoned checkouts, fulfillments, and order transactions." },
  { handle: "write_orders", description: "Write orders, abandoned checkouts, fulfillments, and order transactions." },
  { handle: "read_own_subscription_contracts", description: "Read own subscription contracts. Partner approval required." },
  { handle: "write_own_subscription_contracts", description: "Write own subscription contracts. Partner approval required." },
  { handle: "read_payment_customizations", description: "Read payment customizations." },
  { handle: "write_payment_customizations", description: "Write payment customizations." },
  { handle: "read_payment_gateways", description: "Read payment gateways." },
  { handle: "write_payment_gateways", description: "Write payment gateways." },
  { handle: "read_payment_mandate", description: "Read payment mandates." },
  { handle: "write_payment_mandate", description: "Write payment mandates." },
  { handle: "write_payment_sessions", description: "Write payment sessions." },
  { handle: "read_payment_terms", description: "Read payment terms." },
  { handle: "write_payment_terms", description: "Write payment terms." },
  { handle: "read_price_rules", description: "Read price rules." },
  { handle: "write_price_rules", description: "Write price rules." },
  { handle: "read_privacy_settings", description: "Read privacy settings." },
  { handle: "write_privacy_settings", description: "Write privacy settings." },
  { handle: "read_products", description: "Read products, variants, collections, and resource feedback." },
  { handle: "write_products", description: "Write products, variants, collections, and resource feedback." },
  { handle: "read_reports", description: "Read analytics and reporting data." },
  { handle: "read_returns", description: "Read returns." },
  { handle: "write_returns", description: "Write returns." },
  { handle: "read_script_tags", description: "Read script tags." },
  { handle: "write_script_tags", description: "Write script tags." },
  { handle: "read_shipping", description: "Read shipping and delivery carrier services." },
  { handle: "write_shipping", description: "Write shipping and delivery carrier services." },
  { handle: "read_shopify_payments_disputes", description: "Read Shopify Payments disputes." },
  { handle: "read_shopify_payments_dispute_evidences", description: "Read Shopify Payments dispute evidences." },
  { handle: "read_shopify_payments_payouts", description: "Read Shopify Payments payouts and balance transactions." },
  { handle: "read_store_credit_accounts", description: "Read store credit accounts." },
  { handle: "read_store_credit_account_transactions", description: "Read store credit account transactions." },
  { handle: "write_store_credit_account_transactions", description: "Write store credit account transactions." },
  { handle: "read_themes", description: "Read themes." },
  { handle: "write_themes", description: "Write themes." },
  { handle: "read_translations", description: "Read translations." },
  { handle: "write_translations", description: "Write translations." },
  { handle: "read_users", description: "Read users and staff members. Shopify Plus only." },
  { handle: "read_validations", description: "Read validations." },
  { handle: "write_validations", description: "Write validations." },
];

const UNAUTHENTICATED_SCOPES = [
  { handle: "unauthenticated_read_checkouts", description: "Read cart and checkout data." },
  { handle: "unauthenticated_write_checkouts", description: "Write cart and checkout data." },
  { handle: "unauthenticated_read_customers", description: "Read customer data through the Storefront API." },
  { handle: "unauthenticated_write_customers", description: "Write customer data through the Storefront API." },
  { handle: "unauthenticated_read_customer_tags", description: "Read customer tags through the Storefront API." },
  { handle: "unauthenticated_read_content", description: "Read storefront content such as blogs and articles." },
  { handle: "unauthenticated_read_metaobjects", description: "Read storefront metaobjects." },
  { handle: "unauthenticated_read_product_inventory", description: "Read product inventory availability." },
  { handle: "unauthenticated_read_product_listings", description: "Read products and collections." },
  { handle: "unauthenticated_read_product_pickup_locations", description: "Read pickup locations and store availability." },
  { handle: "unauthenticated_read_product_tags", description: "Read product tags." },
  { handle: "unauthenticated_read_selling_plans", description: "Read selling plans." },
];

const CUSTOMER_SCOPES = [
  { handle: "customer_read_customers", description: "Read customers through the Customer Account API." },
  { handle: "customer_write_customers", description: "Write customers through the Customer Account API." },
  { handle: "customer_read_orders", description: "Read orders through the Customer Account API." },
  { handle: "customer_write_orders", description: "Write orders through the Customer Account API." },
  { handle: "customer_read_draft_orders", description: "Read draft orders through the Customer Account API." },
  { handle: "customer_read_markets", description: "Read markets through the Customer Account API." },
  { handle: "customer_read_metaobjects", description: "Read metaobjects through the Customer Account API." },
  { handle: "customer_read_store_credit_accounts", description: "Read store credit accounts through the Customer Account API." },
  { handle: "customer_read_own_subscription_contracts", description: "Read own subscription contracts through the Customer Account API." },
  { handle: "customer_write_own_subscription_contracts", description: "Write own subscription contracts through the Customer Account API." },
  { handle: "customer_write_subscription_contracts", description: "Write all subscription contracts for Hydrogen and Headless storefronts." },
  { handle: "customer_read_companies", description: "Read companies through the Customer Account API." },
  { handle: "customer_write_companies", description: "Write companies through the Customer Account API." },
  { handle: "customer_read_locations", description: "Read company locations through the Customer Account API." },
  { handle: "customer_write_locations", description: "Write company locations through the Customer Account API." },
];
