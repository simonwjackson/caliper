// @ts-nocheck: a service worker; the project checks browser pages, not worker globals.
// Caliper's service worker (decision 37). It routes requests; it caches no
// responses and gives no offline use.
//
// A frame's document URL is /__caliper/p/<id>/..., so the frame's client URL
// names its project. The worker sends each of the frame's requests, such as
// /@vite/client or /src/App.tsx, to /__caliper/p/<id>/<path> and returns the
// response under the URL the frame asked for, so each module has one URL. A
// web worker's own URL has no project in it, so this worker records the
// project of each web worker a frame starts, in Cache storage. The record
// survives when the browser stops and restarts this worker.
const PREFIX = "/__caliper/p/"
const PROJECT = /^\/__caliper\/p\/([0-9a-f]{12})\//
const CHROME = /^\/__caliper\/p\/[0-9a-f]{12}\/(?:.*\/)?__caliper\/$/
const NULL_BODY = new Set([101, 204, 205, 304])
const STORE = "caliper-clients"
/** @type {Map<string, string | null>} */
const known = new Map()

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", event => event.waitUntil(Promise.all([self.clients.claim(), forgetGone()])))

/** @param {string} url */
const idOf = url => new URL(url).pathname.match(PROJECT)?.[1] ?? null
/** @param {string} clientId */
const key = clientId => `/__caliper/clients/${encodeURIComponent(clientId)}`

/** @param {string} clientId @param {string} id */
async function remember(clientId, id) {
  known.set(clientId, id)
  await (await caches.open(STORE)).put(key(clientId), new Response(id))
}

/** Drop the records of web workers that no longer run. */
async function forgetGone() {
  const store = await caches.open(STORE)
  const live = new Set((await self.clients.matchAll({ type: "all", includeUncontrolled: true })).map(client => key(client.id)))
  for (const request of await store.keys()) if (!live.has(new URL(request.url).pathname)) await store.delete(request)
}

/**
 * The project a client belongs to, or null for the chrome and pages outside any project.
 *
 * @param {string} clientId
 */
async function projectOf(clientId) {
  if (!clientId) return null
  if (known.has(clientId)) return known.get(clientId) ?? null
  const client = await self.clients.get(clientId)
  /** @type {string | null} */
  let id = null
  if (client) {
    // The chrome's own requests go to the Caliper app, not to the project.
    id = CHROME.test(new URL(client.url).pathname) ? null : idOf(client.url)
    if (id === null && !CHROME.test(new URL(client.url).pathname)) id = await (await (await caches.open(STORE)).match(key(clientId)))?.text() ?? null
  } else {
    id = await (await (await caches.open(STORE)).match(key(clientId)))?.text() ?? null
  }
  known.set(clientId, id)
  return id
}

self.addEventListener("fetch", event => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith(PREFIX)) return
  if (request.mode === "navigate") {
    // A frame that follows a plain link, such as <a href="/settings">, keeps its project.
    const id = request.destination === "iframe" && request.referrer ? idOf(request.referrer) : null
    if (id) event.respondWith(Response.redirect(`${PREFIX}${id}${url.pathname}${url.search}`, 302))
    return
  }
  event.respondWith(route(event, request, url))
})

/**
 * @param {FetchEvent} event @param {Request} request @param {URL} url
 * @returns {Promise<Response>}
 */
async function route(event, request, url) {
  const id = await projectOf(event.clientId)
  if (id === null) return fetch(request)
  const worker = request.destination === "worker" || request.destination === "sharedworker"
  if (worker && event.resultingClientId) await remember(event.resultingClientId, id)
  /** @type {RequestInit} */
  const init = { method: request.method, headers: request.headers, credentials: request.credentials, signal: request.signal }
  if (request.cache !== "only-if-cached") init.cache = request.cache
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer()
  const response = await fetch(`${PREFIX}${id}${url.pathname}${url.search}`, init)
  return new Response(NULL_BODY.has(response.status) ? null : response.body, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  })
}
