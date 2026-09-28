// @ts-check
import { within, waitFor, expect } from "./libraries.js"

/** Loaded only by the automated runner, in the product document.
 * @param {{part:string,state:string,name:string,run:string,targetBinding:string,actionBinding:string}} request
 */
export async function runAuthoredCheck(request) {
  const host = document.getElementById("caliper-host")
  if (!host) throw new Error("The product frame has no host.")
  const target = Reflect.get(window, request.targetBinding)
  const action = Reflect.get(window, request.actionBinding)
  if (typeof target !== "function" || typeof action !== "function")
    throw new Error("The authored-check driver is unavailable.")
  let busy = false
  /** @param {'click'|'type'|'press'} operation @param {Element} element @param {string} [value] */
  const perform = async (operation, element, value) => {
    if (busy) throw new Error("Concurrent input is not supported. Await each input operation.")
    if (!(element instanceof Element) || element.ownerDocument !== document || !element.isConnected)
      throw new Error("The input target is detached or belongs to another document. Re-query it before sending input.")
    busy = true
    try {
      const handle = await target(element)
      if (typeof handle !== "string") throw new Error("Invalid input handle from the driver.")
      await action({ run: request.run, target: handle, operation, ...(value === undefined ? {} : { value }) })
    } finally {
      busy = false
    }
  }
  const module = await import(/* @vite-ignore */ request.part)
  const states = Object.getOwnPropertyDescriptor(module, "checks")?.value
  const checks = states && Object.getOwnPropertyDescriptor(states, request.state)?.value
  const callback = checks && Object.getOwnPropertyDescriptor(checks, request.name)?.value
  if (typeof callback !== "function")
    throw new Error(`The discovered check ${request.state}/${request.name} is not a function in the loaded part.`)
  await callback({
    canvas: within(host),
    within,
    expect,
    waitFor,
    input: {
      /** @param {Element} element */
      click: element => perform("click", element),
      /** @param {Element} element @param {string} text */
      type: (element, text) => perform("type", element, text),
      /** @param {Element} element @param {string} key */
      press: (element, key) => perform("press", element, key),
    },
  })
  if (busy) throw new Error("A check returned with input still running. Await every input operation.")
}
