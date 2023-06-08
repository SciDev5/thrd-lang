export function THROW (e: Error): never {
  throw e
}

export function IMPOSSIBLE (): never {
  throw new Error('This branch should not be possible')
}
