import { DiagnosticSeverity, type Range } from 'vscode-languageserver'
import { DEBUG_CONSTANTS } from '../DEBUG_CONSTANTS'
import { Stack } from '../util/Stack'
import { IMPOSSIBLE } from '../util/THROW'
import { combineRanges } from '../util/range'
import { TDiagnostic, type DiagnosticTracker } from './DiagnosticTracker'
import { TDataType, stripPositionInfoFromData, type TDataWithPosition } from './TData'
import { BlockType, PrimitiveValueType, SeparatorType, Side, SingleValueType, TokenType, type TToken } from './TToken'

class UnexpectedEndOfInputChunkifyDiagnostic extends TDiagnostic {
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
    }, {
      canContinue: false,
    })
  }
}
class BracketMismatchDiagnostic extends TDiagnostic {
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
    }, {
      canContinue: false,
    })
  }
}
class InvalidTokenDiagnostic extends TDiagnostic {
  constructor (
    token: TToken,
  ) {
    super({
      message: 'Invalid token',
      severity: DiagnosticSeverity.Error,
      range: token.range,
    })
  }
}

export enum TChunkType {
  Block,
  Key,
  Value,
  /** These are the commas */
  ExpressionSeparator,
}

export type TChunk = ({
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

function chunkify (tokens: TToken[], diagnostics: DiagnosticTracker): { chunks: TChunk[], allChunks: TChunk[] } {
  const allChunks: TChunk[] = []
  const globalBlock: TBlockChunk = {
    type: TChunkType.Block,
    children: [],
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  }
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
        diagnostics.add(new InvalidTokenDiagnostic(token))
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
            diagnostics.add(new UnexpectedEndOfInputChunkifyDiagnostic(tokens))
            return { chunks: globalBlock.children, allChunks }
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

              diagnostics.add(new BracketMismatchDiagnostic(openToken, token))
            }

            for (let n = 0; n < nFramesToPop; n++) {
              if (!DEBUG_CONSTANTS.SHOW_CHUNKS_AS_INFO_DIAGNOSTICS) {
                // Shrink the range of block chunks to make their innards visible
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
    diagnostics.add(new UnexpectedEndOfInputChunkifyDiagnostic(tokens))
  }

  return { chunks: globalBlock.children, allChunks }
}

enum IllegalChunkKind {
  ExpectedSeparator,
  ExpectedKey,
  ExpectedValue,
  IllegalKeyInListLike,
}
class InvalidIllegalChunkDiagnostic extends TDiagnostic {
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
class UnexpectedEndOfInputParsingDiagnostic extends TDiagnostic {
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

function parseChunkTopLevel (chunk: TChunk, diagnostics: DiagnosticTracker): TDataWithPosition {
  switch (chunk.type) {
    case TChunkType.Block:
      return parseChunksBlock(chunk, diagnostics)
    case TChunkType.Value:
      return parseChunksValue(chunk.data, chunk.range)
    case TChunkType.Key:
    case TChunkType.ExpressionSeparator:
      IMPOSSIBLE()
  }
}

function parseChunksListLike (chunks: TChunk[], diagnostics: DiagnosticTracker): TDataWithPosition[] {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingValue = true
  const data: TDataWithPosition[] = []
  for (const chunk of chunks) {
    switch (chunk?.type) {
      case TChunkType.Key:
        diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.IllegalKeyInListLike))
        break
      case TChunkType.Block:
        if (!expectingValue) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedSeparator))
          // No break, this is recoverable
        }

        data.push(parseChunksBlock(chunk, diagnostics))

        expectingValue = false
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.Value:
        if (!expectingValue) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedSeparator))
          // No break, this is recoverable
        }

        data.push(parseChunksValue(chunk.data, chunk.range))

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
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedValue))
          break
        }
        expectingValue = true
        expectingSeparator = false
        justHadSeparator = true
        break
    }
  }
  if (!expectingSeparator && !justHadSeparator) {
    diagnostics.add(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return data
}

function parseChunksDictLike (chunks: TChunk[], diagnostics: DiagnosticTracker): Record<string, TDataWithPosition> {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingKey = true
  let expectingValueWithKey: string | null = null
  const data: Record<string, TDataWithPosition> = {}
  for (const chunk of chunks) {
    switch (chunk?.type) {
      case TChunkType.Key:
        if (!expectingKey) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, expectingSeparator ? IllegalChunkKind.ExpectedSeparator : IllegalChunkKind.ExpectedValue))

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
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, expectingKey ? IllegalChunkKind.ExpectedKey : IllegalChunkKind.ExpectedSeparator))
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
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, expectingSeparator ? IllegalChunkKind.ExpectedSeparator : IllegalChunkKind.ExpectedKey))
          break // NEED key
        }

        data[expectingValueWithKey] = parseChunksValue(chunk.data, chunk.range)

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
          diagnostics.add(new InvalidIllegalChunkDiagnostic(chunk, IllegalChunkKind.ExpectedValue))
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
    diagnostics.add(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return data
}

