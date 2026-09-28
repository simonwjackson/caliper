import type { within, waitFor } from "@testing-library/dom"
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers"
import type { Assertion, AsymmetricMatcherInterface, AsymmetricMatchersContaining } from "@vitest/expect"

/** Synchronous library matchers only. No runner, mocks, snapshots or promise assertions. */
export interface CheckAssertion extends Pick<Assertion,
  | "toBe" | "toEqual" | "toStrictEqual" | "toMatch" | "toMatchObject"
  | "toBeDefined" | "toBeUndefined" | "toBeNull" | "toBeTruthy" | "toBeFalsy"
  | "toBeNaN" | "toBeTypeOf" | "toBeInstanceOf" | "toBeCloseTo"
  | "toBeGreaterThan" | "toBeGreaterThanOrEqual" | "toBeLessThan" | "toBeLessThanOrEqual"
  | "toContain" | "toContainEqual" | "toHaveLength" | "toHaveProperty"
  | "toThrow" | "toThrowError" | "toSatisfy" | "toBeOneOf"
>, TestingLibraryMatchers<AsymmetricMatcherInterface, void> {
  readonly not: CheckAssertion
}

/** The standalone assertion plugins, not Vitest's runner-owned expect API. */
export interface CheckExpect extends AsymmetricMatchersContaining {
  (actual: unknown, message?: string): CheckAssertion
  anything(): AsymmetricMatcherInterface
  any(constructor: unknown): AsymmetricMatcherInterface
  readonly not: AsymmetricMatchersContaining
}

export interface CheckInput {
  /** Browser-backed actionability checks apply. Re-query after a re-render. */
  click(element: Element): Promise<void>
  /** Focus this element and type. Detached targets and redirected focus fail. */
  type(element: Element, text: string): Promise<void>
  /** Send one Playwright key expression to this element. */
  press(element: Element, key: string): Promise<void>
}

export interface CheckContext {
  /** Testing Library queries scoped to the product's #caliper-host. */
  readonly canvas: ReturnType<typeof within>
  /** Use a product portal root to query beyond the default canvas. */
  readonly within: typeof within
  readonly input: CheckInput
  readonly expect: CheckExpect
  /** Re-query inside the callback. This does not extend the check deadline. */
  readonly waitFor: typeof waitFor
}

export type StateCheck = (context: CheckContext) => void | Promise<void>

/** State export → stable, nonblank check name → inline callback. Discovery validates names. */
export type StateChecks = Readonly<Record<string, Readonly<Record<string, StateCheck>>>>
