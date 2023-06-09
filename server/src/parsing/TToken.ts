import { type Range } from 'vscode-languageserver'
import * as vsctm from 'vscode-textmate'
import { type IToken } from 'vscode-textmate'
import { type Lines } from '../THRDDocument'
import { grammarPromise } from '../grammar'
import { StringSwitcher, StringSwitcherError } from '../util/StringSwitcher'

export enum Side {
  Begin,
  End,
}
export enum BlockType {
  Dict,
  Arr,
  Tuple,
}
export enum SeparatorType {
  KeyValue,
  List,
}
export enum PrimitiveValueType {
  Int,
  Float,
  Boolean,
}
export enum SingleValueType {
  Int,
  Float,
  Boolean,
  String,
}
export enum TokenType {
  PropertyKey,
  EnumKey,
  PrimitiveData,
  StringData,
  StringBoundary,
  BlockBoundary,
  Separator,
  Ignored,
  Invalid,
  Newline,
}
export type TokenData = ({
  type: TokenType.BlockBoundary
  kind: BlockType
  side: Side
} | {
  type: TokenType.StringBoundary
  side: Side
} | {
  type: TokenType.Separator
  separator: SeparatorType
} | {
  type: TokenType.PrimitiveData
  data: PrimitiveValueType
} | {
  type: TokenType.StringData
  isEscapeSequence?: boolean
} | {
  type: TokenType.Invalid
  unknown: boolean
} | {
  type: TokenType.PropertyKey | TokenType.EnumKey | TokenType.Newline | TokenType.Ignored
})

export class TToken {
  readonly scopes: string[]
  constructor (
    readonly lines: Lines,
    line: number,
    rawToken: IToken,
    readonly data: TokenData,
    readonly range: Range = {
      start: { line, character: rawToken.startIndex },
      end: { line, character: rawToken.endIndex },
    },
  ) {
    this.scopes = rawToken.scopes
  }

  get text (): string {
    return this.lines[this.range.start.line].substring(this.range.start.character, this.range.end.character)
  }

  get isTextWhitespace (): boolean {
    return /^\s*$/.test(this.text)
  }

  private static wouldBeWhitespace (lines: Lines, line: number, rawToken: IToken): boolean {
    return /^\s*$/.test(lines[line].substring(rawToken.startIndex, rawToken.endIndex))
  }

  get isInvalid (): boolean {
    return this.data.type === TokenType.Invalid
  }

  get isIgnored (): boolean {
    return this.data.type === TokenType.Ignored
  }

  get depth (): number {
    return this.scopes.filter(v => v.startsWith('meta.block.')).length
  }

  static newline (lines: Lines, line: number): TToken {
    return new TToken(lines, line, { startIndex: 0, endIndex: 0, scopes: [] }, { type: TokenType.Newline }, {
      start: { line, character: lines[line].length },
      end: { line: line + 1, character: 0 },
    })
  }

  static from (lines: Lines, line: number, rawToken: IToken): TToken {
    const scope = rawToken.scopes[rawToken.scopes.length - 1]

    const switcher = new StringSwitcher(scope)
    try {
      const data = switcher.switch<TokenData>({
        'support.class.enum.name.': () => ({ type: TokenType.EnumKey }),
        'variable.name.': () => ({ type: TokenType.PropertyKey }),
        'punctuation.separator.': () => ({
          type: TokenType.Separator,
          separator: switcher.switch({
            'keyValue.': () => SeparatorType.KeyValue,
            'list.': () => SeparatorType.List,
          }),
        }),
        'punctuation.block.': () => ({
          type: TokenType.BlockBoundary,
          // Begin must come first, because it comes first in the string
          side: switcher.switch({ 'begin.': () => Side.Begin, 'end.': () => Side.End }),
          kind: switcher.switch({ 'arr.': () => BlockType.Arr, 'dict.': () => BlockType.Dict, 'tuple.': () => BlockType.Tuple }),
        }),
        'punctuation.string.': () => ({
          type: TokenType.StringBoundary,
          side: switcher.switch({ 'begin.': () => Side.Begin, 'end.': () => Side.End }),
        }),
        'constant.': () => (switcher.match('character.escape.string.')
          ? {
              type: TokenType.StringData,
              isEscapeSequence: true,
            }
          : {
              type: TokenType.PrimitiveData,
              data: switcher.switch({
                'numeric.integer.': () => PrimitiveValueType.Int,
                'numeric.float.': () => PrimitiveValueType.Float,
                'language.boolean.': () => PrimitiveValueType.Boolean,
              }),
            }),
        'string.': () => ({
          type: TokenType.StringData,
        }),
        'comment.': () => ({
          type: TokenType.Ignored,
        }),
        'whitespace.': () => ({
          type: TokenType.Ignored,
        }),
        'invalid.illegal.': () => ({
          type: TokenType.Invalid,
          unknown: false,
        }),
      })

      return new TToken(
        lines,
        line,
        rawToken,
        data,
      )
    } catch (err) {
      if (err instanceof StringSwitcherError) {
        if (lines[line].trim().length === 0) {
          return new TToken(lines, line, rawToken, { type: TokenType.Ignored })
        }
        console.error(err)
        return new TToken(
          lines,
          line,
          rawToken,
          { type: TokenType.Invalid, unknown: true },
        )
      } else {
        throw err
      }
    }
  }

  static async lex (lines: Lines): Promise<TToken[]> {
    const grammar = await grammarPromise

    const outputTokens: TToken[] = []

    let ruleStackCurrent = vsctm.INITIAL
    for (let line = 0; line < lines.length; line++) {
      const { tokens, ruleStack } = grammar.tokenizeLine(lines[line], ruleStackCurrent)
      ruleStackCurrent = ruleStack

      for (const token of tokens) {
        outputTokens.push(TToken.from(lines, line, token))
      }
      outputTokens.push(TToken.newline(lines, line))
    }
    console.log(outputTokens)

    return outputTokens
  }
}
