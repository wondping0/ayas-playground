/**
 * Process-wide singletons.
 *
 * A plain module-level `let` is not one. Next.js compiles route handlers into
 * separate module registries — in development it recompiles them on demand —
 * so two routes importing the same module can each get their own copy of it.
 * For the in-memory store that means registering a user in one route and
 * failing to find them in the next, which is exactly the bug this file exists
 * to prevent.
 *
 * `globalThis` is shared across those registries, so it is where anything that
 * must be one-per-process lives.
 */

const KEY = Symbol.for('ayas-playground.singletons')

interface Registry {
  [KEY]?: Map<string, unknown>
}

function registry(): Map<string, unknown> {
  const host = globalThis as Registry
  host[KEY] ??= new Map<string, unknown>()
  return host[KEY]
}

export function singleton<T>(name: string, create: () => T): T {
  const store = registry()
  if (!store.has(name)) store.set(name, create())
  return store.get(name) as T
}

/** Replace an instance. Tests and scripts only. */
export function setSingleton(name: string, value: unknown): void {
  if (value === null || value === undefined) registry().delete(name)
  else registry().set(name, value)
}

export function peekSingleton<T>(name: string): T | undefined {
  return registry().get(name) as T | undefined
}
