// @ts-check
// The project list page: what it draws for each state of its connection to the app.
import { describe, expect, test } from "bun:test"
import { homePage, homeView } from "../src/central/home.js"

/** @param {string} name @param {"Ready" | "Silent"} [status] @returns {import("../src/central/server.js").ProjectView} */
const project = (name, status = "Ready") => ({
  id: name, name, root: `/tmp/${name}`, url: "http://127.0.0.1:5173/", base: "/", chrome: `/__caliper/p/${name}/__caliper/`, protocol: 3, status,
  ...(status === "Ready" ? {} : { problem: "its dev server is not answering" }),
})

describe("homeView", () => {
  test("before the first list, the slot looks and the recipe waits", () => {
    expect(homeView({ _tag: "Connecting" })).toMatchObject({ slot: "Looking", recipe: false, retry: false, stale: false })
  })

  test("with no project, the slot looks and the recipe shows", () => {
    expect(homeView({ _tag: "Live", projects: [] })).toMatchObject({ slot: "Looking", recipe: true, retry: false })
  })

  test("with projects, only the rows show; a screen reader hears the count", () => {
    expect(homeView({ _tag: "Live", projects: [project("a")] })).toMatchObject({ slot: "None", recipe: false, said: "1 project." })
    expect(homeView({ _tag: "Live", projects: [project("a"), project("b", "Silent")] }).said).toBe("2 projects, 1 cannot open.")
  })

  test("a lost app keeps the last rows, stale, with the retry line", () => {
    expect(homeView({ _tag: "Lost", projects: [project("a")] })).toMatchObject({ slot: "None", retry: true, stale: true, recipe: false })
    expect(homeView({ _tag: "Lost", projects: [] })).toMatchObject({ slot: "Still", retry: true, stale: false })
  })
})

test("the page paints the connecting state first and ships the same view function", () => {
  const html = homePage({ themeColor: "#121316" })
  expect(html).toContain('data-state="Connecting" data-slot="Looking"')
  expect(html).toMatch(/data-cal="home-recipe" hidden>/)
  expect(html).toContain("function homeView(state)")
})
