import { DiagnosticSeverity, type Diagnostic, type Range } from 'vscode-languageserver'
import { Stack } from '../util/Stack'
import { IMPOSSIBLE } from '../util/THROW'
import { combineRanges } from '../util/range'
import { PrimitiveValueType, SeparatorType, Side, SingleValueType, TokenType, BlockType, type TToken } from './TToken'
import { THRDValueType, type THRDData } from '../THRDObject'

class ChunkifyDiagnostic {
  constructor (
    readonly diagnostic: Diagnostic,
    readonly errorTolerable: boolean,
  ) { }
}

class UnexpectedEndOfInputChunkifyDiagnostic extends ChunkifyDiagnostic {
  constructor (
    tokens: TToken[],
  ) {
    const endPosition = tokens[tokens.length - 1]?.range?.end ?? { line: 0, character: 0 }
    super({
      message: 'Unexpected end of input',
      severity: DiagnosticSeverity.Error,
      range: {
        start: endPosition,
        end: endPosition,
      },
    }, false)
  }
}
class BracketMismatchDiagnostic extends ChunkifyDiagnostic {
  constructor (
    openToken: TToken,
    closeToken: TToken,
  ) {
    const message = `Brackets mismatched! ${openToken.text} ... ${closeToken.text}`
    super({
      message,
      range: closeToken.range,
      severity: DiagnosticSeverity.Error,
      relatedInformation: [
        {
          location: {
            uri: '.',
            range: openToken.range,
          },
          message,
        },
      ],
    }, false)
  }
}
class InvalidTokenDiagnostic extends ChunkifyDiagnostic {
  constructor (
    token: TToken,
  ) {
    super({
      message: 'Invalid token',
      severity: DiagnosticSeverity.Error,
      range: token.range,
    }, true)
  }
}

export enum TChunkType {
  Block,
  Key,
  Value,
  /** These are the commas */
  ExpressionSeparator,
}

type TChunk = ({
  type: TChunkType.Block
  enumKey?: string
  kind: BlockType
  children: TChunk[]
} | {
  type: TChunkType.Key
  key: string
} | {
  type: TChunkType.Value
  data: TValueChunkData
} | {
  type: TChunkType.ExpressionSeparator
  weak: boolean
}) & { range: Range }

type TValueChunkData = (
  [SingleValueType.Boolean, boolean]
  | [SingleValueType.Float | SingleValueType.Int, number]
  | [SingleValueType.String, string]
)

interface TBlockChunk {
  type: TChunkType.Block
  enumKey?: string
  kind?: BlockType
  children: TChunk[]
  range: Range
  token?: TToken
}

