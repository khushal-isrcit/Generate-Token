import { createCookie } from "react-router";

export const selectedScopesCookie = createCookie("selected_scopes", {
  httpOnly: true,
  maxAge: 60 * 10,
  path: "/",
  sameSite: "none",
  secure: true,
});

export async function readSelectedScopes(request) {
  const cookieHeader = request.headers.get("Cookie");
  const storedValue = await selectedScopesCookie.parse(cookieHeader);

  if (!storedValue) {
    return [];
  }

  return String(storedValue)
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}
