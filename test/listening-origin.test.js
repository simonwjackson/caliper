// @ts-check
import { describe, expect, test } from "bun:test"
import { listeningOrigin } from "../src/server-origin.js"

/**
 * A dev server as listeningOrigin reads it: the socket address, the https
 * setting and Vite's resolved URLs.
 *
 * @param {{ address: string, family: string, port: number } | null} address
 * @param {{ https?: boolean, local?: string[] }} [more]
 */
function serverAt(address, { https = false, local = [] } = {}) {
  return /** @type {any} */ ({
    httpServer: { address: () => address },
    config: { server: { https } },
    resolvedUrls: { local, network: [] },
  })
}

describe("listeningOrigin", () => {
  test("uses the one address Vite listens on, even when it is not loopback", () => {
    expect(listeningOrigin(serverAt({ address: "100.64.0.1", family: "IPv4", port: 5198 }))).toBe("http://100.64.0.1:5198")
  })

  test("uses loopback when Vite listens on every address", () => {
    expect(listeningOrigin(serverAt({ address: "0.0.0.0", family: "IPv4", port: 5173 }))).toBe("http://127.0.0.1:5173")
    expect(listeningOrigin(serverAt({ address: "::", family: "IPv6", port: 5173 }))).toBe("http://127.0.0.1:5173")
  })

  test("brackets an IPv6 address and keeps https", () => {
    expect(listeningOrigin(serverAt({ address: "::1", family: "IPv6", port: 5173 }, { https: true }))).toBe("https://[::1]:5173")
  })

  test("falls back to Vite's local URL before the server listens", () => {
    expect(listeningOrigin(serverAt(null, { local: ["http://localhost:5173/"] }))).toBe("http://localhost:5173/")
    expect(listeningOrigin(serverAt(null))).toBe(null)
  })
})
