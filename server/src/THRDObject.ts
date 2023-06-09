import { type PrimitiveValueType } from './parsing/TToken'

enum THRDValueType {
  String,
  Boolean,
  Int,
  Float,
  Dict,
  Arr,
  Tuple,
}

export type THRDData = {
  type: THRDValueType.String
  value: string
} | {
  type: THRDValueType.Boolean
  value: boolean
} | {
  type: THRDValueType.Float | THRDValueType.Int
  value: number
} | {
  type: THRDValueType.Dict
  value: Record<string, THRDData>
} | {
  type: THRDValueType.Arr | THRDValueType.Tuple
  value: THRDData[]
}
export enum THRDTypeType {
  String,
  Primitive,
  Array,
  Dict,
  Tuple,
}

export type THRDType = {
  type: THRDTypeType.String
} | {
  type: THRDTypeType.Primitive
  which: PrimitiveValueType
} | {
  type: THRDTypeType.Dict
  contents: Record<string, THRDType>
} | {
  type: THRDTypeType.Array
  contents: THRDType
} | {
  type: THRDTypeType.Tuple
  contents: THRDType[]
}
