/** Cloudflare Worker entry point for the public ilXyr protocol index. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const PUBLIC_SECURITY_HEADERS = {
  "Content-Security-Policy": "base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function withPublicSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PUBLIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if ((request.method === "GET" || request.method === "HEAD") && response.ok && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withPublicSecurityHeaders(
        request,
        new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }),
      );
    }

    if (new URL(request.url).pathname === "/_vinext/image") {
      return withPublicSecurityHeaders(request, new Response("Not found", { status: 404 }));
    }

    return withPublicSecurityHeaders(request, await handler.fetch(request, env, ctx));
  },
};

export default worker;
