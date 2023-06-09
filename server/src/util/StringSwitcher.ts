export class StringSwitcherError extends Error {
  constructor (
    switcherText: string,
    switcherStartText: string,
    caseNames: Iterable<string>,
  ) {
    super(
      `Branch ${switcherText} not covered for ${switcherStartText}. options were: [${[...caseNames].join(', ')}]`,
    )
  }
}

export class StringSwitcher {
  private text: string
  constructor (
    private readonly startText: string,
  ) {
    this.text = startText
  }

  match (beginning: string): boolean {
    if (this.text.startsWith(beginning)) {
      this.text = this.text.substring(beginning.length)
      return true
    } else {
      return false
    }
  }

  switch<R = void>(cases: Record<string, () => R>, defaultCase: () => R = () => {
    throw new StringSwitcherError(
      this.text,
      this.startText,
      Object.keys(cases),
    )
  }): R {
    const keys = [...Object.keys(cases)]
    keys.sort((a, b) => b.length - a.length)

    for (const key of keys) {
      if (this.match(key)) {
        return cases[key]()
      }
    }
    return defaultCase()
  }

  get remaining (): string { return this.text }
}
