import { type PrimitiveValueType } from './TToken'

export enum TTypeSpecType {
  String,
  Primitive,
  Array,
  Dict,
  Tuple,
}

export type TTypeSpec = {
  type: TTypeSpecType.String
} | {
  type: TTypeSpecType.Primitive
  which: PrimitiveValueType
} | {
  type: TTypeSpecType.Dict
  contents: Record<string, TTypeSpec>
} | {
  type: TTypeSpecType.Array
  contents: TTypeSpec
} | {
  type: TTypeSpecType.Tuple
  contents: TTypeSpec[]
}
