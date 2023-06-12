import { type Hover, type Position, type Range } from 'vscode-languageserver'
import { DEBUG_CONSTANTS } from '../DEBUG_CONSTANTS'
import { type TParsedDoc } from '../TDocument'
import { TDataType, blockDataChildrenWithKey, type BlockDataWithPosition, type TDataWithPosition } from '../parsing/TData'
import { BlockType, SingleValueType, TokenType } from '../parsing/TToken'
import { TTypeSpecType, type BlockTypeSpec, type TTypeEnumSpec, type TTypeSpec } from '../parsing/TTypeSpec'
import { IMPOSSIBLE } from '../util/THROW'
import { positionIsInRange } from '../util/range'
import { isErr } from '../util/Result'

type HoverTraceKey = { kind: BlockType.Dict, key: string } | { kind: BlockType.Arr } | { kind: BlockType.Tuple, i: number } | { enumKey: string }
type HoverTraceTarget = { propertyKey?: never } | { propertyKey: string, propertyKeyRange: Range }
type HoverTraceResult = [TDataWithPosition[], HoverTraceKey[], HoverTraceTarget] | null

const unitType = Symbol('represents a unit type')

function traceDataTokens (data: TDataWithPosition, pos: Position): HoverTraceResult {
  if (!positionIsInRange(pos, data.range)) {
    return null
  }

  switch (data.type) {
    case TDataType.Block: {
      const childRes = traceDataTokens_blockChildren(data, data, pos)
      if (childRes !== null) {
        return childRes
      } else {
        // No hovering children found
        return [[data], [], {}]
      }
    }
    case TDataType.Enum:
      if (data.contents !== undefined) {
        const childRes = traceDataTokens_blockChildren(data, data.contents, pos)
        if (childRes !== null) {
          childRes[1].push({ enumKey: data.enumKey })
          return childRes
        }
      } else {
        // no content block -> could only be hovering on enum key
      }
      return [[data], [{ enumKey: data.enumKey }], {}]
    case TDataType.Primitive:
      // cannot have children, break immediately
      return [[data], [], {}]
    default:
      IMPOSSIBLE()
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function traceDataTokens_blockChildren (data: TDataWithPosition, block: BlockDataWithPosition, pos: Position): HoverTraceResult {
  // Check if we're hovering over a property key
  if (block.kind === BlockType.Dict) {
    for (const key in block.keyRanges) {
      if (positionIsInRange(pos, block.keyRanges[key])) {
        return [[data], [], { propertyKey: key, propertyKeyRange: block.keyRanges[key] }]
      }
    }
  }
  // Check if we're hovering over a child of this block
  for (const [key, elt] of blockDataChildrenWithKey(block)) {
    const match = traceDataTokens(elt, pos)
    if (match !== null) {
      match[0].push(data)
      match[1].push(key)
      return match
    }
  }
  // Not hovering over block contents
  return null
}

function displayTypeName (type: TTypeSpec, maxDepth: number = 6): string {
  return displayTypeNameLines(type, maxDepth).map(({ indent, line }) => '    '.repeat(indent) + line).join('\n')
}

interface DisplayLineGenerating { indent: number, line: string }
function displayTypeNameLines (type: TTypeSpec, maxDepth: number): DisplayLineGenerating[] {
  if (maxDepth === 0) {
    return [{ indent: 0, line: ' ... ' }]
  }
  switch (type.type) {
    case TTypeSpecType.Block:
      return displayBlockTypeNameLines(type, maxDepth)
    case TTypeSpecType.Enum: {
      const inner: DisplayLineGenerating[] = []
      for (const enumKey in type.enumSpec) {
        const spec = type.enumSpec[enumKey]
        const innerLines = spec === null
          ? [{ indent: 0, line: '#unit' }]
          : displayBlockTypeNameLines(spec, maxDepth)
        innerLines[0].line = enumKey + ': ' + innerLines[0].line
        inner.push(...innerLines)
      }
      inner.forEach(v => v.indent++)
      return joinIfShort([
        { indent: 0, line: '#enum {' },
        ...inner,
        { indent: 0, line: '}' },
      ])
    }
    case TTypeSpecType.Primitive: {
      let name: string
      switch (type.which) {
        case SingleValueType.Boolean: name = 'boolean'; break
        case SingleValueType.Int: name = 'int'; break
        case SingleValueType.Float: name = 'float'; break
        case SingleValueType.String: name = 'string'; break
      }
      return [{ indent: 0, line: '#' + name }]
    }
  }
}
function displayBlockTypeNameLines (type: BlockTypeSpec, maxDepth: number): DisplayLineGenerating[] {
  let brackets: [string, string]
  let inner: DisplayLineGenerating[]
  switch (type.kind) {
    case BlockType.Dict:
      brackets = ['{', '}']
      inner = []
      for (const key in type.contents) {
        const innerLines = displayTypeNameLines(type.contents[key], maxDepth - 1)
        innerLines[0].line = key + ': ' + innerLines[0].line
        inner.push(...innerLines)
      }
      break
    case BlockType.Arr:
      // brackets = ['', '[]']
      inner = displayTypeNameLines(type.contents, maxDepth - 1)
      inner[inner.length - 1].line += '[]'
      return inner
    case BlockType.Tuple:
      brackets = ['#tuple (', ')']
      inner = []
      for (const ent of type.contents) {
        inner.push(...displayTypeNameLines(ent, maxDepth - 1))
      }
      break
  }
  inner.forEach(v => v.indent++)
  return joinIfShort([
    { indent: 0, line: brackets[0] },
    ...inner,
    { indent: 0, line: brackets[1] },
  ])
}

function joinIfShort (lines: DisplayLineGenerating[]): DisplayLineGenerating[] {
  if (lines.map(v => v.line.length).reduce((a, b) => a + b) < 30) {
    return [{
      indent: 0,
      line: (lines[0].line +
      ' ' +
      lines.slice(1, lines.length - 1).map(v => v.line).join(', ') +
      ' ' +
       lines[lines.length - 1].line),
    }]
  } else {
    return lines
  }
}

export const THoverProvider = {
  getHover (doc: TParsedDoc, pos: Position): Hover | null {
    if (DEBUG_CONSTANTS.SHOW_TOKENS_AS_HOVER) {
      return this.debug.getHover_token(doc, pos)
    }
    const token = doc.tokens[doc.tokenAt(pos)]
    switch (token.data.type) {
      case TokenType.Whitespace:
      case TokenType.Newline:
      case TokenType.Comment:
        return null
    }

    let value = ''

    const [hoverTraceData, hoverTraceKeys, target] = traceDataTokens(doc.data, pos) ?? IMPOSSIBLE()
    // make the trace deepest-last
    hoverTraceData.reverse()
    hoverTraceKeys.reverse()

    if (target.propertyKey !== undefined) {
      hoverTraceKeys.push({ kind: BlockType.Dict, key: target.propertyKey })
    }

    const topLevelType = typeof doc.typeSpec === 'number' ? null : doc.typeSpec
    if (topLevelType == null || isErr(topLevelType[1])) {
      return null
    }
    let expectedType: TTypeSpec | typeof unitType = topLevelType[1][0]
    let nSafeKeys = 0
    let typeFailed = false
    for (const key of hoverTraceKeys) {
      if (expectedType === unitType) {
        // illegal indexing into unit
        typeFailed = true
        break
      }
      if ('enumKey' in key) {
        if (expectedType.type !== TTypeSpecType.Enum || !(key.enumKey in expectedType.enumSpec)) {
          // type mismatch
          typeFailed = true
          break
        }
        const enumEnt: TTypeEnumSpec[string] = expectedType.enumSpec[key.enumKey]
        expectedType =
          (enumEnt !== null
            ? { ...enumEnt, type: TTypeSpecType.Block } as const
            : unitType)
      } else {
        if (expectedType.type !== TTypeSpecType.Block) {
          // type mismatch
          typeFailed = true
          break
        }
        if (key.kind === BlockType.Dict && expectedType.kind === BlockType.Dict) {
          const next: TTypeSpec | undefined = expectedType.contents[key.key]
          if (next == null) {
            // index invalid
            typeFailed = true
            break
          }
          expectedType = next
        } else if (key.kind === BlockType.Arr && expectedType.kind === BlockType.Arr) {
          expectedType = expectedType.contents
        } else if (key.kind === BlockType.Tuple && expectedType.kind === BlockType.Tuple) {
          const next: TTypeSpec | undefined = expectedType.contents[key.i]
          if (next == null) {
          // index invalid
            typeFailed = true
            break
          }
          expectedType = next
        } else {
          // type mismatch
          typeFailed = true
          break
        }
      }
      nSafeKeys++
    }
    if (typeFailed) {
      // do something ig
    }

    const range = typeFailed
      ? [
          ...hoverTraceData.map(v => v.range),
          ...(target.propertyKey !== undefined ? [target.propertyKeyRange] : []),
        ][nSafeKeys]
      : (target.propertyKey !== undefined
          ? target.propertyKeyRange
          : hoverTraceData[hoverTraceData.length - 1].range
        )

    value += 'TYPEOF(<~>'
    for (const key of hoverTraceKeys.slice(0, nSafeKeys)) {
      if ('enumKey' in key) {
        value += `#${key.enumKey}`
      } else if (key.kind === BlockType.Dict) {
        value += '.' + key.key
      } else if (key.kind === BlockType.Arr) {
        value += '[]'
      } else if (key.kind === BlockType.Tuple) {
        value += `[${key.i.toString()}]`
      }
    }

    value += '): '

    value += expectedType === unitType ? '#unit' : displayTypeName(expectedType)

    return {
      contents: {
        language: 'thrdtypes',
        value,
      },
      range,
    }
  },

  debug: {
    getHover_token (doc: TParsedDoc, pos: Position): Hover {
      const token = doc.tokens[doc.tokenAt(pos)]
      return {
        contents: {
          kind: 'plaintext',
          value: `Token: ${TokenType[token.data.type]}`,
        },
        range: token.range,
      }
    },
  },

} as const
