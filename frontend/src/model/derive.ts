import { createMemo, getOwner, runWithOwner, type Accessor } from 'solid-js'

type DerivedFields<F extends Record<string, () => unknown>> = { [K in keyof F]: ReturnType<F[K]> }

export function withDerived<T extends object, F extends Record<string, () => unknown>>(
  data: T,
  fields: F,
  equals: Partial<{ [K in keyof F]: (left: ReturnType<F[K]>, right: ReturnType<F[K]>) => boolean }> = {},
): T & DerivedFields<F> {
  const owner = getOwner()
  for (const key of Object.keys(fields) as (keyof F)[]) {
    let read: Accessor<unknown> | undefined
    Object.defineProperty(data, key, {
      enumerable: false,
      configurable: true,
      get() {
        const equal = equals[key] as ((left: unknown, right: unknown) => boolean) | undefined
        read ??= runWithOwner(owner, () => createMemo(fields[key], undefined, { equals: equal }))!
        return read()
      },
    })
  }
  return data as T & DerivedFields<F>
}
