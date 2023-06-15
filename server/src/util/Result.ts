export type Result<T, E> = [T] | [T | null, E]
export function Ok<T, E> (t: T): Result<T, E> { return [t] }
export function Err<T, E> (e: E, t: T | null = null): Result<T, E> { return [t, e] }
export function isOk<T, E> (result: Result<T, E>): result is [T] { return result.length === 1 }
export function isErr<T, E> (result: Result<T, E>): result is [T | null, E] { return result.length === 2 }
export function unwrapResult<T> (result: [T]): T { return result[0] }
