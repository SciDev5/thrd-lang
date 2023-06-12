import { type TDocument, type TParsedDoc } from './TDocument'
import { DiagnosticTracker } from './linting/DiagnosticTracker'
import { parseTDataToObject } from './parsing/TData'
import { BlockType, SingleValueType } from './parsing/TToken'
import { TTypeSpecType, lintingTypeCheck, type BlockTypeSpec, type TTypeEnumSpec, type TTypeSpec, TypeResolutionIssue } from './parsing/TTypeSpec'
import { Err, Ok, type Result } from './util/Result'

export class TWorkspaceTypeIndex {
  readonly map = new Map<string, Result<TTypeSpec, TypeResolutionIssue>>()
  constructor (readonly declarationDocuments: Set<TDocument>) {}

  ready: Promise<void> = Promise.resolve()
  refresh (): void {
    this.map.clear()
    this.ready = (async () => {
      await Promise.all([...this.declarationDocuments.values()].map(async doc => {
        doc.refreshParse()
        const nameKey = doc.nameKey
        if (nameKey == null) return

        if (this.map.has(nameKey.type)) {
          this.map.set(nameKey.type, Err(TypeResolutionIssue.ConflictingDeclarations))
          return
        }
        const parsedDoc = doc.getParsedDoc()
        if (parsedDoc == null) {
          this.map.set(nameKey.type, Err(TypeResolutionIssue.DefectiveDeclaration))
          return
        }
        const parsed = TWorkspaceTypeIndex.parseDocAsTTypeSpec(parsedDoc)
        if (parsed == null) {
          this.map.set(nameKey.type, Err(TypeResolutionIssue.DefectiveDeclaration))
          return
        }

        this.map.set(nameKey.type, Ok(parsed))
      }))
    })()
  }

  static parseDocAsTTypeSpec (doc: TParsedDoc): TTypeSpec | null {
    if (!lintingTypeCheck(doc.data, TYPESPEC_SPEC, new DiagnosticTracker())) return null
    const p = parseTDataToObject(doc.data) as LoadedTypeObject
    return parseTTypeSpec(p)
  }
}

class TTypeDataFileTypeError extends Error {
  constructor () {
    super('TTypeSpec file type did not match expected even after check.')
  }
}

/**
 * Parse a TTypeSpec from a TData
 *
 * This function expects it to already match the format, and will give unexpected results or throw if unexpected data is thrown in
 */
function parseTTypeSpec (data: LoadedTypeObject): TTypeSpec {
  switch (data[0]) {
    case 'int':
      return { type: TTypeSpecType.Primitive, which: SingleValueType.Int }
    case 'float':
      return { type: TTypeSpecType.Primitive, which: SingleValueType.Float }
    case 'boolean':
      return { type: TTypeSpecType.Primitive, which: SingleValueType.Boolean }
    case 'string':
      return { type: TTypeSpecType.Primitive, which: SingleValueType.String }

    case 'dict':
    case 'array':
    case 'tuple':
      return parseBlockTypeSpec(data)
    case 'enum':
      return {
        type: TTypeSpecType.Enum,
        enumSpec: Object.fromEntries(
          data[1].map(([key, typeObject]) => [
            key,
            typeObject[0] === 'unit' ? null : parseBlockTypeSpec(typeObject),
          ]),
        ),
      }
    default:
      throw new TTypeDataFileTypeError()
  }
}

function parseBlockTypeSpec (data: LoadedBlockTypeObject): TTypeSpec & BlockTypeSpec {
  switch (data[0]) {
    case 'dict':
      return { type: TTypeSpecType.Block, kind: BlockType.Dict, contents: Object.fromEntries(data[1].map(([key, typeObject]) => [key, parseTTypeSpec(typeObject)])) }
    case 'array':
      return { type: TTypeSpecType.Block, kind: BlockType.Arr, contents: parseTTypeSpec(data[1][0]) }
    case 'tuple':
      return { type: TTypeSpecType.Block, kind: BlockType.Tuple, contents: data[1].map(typeObject => parseTTypeSpec(typeObject)) }
  }
}

type LoadedBlockTypeObject = [
  'dict',
  Array<[ string, LoadedTypeObject ]>,
] | [
  'array',
  [LoadedTypeObject],
] | [
  'tuple',
  LoadedTypeObject[],
]

type LoadedTypeObject = [
  'int' | 'float' | 'boolean' | 'string',
] | [
  'enum',
  Array<[ string, LoadedBlockTypeObject | [ 'unit' ]]>,

] | LoadedBlockTypeObject

const _mainSpecPlaceholder_: TTypeSpec = { type: TTypeSpecType.Enum, enumSpec: {} }

const BLOCKTYPE_ENUM_SPEC = {
  dict: {
    kind: BlockType.Arr,
    contents: {
      type: TTypeSpecType.Block,
      kind: BlockType.Tuple,
      contents: [
        {
          type: TTypeSpecType.Primitive,
          which: SingleValueType.String,
        },
        _mainSpecPlaceholder_,
      ],
    },
  },
  array: {
    kind: BlockType.Tuple,
    contents: [
      _mainSpecPlaceholder_,
    ],
  },
  tuple: {
    kind: BlockType.Arr,
    contents: _mainSpecPlaceholder_,
  },
} satisfies TTypeEnumSpec

export const TYPESPEC_SPEC = {
  type: TTypeSpecType.Enum,
  enumSpec: {
    int: null,
    float: null,
    string: null,
    boolean: null,

    enum: {
    // this should be array not tuple
      kind: BlockType.Arr,
      contents: {
        type: TTypeSpecType.Block,
        kind: BlockType.Tuple,
        contents: [
          {
            type: TTypeSpecType.Primitive,
            which: SingleValueType.String,
          },
          {
            type: TTypeSpecType.Enum,
            enumSpec: {
              ...BLOCKTYPE_ENUM_SPEC,
              unit: null,
            },
          },
        ],
      },
    },
    ...BLOCKTYPE_ENUM_SPEC,
  },
} satisfies TTypeSpec

BLOCKTYPE_ENUM_SPEC.dict.contents.contents[1] = TYPESPEC_SPEC
BLOCKTYPE_ENUM_SPEC.array.contents[0] = TYPESPEC_SPEC
BLOCKTYPE_ENUM_SPEC.tuple.contents = TYPESPEC_SPEC
