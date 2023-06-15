import { DiagnosticSeverity, TextEdit, type Range } from 'vscode-languageserver'
import { DEBUG_CONSTANTS } from '../DEBUG_CONSTANTS'
import { TDiagnostic, type DiagnosticTracker } from '../linting/DiagnosticTracker'
import { Stack } from '../util/Stack'
import { IMPOSSIBLE } from '../util/THROW'
import { combineRanges, tokenRangeSingle, type TokenRange } from '../util/range'
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
  Enum,
  Comment,
  /** These are the commas */
  ExpressionSeparator,
}

export type TChunk = ({
  type: TChunkType.Block
  kind: BlockType
  children: TChunk[]
} | {
  type: TChunkType.Comment
  isBlockComment: boolean
} | {
  type: TChunkType.Enum
  enumKey: string
  children: TChunk & { type: TChunkType.Block } | null
} | {
  type: TChunkType.Key
  key: string
} | {
  type: TChunkType.Value
  data: TValueChunkData
} | {
  type: TChunkType.ExpressionSeparator
  weak: boolean
}) & { range: Range, tokenRange: TokenRange }

type TValueChunkData = (
  [SingleValueType.Boolean, boolean]
  | [SingleValueType.Float | SingleValueType.Int, number]
  | [SingleValueType.String, string]
)

interface TBlockChunk {
  type: TChunkType.Block
  kind?: BlockType
  children: TChunk[]
  range: Range
  tokenRange: TokenRange
  token?: TToken
}

