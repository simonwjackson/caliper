// @ts-check

/** @typedef {import("vite").ViteDevServer} ViteDevServer */

/**
 * The origin the dev server listens on, for Caliper's own headless browser.
 * `resolvedUrls.local` is empty when Vite listens on one non-loopback address,
 * for example a Tailscale IP, so read the socket instead.
 *
 * @param {ViteDevServer} server
 * @returns {string | null}
 */
export function listeningOrigin(server) {
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === "string") return server.resolvedUrls?.local[0] ?? null
  const wildcard = address.address === "0.0.0.0" || address.address === "::"
  const host = wildcard ? "127.0.0.1" : address.family === "IPv6" ? `[${address.address}]` : address.address
  const scheme = server.config.server.https ? "https" : "http"
  return `${scheme}://${host}:${address.port}`
}
