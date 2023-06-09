import { type Range } from 'vscode-languageserver'
import { Stack } from '../util/Stack'
import { IMPOSSIBLE } from '../util/THROW'
import { combineRanges } from '../util/range'
import { PrimitiveValueType, SeparatorType, Side, SingleValueType, TokenType, type BlockType, type TToken } from './TToken'

enum TChunkType {
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

function chunkify (tokens: TToken[], blockRangeFull = true): { chunks: TChunk[], allChunks: TChunk[], nLeft: number } {
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

  for (let i = 0; ;) {
    const token = tokens[i++] ?? null

    if (token === null) {
      // end of input
      break
    }

    switch (token.data.type) {
      case TokenType.Invalid:
      case TokenType.Ignored:
      case TokenType.Newline:
        // ignore
        break
      case TokenType.Separator:
        switch (token.data.separator) {
          case SeparatorType.List:
            pushChunk({ type: TChunkType.ExpressionSeparator, range: token.range })
            break
          case SeparatorType.KeyValue:
            // Should be absorbed by `PropertyKey` token parsing
            IMPOSSIBLE()
        }
        break
      case TokenType.PrimitiveData:{
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
      }
        break
      case TokenType.PropertyKey: {
        const keyValueSeparatorToken = tokens[i++] // the `:`
        pushChunk({ type: TChunkType.Key, key: token.text, range: combineRanges(token.range, keyValueSeparatorToken.range) })
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
            return { chunks: globalBlock.children, allChunks, nLeft: involvedTokens.length + 1 }
          }
          involvedTokens.push(token)
          switch (token.data.type) {
            case TokenType.StringData:{
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
      }
        break
      case TokenType.StringData:
        // Should be absorbed by `StringBoundary`
        IMPOSSIBLE()
        break
      case TokenType.EnumKey:
        enumKey = token
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
            chunkStack.push(chunk)
          }
            break
          case Side.End: {
            let nFramesToPop = 1
            if (chunkStack.top.kind !== token.data.kind) {
              // TODO: mark error

              // stack top will always have token when `BlockBoundary/End` because TextMate only
              // captures more beginnings than ends never the other way around

              /** Number of layers of blocks skipped in the mismatch */
              const missingFrames = (chunkStack.top.token ?? IMPOSSIBLE()).depth - token.depth
              nFramesToPop += missingFrames
            }

            for (let n = 0; n < nFramesToPop; n++) {
              if (blockRangeFull) {
                chunkStack.top.range = combineRanges(chunkStack.top.range, token.range)
              }
              const frame = chunkStack.pop()
              delete frame.token
            }
          }
            break
        }
        break
    }
  }

  if (chunkStack.top !== globalBlock) {
    // not all blocks were closed

    // TODO: mark error
  }

  return { chunks: globalBlock.children, allChunks, nLeft: 0 }
}

export { chunkify }

// class TParser {
//   constructor (
//     readonly doc: TLexedDoc,
//   ) { }
// }
