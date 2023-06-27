import { type Position, type Range } from 'vscode-languageserver'
import { type BlockDataWithPosition, TDataType, type TDataWithPosition } from '../parsing/TData'
import { BlockType } from '../parsing/TToken'
import { type BlockTypeSpec, type TTypeSpec, TTypeSpecType, BlockTypeExt } from '../parsing/TTypeSpec'
import { contractRange, positionCompare, positionIsInRange } from '../util/range'

export function traceInsideBlock (data: BlockDataWithPosition, pos: Position): { nValuesBefore: number, justPassedKey?: string, isInside: boolean } {
  const ranges: Array<{ range: Range, isKey: string | null }> = []

  switch (data.kind) {
    case BlockType.Dict:
      for (const value of Object.values(data.contents)) {
        ranges.push({ range: value.range, isKey: null })
      }
      for (const [key, value] of Object.entries(data.keyRanges)) {
        ranges.push({ range: value, isKey: key })
      }
      break

    case BlockType.Arr:
    case BlockType.Tuple:
      for (const value of data.contents) {
        ranges.push({ range: value.range, isKey: null })
      }
      break
  }

  ranges.sort((a, b) => positionCompare(a.range.start, b.range.start))

  let justPassedKey: string | undefined
  let nValuesBefore = 0

  for (const { range, isKey } of ranges) {
    const isInside = positionIsInRange(pos, range)

    const posIsBeforeRangeStart = positionCompare(pos, range.start) < 0
    if (posIsBeforeRangeStart) {
      // Return because this one is after the position and should not affect our results
      return { nValuesBefore, justPassedKey, isInside: false }
    }

    if (isKey != null) {
      // is key
      justPassedKey = isKey
      if (isInside) {
        return { justPassedKey, isInside, nValuesBefore }
      }
    } else {
      // is value
      if (isInside) {
        return { justPassedKey, isInside, nValuesBefore }
      }
      justPassedKey = undefined
      nValuesBefore++
    }
  }

  return { justPassedKey, nValuesBefore, isInside: false }
}

export function blockTrace (data: TDataWithPosition, type: TTypeSpec, pos: Position): { typeTraceFail: true } | { typeTraceFail: false, data: { d: BlockDataWithPosition, t: BlockTypeSpec } } | null {
  if (type.type === TTypeSpecType.Ref) {
    return blockTrace(data, type.ref(), pos)
  }
  if (type.type === TTypeSpecType.Missing) {
    return { typeTraceFail: true }
  }
  if (!positionIsInRange(pos, data.type === TDataType.Block ? blockRange(data.range, { includeBrackets: false }) : data.range)) {
    return null
  }
  switch (data.type) {
    case TDataType.Primitive: return null
    case TDataType.Enum: {
      if (data.contents == null || !positionIsInRange(pos, blockRange(data.contents.range, { includeBrackets: true }))) {
        return null
      }
      if (type.type !== TTypeSpecType.Enum) {
        return { typeTraceFail: true }
      }
      const subBlockType = type.enumSpec[data.enumKey]
      if (subBlockType == null) {
        return { typeTraceFail: true }
      }
      return blockTraceSubBlock(data.contents, subBlockType, pos)
    }
    case TDataType.Block: {
      if (type.type !== TTypeSpecType.Block) {
        return { typeTraceFail: true }
      }
      return blockTraceSubBlock(data, type, pos)
    }
  }
}

export function blockTraceSubBlock (data: BlockDataWithPosition, blockType: BlockTypeSpec, pos: Position): { typeTraceFail: true } | { typeTraceFail: false, data: { d: BlockDataWithPosition, t: BlockTypeSpec } } {
  switch (blockType.kind) {
    case BlockType.Dict:
    case BlockTypeExt.DictRecord:
      if (data.kind !== BlockType.Dict) {
        return { typeTraceFail: true }
      }
      return Object.entries(data.contents)
        .map(([i, v]) => blockTrace(v, blockType.kind === BlockTypeExt.DictRecord ? blockType.contents : blockType.contents[i], pos))
        .reduce((a, b) => a ?? b, null) ??
         { typeTraceFail: false, data: { d: data, t: blockType } }
    case BlockType.Tuple:
      if (data.kind !== BlockType.Tuple) {
        return { typeTraceFail: true }
      }

      return data.contents
        .map((v, i) => blockTrace(v, blockType.contents[i], pos))
        .reduce((a, b) => a ?? b, null) ??
         { typeTraceFail: false, data: { d: data, t: blockType } }
    case BlockType.Arr:
      if (data.kind !== BlockType.Arr) {
        return { typeTraceFail: true }
      }

      return data.contents
        .map((v, i) => blockTrace(v, blockType.contents, pos))
        .reduce((a, b) => a ?? b, null) ??
         { typeTraceFail: false, data: { d: data, t: blockType } }
  }
}

function blockRange (range: Range, cfg: { includeBrackets: boolean }): Range {
  return (
    cfg.includeBrackets
      ? range
      : contractRange(range, 1, 0)
  )
}
