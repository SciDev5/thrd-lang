import { type Range } from 'vscode-languageserver'

export enum TDataType {
  String,
  Boolean,
  Int,
  Float,
  Dict,
  Arr,
  Tuple,
}

export type TData = {
  type: TDataType.String
  value: string
} | {
  type: TDataType.Boolean
  value: boolean
} | {
  type: TDataType.Float | TDataType.Int
  value: number
} | {
  type: TDataType.Dict
  value: Record<string, TData>
  enumKey?: string
} | {
  type: TDataType.Arr | TDataType.Tuple
  value: TData[]
  enumKey?: string
}

export type TDataWithPosition = ({
  type: TDataType.String
  value: string
} | {
  type: TDataType.Boolean
  value: boolean
} | {
  type: TDataType.Float | TDataType.Int
  value: number
} | {
  type: TDataType.Dict
  keyRanges: Record<string, Range>
  value: Record<string, TDataWithPosition>
  enumKey?: string
} | {
  type: TDataType.Arr | TDataType.Tuple
  value: TDataWithPosition[]
  enumKey?: string
}) & { range: Range }

export function stripPositionInfoFromData (data: TDataWithPosition): TData {
  switch (data.type) {
    case TDataType.String:
    case TDataType.Int:
    case TDataType.Float:
    case TDataType.Boolean: {
      const data_: TData & { range?: Range, keyRanges?: Record<string, Range> } = { ...data }
      delete data_.range
      delete data_.keyRanges
      return data_
    }

    case TDataType.Dict:
      return { type: data.type, value: Object.fromEntries(Object.entries(data.value).map(([k, v]) => [k, stripPositionInfoFromData(v)])) }
    case TDataType.Arr:
    case TDataType.Tuple:
      return { type: data.type, value: data.value.map(v => stripPositionInfoFromData(v)) }
  }
}
