// @ts-check
// The project list page: one view per state of its connection to the app.
import { describe, expect, test } from "bun:test"
import { homePage, homeView } from "../src/central/home.js"

/** @param {string} name @param {"Ready" | "Silent"} [status] @returns {import("../src/central/server.js").ProjectView} */
const project = (name, status = "Ready") => ({
  id: name, name, root: `/tmp/${name}`, url: "http://127.0.0.1:5173/", base: "/", chrome: `/__caliper/p/${name}/__caliper/`, protocol: 3, status,
  ...(status === "Ready" ? {} : { problem: "its dev server is not answering" }),
})

describe("homeView", () => {
  test("before the first list, it says it is connecting and shows no steps", () => {
    expect(homeView({ _tag: "Connecting" })).toMatchObject({ tone: "running", status: "Connecting to the Caliper app", steps: false, stale: false })
  })

  test("with no project, it watches, keeps the empty slot and shows the steps", () => {
    const view = homeView({ _tag: "Live", projects: [] })
    expect(view).toMatchObject({ tone: "running", status: "Watching for dev servers", steps: true, stale: false })
    expect(view.slot?.title).toBe("No project is running")
  })

  test("with projects, it counts them and drops the slot", () => {
    expect(homeView({ _tag: "Live", projects: [project("a")] })).toMatchObject({ tone: "good", status: "1 project running", slot: null, steps: false })
    expect(homeView({ _tag: "Live", projects: [project("a"), project("b")] }).status).toBe("2 projects running")
  })

  test("a project that cannot open turns the status to a warning and names the count", () => {
    expect(homeView({ _tag: "Live", projects: [project("a"), project("b", "Silent")] })).toMatchObject({ tone: "warn", status: "2 projects running, 1 cannot open" })
  })

  test("a lost connection keeps the last list, marked stale", () => {
    expect(homeView({ _tag: "Lost", projects: [project("a")] })).toMatchObject({ tone: "bad", slot: null, steps: false, stale: true })
    const empty = homeView({ _tag: "Lost", projects: [] })
    expect(empty).toMatchObject({ tone: "bad", steps: false, stale: false })
    expect(empty.slot?.title).toBe("No project list")
  })
})

test("the page paints the connecting state first and ships the same view function", () => {
  const html = homePage({ themeColor: "#121316" })
  expect(html).toContain('data-state="Connecting"')
  expect(html).toContain("Connecting to the Caliper app")
  expect(html).toMatch(/data-cal="home-steps"[^>]* hidden>/)
  expect(html).toContain("function homeView(state)")
})
