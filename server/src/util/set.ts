export function setXOR<T> (a: Set<T>, b: Set<T>): Set<T> {
  const xor = new Set<T>()
  for (const elt of setOr(a, b)) {
    if (a.has(elt) !== b.has(elt)) {
      xor.add(elt)
    }
  }
  return xor
}
export function setAnd<T> (a: Set<T>, b: Set<T>): Set<T> {
  const and = new Set<T>()
  for (const elt of setOr(a, b)) {
    if (a.has(elt) && b.has(elt)) {
      and.add(elt)
    }
  }
  return and
}
export function setOr<T> (a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a, ...b])
}
export function setSubtract<T> (a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set(a)
  for (const elt of b) {
    out.delete(elt)
  }
  return out
}
