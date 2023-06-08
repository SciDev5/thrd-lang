import { THROW } from './THROW'

export class Stack<T> {
  private readonly contents: T[] = []

  push (v: T): void {
    this.contents.push(v)
  }

  popNullable (): T | null {
    return this.contents.pop() ?? null
  }

  pop (): T {
    return this.popNullable() ?? THROW(new TypeError('Stack underflow'))
  }

  get topNullable (): T | null {
    return this.contents[this.contents.length - 1] ?? null
  }

  get top (): T {
    return this.topNullable ?? THROW(new TypeError('Empty stack has no top frame'))
  }
}
