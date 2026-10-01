// @ts-check

/** The Vite settings that would move the HMR socket off the path the central app routes. */
const SOCKET_SETTINGS = ["path", "port", "clientPort", "server", "host"]

/**
 * Where the running Vite takes the socket settings. Vite 8.1 renamed
 * `server.hmr.path` and the others to `server.ws.*` and warns on the old name.
 * Vite 6 has no `server.ws` object and no `this.meta.viteVersion`.
 *
 * @param {string | undefined} viteVersion the running Vite's version, if it says
 * @returns {"ws" | "hmr"}
 */
export function socketOptionsKey(viteVersion) {
  const [major = 0, minor = 0] = (viteVersion ?? "").split(".").map(Number)
  return major > 8 || (major === 8 && minor >= 1) ? "ws" : "hmr"
}

/**
 * The server settings that put Vite's HMR socket on `path`, under the name the
 * running Vite reads. Throws when the project moves the socket itself, under
 * either name. Returns no settings when the project turned the socket off.
 *
 * @param {Record<string, unknown> | undefined} server the project's own `server` config
 * @param {string | undefined} viteVersion the running Vite's version, if it says
 * @param {string} path
 * @returns {{ server?: Record<string, { path: string }> }}
 */
export function hmrSocketConfig(server, viteVersion, path) {
  const own = ["hmr", "ws"].flatMap(name => {
    const value = server?.[name]
    return value !== null && typeof value === "object"
      ? SOCKET_SETTINGS.filter(key => /** @type {Record<string, unknown>} */ (value)[key] !== undefined).map(key => `server.${name}.${key}`)
      : []
  })
  if (own.length > 0) {
    throw new Error(`Caliper routes Vite's HMR socket through the Caliper app, so it cannot use ${own.join(", ")} from vite.config. Remove ${own.length === 1 ? "that setting" : "those settings"} while Caliper is in the plugins.`)
  }
  if (server?.hmr === false || server?.ws === false) return {}
  return { server: { [socketOptionsKey(viteVersion)]: { path } } }
}
