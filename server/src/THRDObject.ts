import { type Diagnostic } from 'vscode-languageserver'
import { TokenType, type THRDToken, PrimitiveValueType, SurroundingPairType, Side } from './THRDDocument'

enum THRDValueType {
  String,
  Boolean,
  Int,
  Float,
  Dict,
  Arr,
  Tuple,
}

export type THRDData = {
  type: THRDValueType.String
  value: string
} | {
  type: THRDValueType.Boolean
  value: boolean
} | {
  type: THRDValueType.Float | THRDValueType.Int
  value: number
} | {
  type: THRDValueType.Dict
  value: Record<string, THRDData>
} | {
  type: THRDValueType.Arr | THRDValueType.Tuple
  value: THRDData[]
}
export enum THRDTypeType {
  String,
  Primitive,
  Array,
  Dict,
  Tuple,
}

export type THRDType = {
  type: THRDTypeType.String
} | {
  type: THRDTypeType.Primitive
  which: PrimitiveValueType
} | {
  type: THRDTypeType.Dict
  contents: Record<string, THRDType>
} | {
  type: THRDTypeType.Array
  contents: THRDType
} | {
  type: THRDTypeType.Tuple
  contents: THRDType[]
}

class TokenIterator implements Iterator<THRDToken, undefined>, Iterable<THRDToken> {
  readonly problems = new Problems(this)

  readonly tokenLines: THRDToken[][]

  constructor (
    readonly lines: string[],
    tokenLines: THRDToken[][],
  ) {
    this.tokenLines = tokenLines.map(line => line.filter(token => {
      if (token.isInvalid) {
        this.problems.tokenInvalid(token)
        return false
      } else if (token.isIgnored) {
        return false
      } else {
        return true
      }
    }))
    while (this.tokenLines[this.line] !== undefined && this.i >= this.tokenLines[this.line].length) {
      this.line++
    }
    this._last = tokenLines[this.line][0]
  }

  private _last: THRDToken
  private line = 0
  private i = 0
  next (...args: [] | [undefined]): IteratorResult<THRDToken, undefined> {
    if (this.line >= this.tokenLines.length) {
      return {
        done: true,
        value: undefined,
      }
    }
    const value = this.tokenLines[this.line][this.i]
    this._last = value
    this.i++
    while (this.i >= this.tokenLines[this.line].length) {
      this.i = 0
      this.line++
    }
    return {
      value,
    }
  }

  peek (): THRDToken | null {
    return this.tokenLines[this.line][this.i] ?? null
  }

  peekLast (): THRDToken {
    return this._last
  }

  rewind (): void {
    this.i--
    if (this.i < 0 || this.tokenLines[this.line].length === 0) {
      this.line--
      this.i = this.tokenLines[this.line].length - 1
    }
  }

  [Symbol.iterator] (): Iterator<THRDToken, undefined> {
    return this
  }
}

enum SyntaxErrorType {
  UnexpectedEndOfString,
}
class Problems {
  constructor (private readonly tokenIterator: TokenIterator) {}
  private unexpectedEnd = false
  endedUnexpectedly (): void {
    this.unexpectedEnd = true
  }

  private readonly typeMismatches = new Set<{ at: THRDToken }>()
  typeMismatch (at: THRDToken = this.tokenIterator.peekLast()): void {
    this.typeMismatches.add({ at })
  }

  private readonly tokenInvalids = new Set<THRDToken>()
  tokenInvalid (at: THRDToken): void {
    this.tokenInvalids.add(at)
  }

  private readonly syntaxErrors = new Set<{ at: THRDToken, which: SyntaxErrorType }>()
  syntaxError (
    which: SyntaxErrorType,
    at: THRDToken = this.tokenIterator.peekLast(),
  ): void {
    this.syntaxErrors.add({ which, at })
  }

  toDiagnostics (): Diagnostic[] {
    const diagnostics: Diagnostic[] = []

    if (this.unexpectedEnd) {
      const line = this.tokenIterator.lines.length - 1
      const character = this.tokenIterator.lines[line].length - 1
      diagnostics.push({
        message: 'Unexpected EOF',
        range: {
          start: { line, character },
          end: { line, character },
        },
      })
    }

    const syntaxErrorMessages: { [k in SyntaxErrorType]: string } = {
      [SyntaxErrorType.UnexpectedEndOfString]: 'Unexpected end of string',
    }
    for (const error of this.syntaxErrors) {
      diagnostics.push({
        message: syntaxErrorMessages[error.which],
        range: error.at.range,
      })
    }

    for (const tokenInvalid of this.tokenInvalids) {
      diagnostics.push({
        message: 'Token is invalid',
        range: tokenInvalid.range,
      })
    }

    for (const typeMismatch of this.typeMismatches) {
      diagnostics.push({
        message: 'Type mismatch',
        range: typeMismatch.at.range,
      })
    }

    return diagnostics
  }
}

export function parse (tokenLines: THRDToken[][], lines: string[], rootType: THRDType): [THRDData, Diagnostic[]] {
  const tokenIterator = new TokenIterator(lines, tokenLines)

  return [parseValue(tokenIterator) ?? { type: THRDValueType.Int, value: -1 }, tokenIterator.problems.toDiagnostics()]
}

function parseValue (tokenIterator: TokenIterator): THRDData | null {
  const token = tokenIterator.next().value ?? null
  if (token === null) {
    tokenIterator.problems.endedUnexpectedly()
    return null
  }

  switch (token.data.type) {
    case TokenType.PrimitiveData: {
      switch (token.data.data) {
        case PrimitiveValueType.Boolean:
          return { type: THRDValueType.Boolean, value: (token.text === 'true') }
        case PrimitiveValueType.Int:
          return { type: THRDValueType.Int, value: parseInt(token.text) }
        case PrimitiveValueType.Float:
          return { type: THRDValueType.Float, value: parseFloat(token.text) }
      }
      break
    }
    case TokenType.SurroundingPair: {
      switch (token.data.pair) {
        case SurroundingPairType.String: {
          const str: string[] = []
          let lastLineNum = token.range.start.line
          for (const strToken of tokenIterator) {
            const currentLineNum = strToken.range.start.line
            if (strToken.data.type === TokenType.StringData) {
              if (currentLineNum > lastLineNum) {
                str.push('\n'.repeat(currentLineNum - lastLineNum))
                lastLineNum = currentLineNum
              }
              str.push(strToken.text) // TODO: handle escapes
            } else if (strToken.data.type === TokenType.SurroundingPair && strToken.data.side === Side.End && strToken.data.pair === SurroundingPairType.String) {
              // end of string sequence
              if (currentLineNum > lastLineNum) {
                str.push('\n'.repeat(currentLineNum - lastLineNum))
              }
              break
            } else {
              // unexpected non-string character
              tokenIterator.problems.syntaxError(SyntaxErrorType.UnexpectedEndOfString)
              tokenIterator.rewind()
              break
            }
          }
          break
        }
        default: {
          // TODO
        }
      }
      break
    }
  }
  return null
}
