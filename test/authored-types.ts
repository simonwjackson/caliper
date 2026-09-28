import type { StateChecks } from "@simonwjackson/caliper/checks"

export const checks = {
  default: {
    async "supports scoped queries and synchronous assertions"({ canvas, within, input, expect, waitFor }) {
      const button = canvas.getByRole("button", { name: "Retry" })
      await input.click(button)
      await input.type(canvas.getByLabelText("Search"), "library")
      await input.press(button, "Enter")
      within(document.body).getByText("Portal")
      expect(button).toBeVisible()
      expect(button).not.toBeVisible()
      expect(button).toHaveAccessibleName(/Retry/)
      expect(button).toHaveFocus()
      expect(1).toBe(1)
      expect({ state: "ready" }).toEqual({ state: "ready" })
      await waitFor(() => expect(canvas.getByRole("heading")).toBeVisible())
      // @ts-expect-error Unknown matcher.
      expect(button).toBeVisble()
      // @ts-expect-error Visibility has no arguments.
      expect(button).toBeVisible("yes")
      // @ts-expect-error Accessible names must be text or regular expressions.
      expect(button).toHaveAccessibleName(42)
      // @ts-expect-error Input accepts elements, not selectors.
      await input.click("button")
      // @ts-expect-error Type needs text.
      await input.type(button, 42)
      // @ts-expect-error Press needs one key expression.
      await input.press(button)
      // @ts-expect-error No arbitrary driver operations.
      await input.goto("https://example.com")
      // @ts-expect-error No Vitest runner polling.
      expect.poll(() => button)
      // @ts-expect-error No Vitest runner soft assertions.
      expect.soft(button)
      // @ts-expect-error No runner assertion counts.
      expect.assertions(1)
      // @ts-expect-error No runner snapshots.
      expect(button).toMatchSnapshot()
      // @ts-expect-error No unsupported promise assertions.
      expect(Promise.resolve(button)).resolves.toBe(button)
      // @ts-expect-error No custom runtime matcher registration.
      expect.extend({})
    },
  },
  // State names are checked by discovery, not a second TypeScript state list.
  TakeOnly: { "can return normally"() {} },
} satisfies StateChecks

export const invalidChecks = {
  default: {
    // @ts-expect-error A callback is required.
    invalid: 42,
  },
} satisfies StateChecks
