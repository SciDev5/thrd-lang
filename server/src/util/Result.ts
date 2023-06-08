export type Result<T, E> = [T] | [T | null, E]
export function Ok<T, E> (t: T): Result<T, E> { return [t] }
export function Err<T, E> (e: E, t: T | null = null): Result<T, E> { return [t, e] }
