/** Agent callers await both local disk results and remote plugin calls. */
export type AwaitableHost<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : T[K]
}

export type AgentStore = AwaitableHost<import("../takes/store.js").TakeStore> & {
  /** One overview per async read scope. Local stores need no batching. */
  batch?: <T>(read: () => Promise<T>) => Promise<T>
  /** Remote calls within a run stop waiting when Stop aborts the run. */
  withSignal?: <T>(signal: AbortSignal, run: () => Promise<T>) => Promise<T>
}
export type AgentMarks = AwaitableHost<import("../takes/marks.js").MarkStore>
export type AgentWorkspaces = AwaitableHost<import("../takes/workspaces.js").WorkspaceStore>
export type AgentIntegration = AwaitableHost<ReturnType<typeof import("../takes/integration.js").createIntegrationReview>>
