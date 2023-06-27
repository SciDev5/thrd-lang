import { type TDocument, type TParsedDoc } from './TDocument'
import { DiagnosticTracker } from './linting/DiagnosticTracker'
import { parseTDataToObject } from './parsing/TData'
import { BlockType, SingleValueType } from './parsing/TToken'
import { TTypeSpecType, lintingTypeCheck, type BlockTypeSpec, type TTypeEnumSpec, type TTypeSpec, TypeResolutionIssue, BlockTypeExt } from './parsing/TTypeSpec'
import { Err, Ok, isOk, type Result, unwrapResult } from './util/Result'
import { IMPOSSIBLE } from './util/THROW'

export class TWorkspaceTypeIndex {
  readonly resolvableTypes = new Set<string>()
  readonly map = new Map<string, Result<TTypeSpec, TypeResolutionIssue>>()
  constructor (readonly declarationDocuments: Set<TDocument>) {}

  ready: Promise<void> = Promise.resolve()
  refresh (): void {
    this.map.clear()
    this.resolvableTypes.clear()
    this.ready = (async () => {
      const v = await Promise.all([...this.declarationDocuments.values()].map(async doc => {
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

        this.resolvableTypes.add(nameKey.type)
        return { parsedDoc, nameKey }
      }))
      this._TYPESPEC_SPEC = this.gen_TYPESPEC_SPEC()
      await Promise.all([...v.filter(v => v != null).map(v => v ?? IMPOSSIBLE()).map(async ({ parsedDoc, nameKey }) => {
        //
        if (!lintingTypeCheck(parsedDoc.data, this.TYPESPEC_SPEC, new DiagnosticTracker())) return null
        const parsed = this.parseDocAsTTypeSpec(parsedDoc)
        if (parsed == null) {
          this.map.set(nameKey.type, Err(TypeResolutionIssue.DefectiveDeclaration))
          return
        }

        this.map.set(nameKey.type, Ok(parsed))
      })])
    })()
  }

  resolve (typeName: string): Result<TTypeSpec, TypeResolutionIssue> {
    return this.map.get(typeName) ?? Err(TypeResolutionIssue.CouldNotFind)
  }

  parseDocAsTTypeSpec (doc: TParsedDoc): TTypeSpec | null {
    const p = parseTDataToObject(doc.data) as LoadedTypeObject
    return parseTTypeSpec(p, this)
  }

  private _TYPESPEC_SPEC: TTypeSpec = this.gen_TYPESPEC_SPEC()
  get TYPESPEC_SPEC (): TTypeSpec { return this._TYPESPEC_SPEC }
  private gen_TYPESPEC_SPEC (): TTypeSpec {
    const _mainSpecPlaceholder_: TTypeSpec = { type: TTypeSpecType.Enum, enumSpec: {} }

    const BLOCKTYPE_ENUM_SPEC = {
      dict: {
        kind: BlockTypeExt.DictRecord,
        contents: _mainSpecPlaceholder_,
      },
      array: {
        kind: BlockType.Tuple,
        contents: [
          _mainSpecPlaceholder_,
        ],
      },
      record: {
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

    const TYPESPEC_SPEC = {
      type: TTypeSpecType.Enum,
      enumSpec: {
        int: null,
        float: null,
        string: null,
        boolean: null,

        ref: {
          kind: BlockType.Tuple,
          contents: [
            {
              type: TTypeSpecType.Enum,
              enumSpec: Object.fromEntries([...this.resolvableTypes.values()].map(k => [k, null] satisfies [ string, null ])),
            },
          ],
        },

        enum: {
          // this should be array not tuple
          kind: BlockTypeExt.DictRecord,
          contents: {
            type: TTypeSpecType.Enum,
            enumSpec: {
              ...BLOCKTYPE_ENUM_SPEC,
              unit: null,
            },
          },
        },
        ...BLOCKTYPE_ENUM_SPEC,
      },
    } satisfies TTypeSpec

    BLOCKTYPE_ENUM_SPEC.dict.contents = TYPESPEC_SPEC
    BLOCKTYPE_ENUM_SPEC.array.contents[0] = TYPESPEC_SPEC
    BLOCKTYPE_ENUM_SPEC.tuple.contents = TYPESPEC_SPEC
    BLOCKTYPE_ENUM_SPEC.record.contents[0] = TYPESPEC_SPEC

    return TYPESPEC_SPEC
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
function parseTTypeSpec (data: LoadedTypeObject, typeIndex: TWorkspaceTypeIndex): TTypeSpec {
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
    case 'record':
    case 'tuple':
      return parseBlockTypeSpec(data, typeIndex)
    case 'enum':
      return {
        type: TTypeSpecType.Enum,
        enumSpec: Object.fromEntries(
          Object.entries(data[1]).map(([key, typeObject]) => [
            key,
            typeObject[0] === 'unit' ? null : parseBlockTypeSpec(typeObject, typeIndex),
          ]),
        ),
      }
    case 'ref':
      return {
        type: TTypeSpecType.Ref,
        refName: data[1][0].toString().trim(),
        ref () {
          const typ = typeIndex.resolve(data[1][0].toString().trim())
          console.log(typ)

          return isOk(typ) ? unwrapResult(typ) : { type: TTypeSpecType.Missing } satisfies TTypeSpec
        },
      }
    default:
      throw new TTypeDataFileTypeError()
  }
}

function parseBlockTypeSpec (data: LoadedBlockTypeObject, typeIndex: TWorkspaceTypeIndex): TTypeSpec & BlockTypeSpec {
  switch (data[0]) {
    case 'dict':
      return { type: TTypeSpecType.Block, kind: BlockType.Dict, contents: Object.fromEntries(Object.entries(data[1]).map(([key, typeObject]) => [key, parseTTypeSpec(typeObject, typeIndex)])) }
    case 'array':
      return { type: TTypeSpecType.Block, kind: BlockType.Arr, contents: parseTTypeSpec(data[1][0], typeIndex) }
    case 'tuple':
      return { type: TTypeSpecType.Block, kind: BlockType.Tuple, contents: data[1].map(typeObject => parseTTypeSpec(typeObject, typeIndex)) }
    case 'record':
      return { type: TTypeSpecType.Block, kind: BlockTypeExt.DictRecord, contents: parseTTypeSpec(data[1][0], typeIndex) }
  }
}

type LoadedBlockTypeObject = [
  'dict',
  Record<string, LoadedTypeObject>,
] | [
  'array',
  [LoadedTypeObject],
] | [
  'tuple',
  LoadedTypeObject[],
] | [
  'record',
  [LoadedTypeObject],
]

type LoadedTypeObject = [
  'int' | 'float' | 'boolean' | 'string',
] | [
  'ref', [ string ],
] | [
  'enum',
  Record<string, LoadedBlockTypeObject | [ 'unit' ]>,

] | LoadedBlockTypeObject