function chunkify (tokens: TToken[], blockRangeFull = true): { chunks: TChunk[], allChunks: TChunk[], syntaxDiagnostics: ChunkifyDiagnostic[] } {
  const allChunks: TChunk[] = []
  const globalBlock: TBlockChunk = {
    type: TChunkType.Block,
    children: [],
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  }
  const syntaxDiagnostics: ChunkifyDiagnostic[] = []
  function pushChunk (chunk: TChunk): void {
    chunkStack.top.children.push(chunk)
    allChunks.push(chunk)
  }
  const chunkStack = new Stack<TBlockChunk>()
  chunkStack.push(globalBlock)

  let enumKey: TToken | undefined

  let canInsertWeakSeparator = false

  for (let i = 0; ;) {
    const token = tokens[i++] ?? null

    if (token === null) {
      // end of input
      break
    }

    switch (token.data.type) {
      case TokenType.Invalid:
        syntaxDiagnostics.push(new InvalidTokenDiagnostic(token))
        break
      case TokenType.Ignored:
        // ignore, obviously
        break
      case TokenType.Newline:
        if (canInsertWeakSeparator) {
          pushChunk({ type: TChunkType.ExpressionSeparator, range: token.range, weak: true })
          canInsertWeakSeparator = false
        }
        break
      case TokenType.Separator:
        switch (token.data.separator) {
          case SeparatorType.List:
            pushChunk({ type: TChunkType.ExpressionSeparator, range: token.range, weak: false })
            canInsertWeakSeparator = false
            break
          case SeparatorType.KeyValue:
            // Should be absorbed by `PropertyKey` token parsing
            IMPOSSIBLE()
        }
        break
      case TokenType.PrimitiveData: {
        let data: TValueChunkData
        switch (token.data.data) {
          case PrimitiveValueType.Boolean:
            data = [SingleValueType.Boolean, token.text === 'true']
            break
          case PrimitiveValueType.Int:
            data = [SingleValueType.Int, parseInt(token.text)]
            break
          case PrimitiveValueType.Float:
            data = [SingleValueType.Float, parseFloat(token.text)]
            break
        }
        pushChunk({ type: TChunkType.Value, data, range: token.range })
        canInsertWeakSeparator = true
      }
        break
      case TokenType.PropertyKey: {
        const keyValueSeparatorToken = tokens[i++] // the `:`
        pushChunk({ type: TChunkType.Key, key: token.text, range: combineRanges(token.range, keyValueSeparatorToken.range) })
        canInsertWeakSeparator = false
      }
        break
      case TokenType.StringBoundary: {
        if (token.data.side === Side.End) {
          // Should be absorbed by `StringBoundary/Begin`
          IMPOSSIBLE()
        }

        const involvedTokens: TToken[] = []
        let builtString = ''
        let stillInString = true
        while (stillInString) {
          const token = tokens[i++] ?? null
          if (token === null) {
            // early end of input
            syntaxDiagnostics.push(new UnexpectedEndOfInputChunkifyDiagnostic(tokens))
            return { chunks: globalBlock.children, allChunks, syntaxDiagnostics }
          }
          involvedTokens.push(token)
          switch (token.data.type) {
            case TokenType.StringData: {
              const v = token.text.replace(/[\r\n]/g, '')
              if (token.data.isEscapeSequence ?? false) {
                builtString += ({
                  n: '\n',
                  r: '\r',
                  '\\': '\\',
                  EMPTY: '',
                })[v[1] ?? 'EMPTY'] ?? (({
                  x: () => String.fromCharCode(parseInt(v.substring(2, 4), 16)),
                  u: () => String.fromCharCode(parseInt(v.substring(2, 6), 16)),
                } satisfies Record<string, () => string>)[v[1]] ?? IMPOSSIBLE())()
              } else {
                builtString += v
              }
            } break
            case TokenType.Newline:
              builtString += '\n'
              break
            case TokenType.StringBoundary:
              stillInString = false
              break
            case TokenType.Invalid:
              builtString += token.text[0]
              stillInString = false
              break
            default:
              // Cannot happen in the grammar
              IMPOSSIBLE()
          }
        }
        pushChunk({ type: TChunkType.Value, data: [SingleValueType.String, builtString], range: combineRanges(token.range, ...involvedTokens.map(v => v.range)) })
        canInsertWeakSeparator = true
      }
        break
      case TokenType.StringData:
        // Should be absorbed by `StringBoundary`
        IMPOSSIBLE()
        break
      case TokenType.EnumKey:
        enumKey = token
        canInsertWeakSeparator = false
        break
      case TokenType.BlockBoundary:
        switch (token.data.side) {
          case Side.Begin: {
            const chunk: TChunk & TBlockChunk = (
              enumKey !== undefined
                ? { type: TChunkType.Block, enumKey: enumKey.text, kind: token.data.kind, range: combineRanges(enumKey.range, token.range), children: [], token }
                : { type: TChunkType.Block, kind: token.data.kind, range: token.range, children: [], token }
            )
            enumKey = undefined
            pushChunk(chunk)
            canInsertWeakSeparator = false
            chunkStack.push(chunk)
          }
            break
          case Side.End: {
            let nFramesToPop = 1
            if (chunkStack.top.kind !== token.data.kind) {
              // stack top will always have token when `BlockBoundary/End` because TextMate only
              // captures more beginnings than ends never the other way around

              const openToken = chunkStack.top.token ?? IMPOSSIBLE()
              /** Number of layers of blocks skipped in the mismatch */
              const missingFrames = openToken.depth - token.depth
              nFramesToPop += missingFrames

              syntaxDiagnostics.push(new BracketMismatchDiagnostic(openToken, token))
            }

            for (let n = 0; n < nFramesToPop; n++) {
              if (blockRangeFull) {
                chunkStack.top.range = combineRanges(chunkStack.top.range, token.range)
              }
              const frame = chunkStack.pop()
              delete frame.token
            }
            canInsertWeakSeparator = true
          }
            break
        }
        break
    }
  }

  if (chunkStack.top !== globalBlock) {
    // not all blocks were closed
    syntaxDiagnostics.push(new UnexpectedEndOfInputChunkifyDiagnostic(tokens))
  }

  return { chunks: globalBlock.children, allChunks, syntaxDiagnostics }
}

class ParseDiagnostic {
  constructor (
    readonly diagnostic: Diagnostic,
  ) {}
}

enum IllegalChunkKind {
  ExpectedSeparator,
  ExpectedKey,
  ExpectedValue,
  IllegalKeyInListLike,
}
class InvalidIllegalChunkDiagnostic extends ParseDiagnostic {
  constructor (
    chunk: TChunk,
    kind: IllegalChunkKind,
  ) {
    super({
      message: ({
        [IllegalChunkKind.ExpectedKey]: 'Expected property key.',
        [IllegalChunkKind.ExpectedValue]: 'Expected value.',
        [IllegalChunkKind.ExpectedSeparator]: 'Expected ",".',
        [IllegalChunkKind.IllegalKeyInListLike]: 'Arrays and tuples do not accept property keys.',
      } satisfies { [key in IllegalChunkKind]: string })[kind],
      range: chunk.range,
    })
  }
}
class UnexpectedEndOfInputParsingDiagnostic extends ParseDiagnostic {
  constructor (
    lastChunk: TChunk | undefined,
    expectedKeyNotValue: boolean,
  ) {
    const pos = lastChunk?.range.end ?? { line: 0, character: 0 }
    super({
      message: `Unexpected end of input. Expected ${expectedKeyNotValue ? 'property key' : 'value'}.`,
      range: { start: pos, end: pos },
    })
  }
}

