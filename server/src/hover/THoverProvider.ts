import { type Hover, type Position } from 'vscode-languageserver'
import { DEBUG_CONSTANTS } from '../DEBUG_CONSTANTS'
import { type TParsedDoc } from '../TDocument'
import { BlockType, SingleValueType, TokenType } from '../parsing/TToken'
import { TTypeSpecType, type BlockTypeSpec, type TTypeSpec, BlockTypeExt } from '../parsing/TTypeSpec'
import { traceDataTokens, traceExpectedType, unitType } from './traceDataTokens'
import { isErr, unwrapResult } from '../util/Result'

function displayTypeName (type: TTypeSpec, maxDepth: number = 4): string {
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
    case TTypeSpecType.Ref: {
      const lines = displayTypeNameLines(type.ref(), maxDepth - 1)
      lines[0].line = `@${type.refName} ` + lines[0].line
      return lines
    }
    case TTypeSpecType.Missing: {
      return [{ indent: 0, line: ' ~ missing ~ ' }]
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
    case BlockTypeExt.DictRecord:
      brackets = ['#record { _:', '}']
      inner = displayTypeNameLines(type.contents, maxDepth - 1)
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

    const traceResult = traceDataTokens(doc.data, pos)
    if (traceResult == null) {
      return null
    }
    const [hoverTraceData, hoverTraceKeys, target] = traceResult

    if (target.propertyKey !== undefined) {
      hoverTraceKeys.push({ kind: BlockType.Dict, key: target.propertyKey })
    }

    const topLevelType = doc.typeSpec
    if (topLevelType == null || isErr(topLevelType[1])) {
      return null
    }

    const { nSafeKeys, typeFailed, expectedType } = traceExpectedType(hoverTraceKeys, unwrapResult(topLevelType[1]))

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
      } else if (key.kind === BlockTypeExt.DictRecord) {
        value += '._'
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
