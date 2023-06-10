import { BlockType, SingleValueType } from './parsing/TToken'
import { type TTypeSpec, TTypeSpecType } from './parsing/TTypeSpec'

export const TEST_TYPE: TTypeSpec = {
  type: TTypeSpecType.Block,
  kind: BlockType.Dict,
  contents: {
    a: {
      type: TTypeSpecType.Primitive,
      which: SingleValueType.Float,
    },
    b: {
      type: TTypeSpecType.Block,
      kind: BlockType.Arr,
      contents: {
        type: TTypeSpecType.Primitive,
        which: SingleValueType.Int,
      },
    },
    c: {
      type: TTypeSpecType.Block,
      kind: BlockType.Tuple,
      contents: [
        {
          type: TTypeSpecType.Primitive,
          which: SingleValueType.Int,
        }, {
          type: TTypeSpecType.Primitive,
          which: SingleValueType.Float,
        }, {
          type: TTypeSpecType.Primitive,
          which: SingleValueType.String,
        },
      ],
    },
    d: {
      type: TTypeSpecType.Block,
      kind: BlockType.Arr,
      contents: {
        type: TTypeSpecType.Enum,
        enumSpec: {
          Hello: {
            kind: BlockType.Tuple,
            contents: [
              {
                type: TTypeSpecType.Primitive,
                which: SingleValueType.Int,
              },
            ],
          },
          World: {
            kind: BlockType.Arr,
            contents: {
              type: TTypeSpecType.Primitive,
              which: SingleValueType.String,
            },
          },
          Unit: null,
        },
      },
    },
  },
}
