import { type Range } from 'vscode-languageserver'
import { type TokenRange } from '../util/range'
import { BlockType, type SingleValueType } from './TToken'

export enum TDataType {
  Primitive,
  Enum,
  Block,
}

export type TData = ({
  type: TDataType.Primitive
} & ({
  which: SingleValueType.Boolean
  value: boolean
} | {
  which: SingleValueType.String
  value: string
} | {
  which: SingleValueType.Int | SingleValueType.Float
  value: number
})) | ({
  type: TDataType.Block
} & BlockData) | {
  type: TDataType.Enum
  enumKey: string
  contents?: BlockData
}

export type BlockData = {
  kind: BlockType.Dict
  contents: Record<string, TData>
} | {
  kind: BlockType.Arr | BlockType.Tuple
  contents: TData[]
}

export type TDataWithPosition = (({
  type: TDataType.Primitive
} & ({
  which: SingleValueType.Boolean
  value: boolean
} | {
  which: SingleValueType.String
  value: string
} | {
  which: SingleValueType.Int | SingleValueType.Float
  value: number
})) | ({
  type: TDataType.Block
} & BlockDataWithPosition) | {
  type: TDataType.Enum
  enumKey: string
  contents?: BlockDataWithPosition & { range: Range, tokenRange: TokenRange }
}) & { range: Range, tokenRange: TokenRange }

export type BlockDataWithPosition = {
  kind: BlockType.Dict
  contents: Record<string, TDataWithPosition>
  keyRanges: Record<string, Range>
} | {
  kind: BlockType.Arr | BlockType.Tuple
  contents: TDataWithPosition[]
}

function stripPositionInfoFromBlockData (data: BlockDataWithPosition): BlockData {
  switch (data.kind) {
    case BlockType.Dict:
      return { kind: data.kind, contents: Object.fromEntries(Object.entries(data.contents).map(([k, v]) => [k, stripPositionInfoFromData(v)])) }
    case BlockType.Arr:
    case BlockType.Tuple:
      return { kind: data.kind, contents: data.contents.map(v => stripPositionInfoFromData(v)) }
  }
}

export function stripPositionInfoFromData (data: TDataWithPosition): TData {
  switch (data.type) {
    case TDataType.Primitive:
      return { type: TDataType.Primitive, which: data.which, value: data.value as any }
    case TDataType.Block:
      return { type: TDataType.Block, ...stripPositionInfoFromBlockData(data) }
    case TDataType.Enum:
      return { type: TDataType.Enum, enumKey: data.enumKey, contents: data.contents !== undefined ? stripPositionInfoFromBlockData(data.contents) : undefined }
  }
}

export function blockDataChildren (data: BlockDataWithPosition): TDataWithPosition[] {
  return data.kind === BlockType.Dict
    ? Object.values(data.contents)
    : data.contents
}

export function blockDataChildrenWithKey (data: BlockDataWithPosition):
Array<[{ kind: BlockType.Dict, key: string }, TDataWithPosition]> |
Array<[{ kind: BlockType.Tuple, i: number }, TDataWithPosition]> |
Array<[{ kind: BlockType.Arr }, TDataWithPosition]> {
  return data.kind === BlockType.Dict
    ? Object.entries(data.contents).map(([key, v]) => [{ kind: BlockType.Dict, key }, v])
    : data.kind === BlockType.Arr
      ? data.contents.map(v => [{ kind: BlockType.Arr }, v])
      : data.contents.map((v, i) => [{ kind: BlockType.Tuple, i }, v])
}

// This disable is required to keep typescript happy
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type TDataBlockAsObject = TDataAsObject[] | { [k: string]: TDataAsObject }
type TDataAsObject = TDataBlockAsObject | string | number | boolean | [string, TDataBlockAsObject] | [string]

export function parseTDataToObject (data: TData | TDataWithPosition): TDataAsObject {
  switch (data.type) {
    case TDataType.Block:
      return parseTDataBlockToObject(data)
    case TDataType.Enum:
      return [data.enumKey, ...data.contents != null ? [parseTDataBlockToObject(data.contents)] : []]
    case TDataType.Primitive:
      return data.value
  }
}
function parseTDataBlockToObject (data: BlockData | BlockDataWithPosition): TDataAsObject {
  switch (data.kind) {
    case BlockType.Dict:
      return Object.fromEntries(Object.entries(data.contents).map(([key, value]) => [key, parseTDataToObject(value)]))
    case BlockType.Arr:
    case BlockType.Tuple:
      return data.contents.map(value => parseTDataToObject(value))
  }
}
