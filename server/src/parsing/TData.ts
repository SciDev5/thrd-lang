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
} | {
  type: TDataType.Arr | TDataType.Tuple
  value: TData[]
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
  value: Record<string, TDataWithPosition>
} | {
  type: TDataType.Arr | TDataType.Tuple
  value: TDataWithPosition[]
}) & { range: Range }

export function stripPositionInfoFromData (data: TDataWithPosition): TData {
  switch (data.type) {
    case TDataType.String:
    case TDataType.Int:
    case TDataType.Float:
    case TDataType.Boolean:
      return data

    case TDataType.Dict:
      return { type: data.type, value: Object.fromEntries(Object.entries(data.value).map(([k, v]) => [k, stripPositionInfoFromData(v)])) }
    case TDataType.Arr:
    case TDataType.Tuple:
      return { type: data.type, value: data.value.map(v => stripPositionInfoFromData(v)) }
  }
}
