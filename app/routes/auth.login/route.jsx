import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { selectedScopesCookie } from "../../lib/selected-scopes-cookie.server";
import { isValidMyShopifyDomain } from "../../lib/shop-domain.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop && !isValidMyShopifyDomain(shop)) {
    return {
      errors: loginErrorMessage({ shop: "INVALID_MYSHOPIFY_DOMAIN" }),
    };
  }

  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }) => {
  const formData = await request.clone().formData();
  const shop = formData.get("shop");
  const selectedScopes = [
    ...new Set(
      formData
        .getAll("scopes")
        .flatMap((value) => String(value).split(","))
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
  const cookieHeader = await selectedScopesCookie.serialize(
    selectedScopes.join(","),
  );

  if (!isValidMyShopifyDomain(shop)) {
    return {
      errors: loginErrorMessage({ shop: "INVALID_MYSHOPIFY_DOMAIN" }),
    };
  }

  try {
    const errors = loginErrorMessage(await login(request));

    return {
      errors,
    };
  } catch (response) {
    if (response instanceof Response) {
      const headers = new Headers(response.headers);
      headers.append("Set-Cookie", cookieHeader);
      throw new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    throw response;
  }
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              placeholder="store-name.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