function chunkify (tokens: TToken[], diagnostics: DiagnosticTracker): { chunks: TChunk[], allChunks: TChunk[] } {
  const allChunks: TChunk[] = []
  const globalBlock: TBlockChunk = {
    type: TChunkType.Block,
    children: [],
    tokenRange: { start: 0, end: 0 },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  }
  function pushChunk (chunk: TChunk): void {
    chunkStack.top[0].children.push(chunk)
    allChunks.push(chunk)
  }
  const chunkStack = new Stack<[TBlockChunk, TChunk] | [TBlockChunk]>()
  chunkStack.push([globalBlock])

  let enumKey: { token: TToken, i: number } | undefined

  let canInsertWeakSeparator = false

  for (let i = 0; ;) {
    const startI = i
    const token = tokens[i++] ?? null

    if (token === null) {
      // end of input
      break
    }

    switch (token.data.type) {
      case TokenType.Invalid:
        diagnostics.add(new InvalidTokenDiagnostic(token))
        break
      case TokenType.Whitespace:
        // ignore
        break
      case TokenType.Comment:
        pushChunk({ type: TChunkType.Comment, isBlockComment: token.data.isBlockComment, range: token.range, tokenRange: tokenRangeSingle(startI) })
        break
      case TokenType.Newline:
        if (canInsertWeakSeparator) {
          pushChunk({ type: TChunkType.ExpressionSeparator, range: token.range, weak: true, tokenRange: tokenRangeSingle(startI) })
          canInsertWeakSeparator = false
        }
        break
      case TokenType.Separator:
        switch (token.data.separator) {
          case SeparatorType.List:
            pushChunk({ type: TChunkType.ExpressionSeparator, range: token.range, weak: false, tokenRange: tokenRangeSingle(startI) })
            canInsertWeakSeparator = true
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
            data = [SingleValueType.Int, parseInt(token.text.replace(/_/g, ''))]
            break
          case PrimitiveValueType.Float:
            // data = [SingleValueType.Float, (
            //   /-?(PI|TAO|E|Infinity)/.test(token.text)
            //     ? ({ PI: Math.PI, TAO: Math.PI * 2, E: Math.E, Infinity }[token.text.replace(/-/g, '')] ?? IMPOSSIBLE()) * (token.text.includes('-') ? -1 : 1)
            //     : parseFloat(token.text.replace(/_/g, '')))]
            data = [SingleValueType.Float, parseFloat(token.text.replace(/_/g, ''))]
            break
        }
        pushChunk({ type: TChunkType.Value, data, range: token.range, tokenRange: tokenRangeSingle(startI) })
        canInsertWeakSeparator = true
      }
        break
      case TokenType.PropertyKey: {
        const keyValueSeparatorToken = tokens[i++] // the `:`
        pushChunk({ type: TChunkType.Key, key: token.text, range: combineRanges(token.range, keyValueSeparatorToken.range), tokenRange: { start: i, end: i + 2 } })
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
        pushChunk({ type: TChunkType.Value, data: [SingleValueType.String, builtString], range: combineRanges(token.range, ...involvedTokens.map(v => v.range)), tokenRange: { start: i, end: i + 1 + involvedTokens.length } })
        canInsertWeakSeparator = true
      }
        break
      case TokenType.StringData:
        // Should be absorbed by `StringBoundary`
        IMPOSSIBLE()
        break
      case TokenType.EnumKey:
        if (token.data.isUnit) {
          pushChunk({ type: TChunkType.Enum, enumKey: token.text.substring(1), range: token.range, children: null, tokenRange: tokenRangeSingle(startI) })
          enumKey = undefined
          canInsertWeakSeparator = true
        } else {
          enumKey = { token, i: startI }
          canInsertWeakSeparator = false
        }
        break
      case TokenType.BlockBoundary:
        switch (token.data.side) {
          case Side.Begin: {
            const chunk: TChunk & TBlockChunk = { type: TChunkType.Block, kind: token.data.kind, range: token.range, children: [], token, tokenRange: tokenRangeSingle(startI) }
            if (enumKey !== undefined) {
              const enumChunk = {
                type: TChunkType.Enum,
                children: chunk,
                enumKey: enumKey.token.text.substring(1),
                range: enumKey.token.range,
                tokenRange: tokenRangeSingle(enumKey.i),
              } satisfies TChunk
              pushChunk(enumChunk)
              chunkStack.push([chunk, enumChunk])
            } else {
              pushChunk(chunk)
              chunkStack.push([chunk])
            }
            enumKey = undefined
            canInsertWeakSeparator = false
          }
            break
          case Side.End: {
            let nFramesToPop = 1
            if (chunkStack.top[0].kind !== token.data.kind) {
              // stack top will always have token when `BlockBoundary/End` because TextMate only
              // captures more beginnings than ends never the other way around

              const openToken = chunkStack.top[0].token ?? IMPOSSIBLE()
              /** Number of layers of blocks skipped in the mismatch */
              const missingFrames = openToken.depth - token.depth
              nFramesToPop += missingFrames

              diagnostics.add(new BracketMismatchDiagnostic(openToken, token))
            }

            for (let n = 0; n < nFramesToPop; n++) {
              // update the end positions of popped stack frames because we now know where that end is
              const top = chunkStack.top
              top[0].range = combineRanges(top[0].range, token.range)
              top[0].tokenRange.end = startI + 1
              if (top.length === 2) {
                top[1].range = combineRanges(top[1].range, token.range)
                top[1].tokenRange.end = startI + 1
              }
              const frame = chunkStack.pop()
              delete frame[0].token
            }
            canInsertWeakSeparator = true
          }
            break
        }
        break
    }
  }

  if (chunkStack.top[0] !== globalBlock) {
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
enum IllegalChunkAutoFixType {
  None,
  AddCommaBefore,
  Delete,
}
class InvalidIllegalChunkDiagnostic extends TDiagnostic {
  constructor (
    chunk: TChunk,
    kind: IllegalChunkKind,
    prevChunk: TChunk | undefined,
    autoFix: IllegalChunkAutoFixType,
  ) {
    super({
      message: ({
        [IllegalChunkKind.ExpectedKey]: 'Expected property key.',
        [IllegalChunkKind.ExpectedValue]: 'Expected value.',
        [IllegalChunkKind.ExpectedSeparator]: 'Expected ",".',
        [IllegalChunkKind.IllegalKeyInListLike]: 'Arrays and tuples do not accept property keys.',
      } satisfies { [key in IllegalChunkKind]: string })[kind],
      range: chunk.range,
    }, {
      autoFix: ({
        [IllegalChunkAutoFixType.None]: undefined,
        [IllegalChunkAutoFixType.AddCommaBefore]: prevChunk !== undefined
          ? (prevChunk.range.end.line === chunk.range.start.line
              ? TextEdit.replace({ start: prevChunk.range.end, end: chunk.range.start }, ', ')
              : TextEdit.insert(prevChunk.range.end, ',')
            )
          : TextEdit.insert(chunk.range.start, ','),
        [IllegalChunkAutoFixType.Delete]: TextEdit.del(chunk.range),
      } satisfies { [T in IllegalChunkAutoFixType]: TextEdit | undefined })[autoFix],

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
class DuplicatePropertyKeyParsingDiagnostic extends TDiagnostic {
  constructor (
    chunk: TChunk & { type: TChunkType.Key },
  ) {
    super({
      message: `Duplicate property key "${chunk.key}".`,
      range: chunk.range,
    })
  }
}

class UnnecessaryCommaWarningParsingDiagnostic extends TDiagnostic {
  constructor (
    chunk: TChunk,
  ) {
    super({
      message: 'Unnecessary comma',
      range: chunk.range,
      severity: DiagnosticSeverity.Warning,
    }, {
      autoFix: TextEdit.del(chunk.range),
    })
  }

  static runCheck (chunk: TChunk & { type: TChunkType.ExpressionSeparator }, chunkI: number, chunks: TChunk[], diagnostics: DiagnosticTracker): void {
    if (chunk.weak) return
    // Prefer newline to comma
    let foundWeakSep = false
    let foundEndOfInput = true
    let foundStartOfInput = true
    // For loops to skip over possible illegal commas
    for (let i = chunkI + 1; i < chunks.length; i++) {
      // See if there's a weak separator next
      const nextChunk = chunks[i]
      if (nextChunk.type === TChunkType.Comment) {
        // ignore
      } else if (nextChunk.type === TChunkType.ExpressionSeparator) {
        if (nextChunk.weak) {
          foundWeakSep = true
          break
        }
      } else {
        foundEndOfInput = false
        break
      }
    }
    for (let i = chunkI - 1; i >= 0; i--) {
      // See if there's a weak separator previously
      const nextChunk = chunks[i]
      if (nextChunk.type === TChunkType.Comment) {
        // ignore
      } else if (nextChunk.type === TChunkType.ExpressionSeparator) {
        if (nextChunk.weak) {
          foundWeakSep = true
          break
        }
      } else {
        foundStartOfInput = false
        break
      }
    }
    if (foundWeakSep || foundEndOfInput || foundStartOfInput) {
      // This comma is unnecessary
      diagnostics.add(new UnnecessaryCommaWarningParsingDiagnostic(
        chunk,
      ))
    }
  }
}

function parseChunkTopLevel (chunk: TChunk, diagnostics: DiagnosticTracker): TDataWithPosition {
  switch (chunk.type) {
    case TChunkType.Block:
      return parseChunksBlock(chunk, diagnostics)
    case TChunkType.Enum:
      return parseChunksEnum(chunk, diagnostics)
    case TChunkType.Value:
      return parseChunksValue(chunk.data, chunk.range, chunk.tokenRange)
    case TChunkType.Key:
    case TChunkType.ExpressionSeparator:
    case TChunkType.Comment:
      IMPOSSIBLE()
  }
}

function parseChunksEnum (chunk: TChunk & { type: TChunkType.Enum }, diagnostics: DiagnosticTracker): TDataWithPosition {
  return {
    type: TDataType.Enum,
    enumKey: chunk.enumKey,
    range: chunk.range,
    tokenRange: chunk.tokenRange,
    contents: chunk.children !== null ? parseChunksBlock(chunk.children, diagnostics) : undefined,
  }
}

function parseChunksListLike (chunks: TChunk[], diagnostics: DiagnosticTracker): TDataWithPosition[] {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingValue = true
  const data: TDataWithPosition[] = []
  let lastChunkI = -1
  for (let chunkI = 0; chunkI < chunks.length; chunkI++) {
    const chunk = chunks[chunkI]
    const lastChunk = chunks[lastChunkI] ?? undefined
    switch (chunk?.type) {
      case TChunkType.Comment:
        // ignore
        break
      case TChunkType.Key:
        // Cannot have keys in lists
        diagnostics.add(new InvalidIllegalChunkDiagnostic(
          chunk,
          IllegalChunkKind.IllegalKeyInListLike,
          lastChunk,
          IllegalChunkAutoFixType.Delete,
        ))
        break
      case TChunkType.Block:
      case TChunkType.Value:
      case TChunkType.Enum:
        if (!expectingValue) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(
            chunk,
            IllegalChunkKind.ExpectedSeparator,
            lastChunk,
            IllegalChunkAutoFixType.AddCommaBefore,
          ))
          // No break, this is recoverable
        }

        switch (chunk.type) {
          case TChunkType.Block:
            data.push(parseChunksBlock(chunk, diagnostics))
            break
          case TChunkType.Value:
            data.push(parseChunksValue(chunk.data, chunk.range, chunk.tokenRange))
            break
          case TChunkType.Enum:
            data.push(parseChunksEnum(chunk, diagnostics))
            break
        }

        expectingValue = false
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.ExpressionSeparator:
        if (justHadWeakSeparator && justHadSeparator) {
          UnnecessaryCommaWarningParsingDiagnostic.runCheck(chunk, chunkI, chunks, diagnostics)
          justHadWeakSeparator = chunk.weak
          break
        }
        if (justHadSeparator && chunk.weak) {
          justHadWeakSeparator = chunk.weak
          break
        }
        justHadWeakSeparator = chunk.weak

        if (!expectingSeparator) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(
            chunk,
            IllegalChunkKind.ExpectedValue,
            lastChunk,
            IllegalChunkAutoFixType.Delete,
          ))
          break
        }
        UnnecessaryCommaWarningParsingDiagnostic.runCheck(chunk, chunkI, chunks, diagnostics)

        expectingValue = true
        expectingSeparator = false
        justHadSeparator = true
        break
    }
    if (chunk.type !== TChunkType.Comment) {
      lastChunkI = chunkI
    }
  }
  if (!expectingSeparator && !justHadSeparator) {
    diagnostics.add(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return data
}

function parseChunksDictLike (chunks: TChunk[], diagnostics: DiagnosticTracker): { contents: Record<string, TDataWithPosition>, keyRanges: Record<string, Range> } {
  let expectingSeparator = false
  let justHadSeparator = true
  let justHadWeakSeparator = true
  let expectingKey = true
  let expectingValueWithKey: string | null = null
  let lastKeyWasDuplicate = false
  const data: Record<string, TDataWithPosition> = {}
  const keyRanges: Record<string, Range> = {}
  let lastChunkI = -1
  for (let chunkI = 0; chunkI < chunks.length; chunkI++) {
    const chunk = chunks[chunkI]
    const lastChunk = chunks[lastChunkI] ?? undefined
    switch (chunk?.type) {
      case TChunkType.Comment:
        // ignore
        break
      case TChunkType.Key:
        if (!expectingKey) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(
            chunk,
            expectingSeparator ? IllegalChunkKind.ExpectedSeparator : IllegalChunkKind.ExpectedValue,
            lastChunk,
            expectingSeparator ? IllegalChunkAutoFixType.AddCommaBefore : IllegalChunkAutoFixType.None,
          ))

          if (expectingValueWithKey !== null) {
            // No break, last key takes precedent
          }
          if (expectingSeparator) {
            // No break, this is recoverable
          }
        }

        lastKeyWasDuplicate = chunk.key in data
        if (lastKeyWasDuplicate) {
          diagnostics.add(new DuplicatePropertyKeyParsingDiagnostic(chunk))
          break
        } else {
          // This data will be left in place in case of failures
          // so that autofill works as expected
          keyRanges[chunk.key] = chunk.range
        }

        expectingKey = false
        expectingValueWithKey = chunk.key
        expectingSeparator = false
        justHadSeparator = false
        break
      case TChunkType.Block:
      case TChunkType.Value:
      case TChunkType.Enum:
        if (expectingValueWithKey === null) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(
            chunk,
            expectingKey ? IllegalChunkKind.ExpectedKey : IllegalChunkKind.ExpectedSeparator,
            lastChunk,
            IllegalChunkAutoFixType.None,
          ))
          break // NEED key
        }

        if (lastKeyWasDuplicate) {
          // ignore this value if last key was a duplicate
        } else {
          switch (chunk.type) {
            case TChunkType.Block:
              data[expectingValueWithKey] = parseChunksBlock(chunk, diagnostics)
              break
            case TChunkType.Value:
              data[expectingValueWithKey] = parseChunksValue(chunk.data, chunk.range, chunk.tokenRange)
              break
            case TChunkType.Enum:
              data[expectingValueWithKey] = parseChunksEnum(chunk, diagnostics)
              break
          }
        }

        expectingKey = false
        expectingValueWithKey = null
        expectingSeparator = true
        justHadSeparator = false
        break
      case TChunkType.ExpressionSeparator:
        if (justHadWeakSeparator && justHadSeparator) {
          UnnecessaryCommaWarningParsingDiagnostic.runCheck(chunk, chunkI, chunks, diagnostics)
          justHadWeakSeparator = chunk.weak
          break
        }
        if (justHadSeparator && chunk.weak) {
          justHadWeakSeparator = chunk.weak
          break
        }
        justHadWeakSeparator = chunk.weak

        if (!expectingSeparator) {
          diagnostics.add(new InvalidIllegalChunkDiagnostic(
            chunk,
            IllegalChunkKind.ExpectedValue,
            lastChunk,
            justHadSeparator ? IllegalChunkAutoFixType.Delete : IllegalChunkAutoFixType.None,
          ))
          break
        }
        UnnecessaryCommaWarningParsingDiagnostic.runCheck(chunk, chunkI, chunks, diagnostics)

        expectingKey = true
        expectingValueWithKey = null
        expectingSeparator = false
        justHadSeparator = true
        break
    }
    if (chunk.type !== TChunkType.Comment) {
      lastChunkI = chunkI
    }
  }
  if (!expectingSeparator && !justHadSeparator) {
    diagnostics.add(new UnexpectedEndOfInputParsingDiagnostic(chunks[chunks.length - 1], false))
  }
  return { contents: data, keyRanges }
}

