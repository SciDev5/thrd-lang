import { type Range, type Position } from 'vscode-languageserver'
import { type BlockDataWithPosition, TDataType, type TDataWithPosition, blockDataChildrenWithKey } from '../parsing/TData'
import { positionIsInRange } from '../util/range'
import { BlockType } from '../parsing/TToken'
import { IMPOSSIBLE } from '../util/THROW'
import { type TTypeEnumSpec, type TTypeSpec, TTypeSpecType, BlockTypeExt } from '../parsing/TTypeSpec'

type HoverTraceKey = { kind: BlockType.Dict | BlockTypeExt.DictRecord, key: string } | { kind: BlockType.Arr } | { kind: BlockType.Tuple, i: number } | { enumKey: string }
type HoverTraceTarget = { propertyKey?: never } | { propertyKey: string, propertyKeyRange: Range }
type HoverTraceResult = [TDataWithPosition[], HoverTraceKey[], HoverTraceTarget] | null

export const unitType = Symbol('represents a unit type')

export function traceExpectedType (hoverTraceKeys: HoverTraceKey[], topLevelType: TTypeSpec): { nSafeKeys: number, typeFailed: boolean, expectedType: TTypeSpec | typeof unitType } {
  let expectedType: TTypeSpec | typeof unitType = topLevelType
  let nSafeKeys = 0
  let typeFailed = false
  for (const key of hoverTraceKeys) {
    if (expectedType === unitType) {
      // illegal indexing into unit
      typeFailed = true
      break
    } else {
      if (expectedType.type === TTypeSpecType.Missing) {
        typeFailed = true
        break
      }
      if (expectedType.type === TTypeSpecType.Ref) {
        expectedType = expectedType.ref()
      }
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
      } else if (key.kind === BlockType.Dict && expectedType.kind === BlockTypeExt.DictRecord) {
        key.kind = BlockTypeExt.DictRecord
        expectedType = expectedType.contents
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

  return { nSafeKeys, typeFailed, expectedType }
}

export function traceDataTokens (data: TDataWithPosition, pos: Position): HoverTraceResult {
  const traceResult = traceDataTokens_recursive(data, pos)
  if (traceResult == null) {
    return null
  }
  const [hoverTraceData, hoverTraceKeys, target] = traceResult

  // make the trace deepest-last
  hoverTraceData.reverse()
  hoverTraceKeys.reverse()

  return [hoverTraceData, hoverTraceKeys, target]
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function traceDataTokens_recursive (data: TDataWithPosition, pos: Position): HoverTraceResult {
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
    const match = traceDataTokens_recursive(elt, pos)
    if (match !== null) {
      match[0].push(data)
      match[1].push(key)
      return match
    }
  }
  // Not hovering over block contents
  return null
}