function parseChunksValue (data: TValueChunkData, range: Range): TDataWithPosition {
  switch (data[0]) {
    case SingleValueType.Boolean:
      return { type: TDataType.Boolean, value: data[1], range }
    case SingleValueType.Int:
      return { type: TDataType.Int, value: data[1], range }
    case SingleValueType.Float:
      return { type: TDataType.Float, value: data[1], range }
    case SingleValueType.String:
      return { type: TDataType.String, value: data[1], range }
  }
}

function parseChunksBlock (chunk: { children: TChunk[], enumKey?: string, kind: BlockType, range: Range }, diagnostics: DiagnosticTracker): TDataWithPosition {
  const range = chunk.range
  switch (chunk.kind) {
    case BlockType.Dict:
      return { type: TDataType.Dict, value: parseChunksDictLike(chunk.children, diagnostics), range }
    case BlockType.Arr:
      return { type: TDataType.Arr, value: parseChunksListLike(chunk.children, diagnostics), range }
    case BlockType.Tuple:
      return { type: TDataType.Tuple, value: parseChunksListLike(chunk.children, diagnostics), range }
  }
}

class EOFExpectedParsingDiagnostic extends TDiagnostic {
  constructor (chunks: TChunk[]) {
    super({
      message: 'End of file expected.',
      range: combineRanges(chunks[1].range, ...chunks.slice(2).map(v => v.range)),
    })
  }
}
class DataExpectedParsingDiagnostic extends TDiagnostic {
  constructor () {
    super({
      message: 'Data expected.',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    }, {
      canContinue: false,
    })
  }
}

export async function parse (tokens: TToken[], diagnostics: DiagnosticTracker): Promise<TDataWithPosition | null> {
  // TODO TYPE CHECKING

  const chunkified = chunkify(tokens, diagnostics)
  const chunks = chunkified.chunks.filter(v => [TChunkType.Block, TChunkType.Value].includes(v.type))

  if (DEBUG_CONSTANTS.SHOW_CHUNKS_AS_INFO_DIAGNOSTICS) {
    for (const chunk of chunkified.allChunks) {
      diagnostics.addRaw({
        message: `chunk/${TChunkType[chunk.type]}${({
          [TChunkType.Block] (chunk) {
            return ' [' + BlockType[chunk.kind] + (chunk.enumKey !== undefined ? ` (${chunk.enumKey})` : '') + '] - ' + chunk.children.length.toString() + ' children'
          },
          [TChunkType.Key] (chunk) {
            return ` "${chunk.key}"`
          },
          [TChunkType.Value] (chunk) {
            return ' = (' + SingleValueType[chunk.data[0]] + ') ' + JSON.stringify(chunk.data[1])
          },
          [TChunkType.ExpressionSeparator] (_) {
            return ''
          },
        } satisfies { [T in TChunkType]: (a: TChunk & { type: T }) => string })[chunk.type](chunk as any)}`,
        data: chunk,
        severity: DiagnosticSeverity.Information,
        range: chunk.range,
      })
    }
  }

  if (!diagnostics.canContinue) return null

  if (chunks.length === 0) { diagnostics.add(new DataExpectedParsingDiagnostic()) }
  if (chunks.length >= 2) { diagnostics.add(new EOFExpectedParsingDiagnostic(chunks)) }

  if (!diagnostics.canContinue) return null

  const data = parseChunkTopLevel(chunks[0], diagnostics)

  if (DEBUG_CONSTANTS.SHOW_PARSED_DATA_AS_HINT_DIAGNOSTICS) {
    diagnostics.addRaw({
      message: JSON.stringify(stripPositionInfoFromData(data), null, 2),
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      severity: DiagnosticSeverity.Hint,
    })
  }

  return data
}