function parseChunkTopLevel (chunk: TChunk): { data?: THRDData, parseDiagnostics: ParseDiagnostic[] } {
  const parseDiagnostics: ParseDiagnostic[] = []
  switch (chunk.type) {
    case TChunkType.Block:
      return { data: parseChunksBlock(chunk, parseDiagnostics), parseDiagnostics }
    case TChunkType.Value:
      return { data: parseChunksValue(chunk.data), parseDiagnostics }
    case TChunkType.Key:
    case TChunkType.ExpressionSeparator:
      IMPOSSIBLE()
  }
}

function parseChunksListLike (chunks: TChunk[], diagnostics: ParseDiagnostic[]): THRDData[] {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingValue = true
  const data: THRDData[] = []
  for (const chunk of chunks) {
    switch (chunk?.type) {
      case TChunkType.Key:
        diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.IllegalKeyInListLike))
        break
      case TChunkType.Block:
        if (!expectingValue) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedSeparator))
          // No break, this is recoverable
        }

        data.push(parseChunksBlock(chunk, diagnostics))

        expectingValue = false
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.Value:
        if (!expectingValue) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedSeparator))
          // No break, this is recoverable
        }

        data.push(parseChunksValue(chunk.data))

        expectingValue = false
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.ExpressionSeparator:
        if (justHadWeakSeparator && justHadSeparator) {
          justHadWeakSeparator = chunk.weak
          break
        }
        justHadWeakSeparator = chunk.weak

        if (!expectingSeparator) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedValue))
          break
        }
        expectingValue = true
        expectingSeparator = false
        justHadSeparator = true
        break
    }
  }
  if (!expectingSeparator && !justHadSeparator) {
    diagnostics.push(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return data
}

function parseChunksDictLike (chunks: TChunk[], diagnostics: ParseDiagnostic[]): Record<string, THRDData> {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingKey = true
  let expectingValueWithKey: string | null = null
  const data: Record<string, THRDData> = {}
  for (const chunk of chunks) {
    switch (chunk?.type) {
      case TChunkType.Key:
        if (!expectingKey) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, expectingSeparator ? IllegalChunkKind.ExpectedSeparator : IllegalChunkKind.ExpectedValue))

          if (expectingValueWithKey !== null) {
            break
          }
          if (expectingSeparator) {
            // No break, this is recoverable
          }
        }
        expectingKey = false
        expectingValueWithKey = chunk.key
        expectingSeparator = false
        justHadSeparator = false
        break
      case TChunkType.Block:
        if (expectingValueWithKey === null) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, expectingKey ? IllegalChunkKind.ExpectedKey : IllegalChunkKind.ExpectedSeparator))
          break // NEED key
        }

        data[expectingValueWithKey] = parseChunksBlock(chunk, diagnostics)

        expectingKey = false
        expectingValueWithKey = null
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.Value:
        if (expectingValueWithKey === null) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, expectingSeparator ? IllegalChunkKind.ExpectedSeparator : IllegalChunkKind.ExpectedKey))
          break // NEED key
        }

        data[expectingValueWithKey] = parseChunksValue(chunk.data)

        expectingKey = false
        expectingValueWithKey = null
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.ExpressionSeparator:
        if (justHadWeakSeparator && justHadSeparator) {
          justHadWeakSeparator = chunk.weak
          break
        }
        justHadWeakSeparator = chunk.weak

        if (!expectingSeparator) {
          diagnostics.push(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedValue))
          break
        }
        expectingKey = true
        expectingValueWithKey = null
        expectingSeparator = false
        justHadSeparator = true
        break
    }
  }
  if (!expectingSeparator && !justHadSeparator) {
    diagnostics.push(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return data
}

function parseChunksValue (data: TValueChunkData): THRDData {
  switch (data[0]) {
    case SingleValueType.Boolean:
      return { type: THRDValueType.Boolean, value: data[1] }
    case SingleValueType.Int:
      return { type: THRDValueType.Int, value: data[1] }
    case SingleValueType.Float:
      return { type: THRDValueType.Float, value: data[1] }
    case SingleValueType.String:
      return { type: THRDValueType.String, value: data[1] }
  }
}

function parseChunksBlock (chunk: { children: TChunk[], enumKey?: string, kind: BlockType, range: Range }, diagnostics: ParseDiagnostic[]): THRDData {
  switch (chunk.kind) {
    case BlockType.Dict:
      return { type: THRDValueType.Dict, value: parseChunksDictLike(chunk.children, diagnostics) }
    case BlockType.Arr:
      return { type: THRDValueType.Arr, value: parseChunksListLike(chunk.children, diagnostics) }
    case BlockType.Tuple:
      return { type: THRDValueType.Tuple, value: parseChunksListLike(chunk.children, diagnostics) }
  }
}

export { chunkify, parseChunkTopLevel }