function parseChunksValue (data: TValueChunkData, range: Range, tokenRange: TokenRange): TDataWithPosition {
  switch (data[0]) {
    case SingleValueType.Boolean:
      return { type: TDataType.Primitive, which: data[0], value: data[1], range, tokenRange }
    case SingleValueType.Int:
    case SingleValueType.Float:
      return { type: TDataType.Primitive, which: data[0], value: data[1], range, tokenRange }
    case SingleValueType.String:
      return { type: TDataType.Primitive, which: data[0], value: data[1], range, tokenRange }
  }
}

function parseChunksBlock (chunk: { children: TChunk[], kind: BlockType, range: Range, tokenRange: TokenRange }, diagnostics: DiagnosticTracker): TDataWithPosition & { type: TDataType.Block } {
  const { range, tokenRange } = chunk
  switch (chunk.kind) {
    case BlockType.Dict: {
      const { contents, keyRanges } = parseChunksDictLike(chunk.children, diagnostics)
      return { type: TDataType.Block, kind: chunk.kind, contents, keyRanges, range, tokenRange }
    }
    case BlockType.Arr:
      return { type: TDataType.Block, kind: chunk.kind, contents: parseChunksListLike(chunk.children, diagnostics), range, tokenRange }
    case BlockType.Tuple:
      return { type: TDataType.Block, kind: chunk.kind, contents: parseChunksListLike(chunk.children, diagnostics), range, tokenRange }
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

class IllegalTopLevelParsingDiagnostic extends TDiagnostic {
  constructor (
    chunk: TChunk,
  ) {
    super({
      message: 'Illegal top level chunk.',
      range: chunk.range,
    }, {
      canContinue: false,
    })
  }
}

export async function parse (tokens: TToken[], diagnostics: DiagnosticTracker): Promise<TDataWithPosition | null> {
  const chunkified = chunkify(tokens, diagnostics)

  const illegalTopLevelChunks = chunkified.chunks.filter(v => ![TChunkType.Block, TChunkType.Value, TChunkType.Enum, TChunkType.Comment].includes(v.type) && !(v.type === TChunkType.ExpressionSeparator && v.weak))
  for (const illegalChunk of illegalTopLevelChunks) {
    diagnostics.add(new IllegalTopLevelParsingDiagnostic(illegalChunk))
  }

  const chunks = chunkified.chunks.filter(v => [TChunkType.Block, TChunkType.Value, TChunkType.Enum].includes(v.type))

  if (DEBUG_CONSTANTS.SHOW_CHUNKS_AS_INFO_DIAGNOSTICS) {
    for (const chunk of chunkified.allChunks) {
      diagnostics.addRaw({
        message: `chunk/${TChunkType[chunk.type]}${({
          [TChunkType.Enum] (chunk) {
            return ' ' + chunk.enumKey + '<' + (chunk.children === null ? '~Unit~' : BlockType[chunk.children.kind]) + '>'
          },
          [TChunkType.Comment] (chunk) {
            return ''
          },
          [TChunkType.Block] (chunk) {
            return ' [' + BlockType[chunk.kind] + '] - ' + chunk.children.length.toString() + ' children'
          },
          [TChunkType.Key] (chunk) {
            return ` "${chunk.key}"`
          },
          [TChunkType.Value] (chunk) {
            return ' = (' + SingleValueType[chunk.data[0]] + ') ' + (typeof chunk.data[1] === 'number' ? chunk.data[1].toString() : JSON.stringify(chunk.data[1]))
          },
          [TChunkType.ExpressionSeparator] (_) {
            return ''
          },
        } satisfies { [T in TChunkType]: (a: TChunk & { type: T }) => string })[chunk.type](chunk as any)}`,
        data: chunk,
        severity: DiagnosticSeverity.Information,
        range: chunk.type === TChunkType.Block ? { start: chunk.range.start, end: chunk.range.end } : chunk.range,
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
