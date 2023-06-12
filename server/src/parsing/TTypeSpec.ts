import { type Range } from 'vscode-languageserver'
import { TDiagnostic, type DiagnosticTracker } from '../linting/DiagnosticTracker'
import { IMPOSSIBLE } from '../util/THROW'
import { setAnd, setXOR } from '../util/set'
import { TDataType, type TDataWithPosition } from './TData'
import { BlockType, SingleValueType } from './TToken'
import { type Result, isErr } from '../util/Result'

export enum TTypeSpecType {
  Primitive,
  Enum,
  Block,
}

export type TTypeSpec = {
  type: TTypeSpecType.Primitive
  which: SingleValueType
} | ({
  type: TTypeSpecType.Block
} & BlockTypeSpec) | {
  type: TTypeSpecType.Enum
  enumSpec: TTypeEnumSpec
}

export type TTypeEnumSpec = Record<string, BlockTypeSpec | null>

export type BlockTypeSpec = {
  kind: BlockType.Dict
  contents: Record<string, TTypeSpec>
} | {
  kind: BlockType.Arr
  contents: TTypeSpec
} | {
  kind: BlockType.Tuple
  contents: TTypeSpec[]
}

function primitiveTypeName (type: SingleValueType): string {
  return ({
    [SingleValueType.Boolean]: 'boolean',
    [SingleValueType.String]: 'string',
    [SingleValueType.Float]: 'float',
    [SingleValueType.Int]: 'int',
  } satisfies { [T in SingleValueType]: string })[type]
}

function blockTypeName (type: BlockTypeSpec): string {
  return ({
    [BlockType.Arr]: (type) => '<array>',
    [BlockType.Dict]: (type) => '<dict>',
    [BlockType.Tuple]: (type) => '<tuple>',
  } satisfies { [T in BlockType]: (v: BlockTypeSpec & { kind: T }) => string })[type.kind](type as any)
}

function blockTypeKindName (type: BlockType): string {
  return ({
    [BlockType.Arr]: '<array>',
    [BlockType.Dict]: '<dict>',
    [BlockType.Tuple]: '<tuple>',
  } satisfies { [T in BlockType]: string })[type]
}

export function typeName (type: TTypeSpec): string {
  switch (type.type) {
    case TTypeSpecType.Enum:
      return Object.keys(type.enumSpec).join(' | ')
    case TTypeSpecType.Block:
      return blockTypeName(type)
    case TTypeSpecType.Primitive:
      return primitiveTypeName(type.which)
  }
}

class TypeResolutionIssueTypeDiagnostic extends TDiagnostic {
  constructor (
    data: TDataWithPosition,
    type: TypeResolutionIssue,
    typeName: string,
  ) {
    super({
      message: ({
        [TypeResolutionIssue.CouldNotFind]: `No type declarations found for "${typeName}", try defining a file named "${typeName}.thrdspec"`,
        [TypeResolutionIssue.ConflictingDeclarations]: `More than one type declaration found for "${typeName}"`,
        [TypeResolutionIssue.DefectiveDeclaration]: `Type definition file for document type "${typeName}" has errors and cannot be parsed`,
        [TypeResolutionIssue.ReferenceInvalid]: `File name format incorrect.\n - Expected to match /^(.*?\\.)?\\w+\\.thrd$/'\n - Found "${typeName}"`,
      } satisfies { [key in TypeResolutionIssue]: string })[type],
      range: { start: data.range.start, end: data.range.start },
    })
  }
}

class TypeMismatchTypeDiagnostic extends TDiagnostic {
  constructor (
    range: Range,
    expected: string,
    found: string,
  ) {
    super({
      message: `Type mismatch:\n - Expected: ${expected}\n - Found: ${found}`,
      range,
    })
  }
}

class TupleTooManyEltsTypeDiagnostic extends TDiagnostic {
  constructor (
    expected: TTypeSpec[],
    received: TDataWithPosition[],
  ) {
    super({
      message: `Too many elements in tuple.\n - Expected: (${expected.map(typeName).join(', ')})`,
      range: {
        start: received[expected.length].range.start,
        end: received[received.length - 1].range.end,
      },
    })
  }
}
class TupleTooFewEltsTypeDiagnostic extends TDiagnostic {
  constructor (
    expected: TTypeSpec[],
    received: TDataWithPosition[],
    tupleBlockRange: Range,
  ) {
    super({
      message: `Missing elements from tuple.\n - Expected: (${received.length > 0 ? '... ' : ''}${expected.slice(received.length).map(typeName).join(', ')})`,
      range: {
        start: received[received.length - 1]?.range?.end ?? tupleBlockRange.start,
        end: tupleBlockRange.end,
      },
    })
  }
}

class DictUnexpectedPropertyTypeDiagnostic extends TDiagnostic {
  constructor (
    received: { keyRanges: Record<string, Range> },
    key: string,
  ) {
    super({
      message: `Unexpected property "${key}"`,
      range: received.keyRanges[key],
    })
  }
}
class DictMissingPropertyTypeDiagnostic extends TDiagnostic {
  constructor (
    received: TDataWithPosition,
    expected: BlockTypeSpec & { kind: BlockType.Dict },
    keys: Set<string>,
  ) {
    const expectedEntries = [...keys].map(key => `  ${key}: ${typeName(expected.contents[key])}`).join('\n')
    super({
      message: `Missing properties from dict.\n - Expected: {\n  ...\n${expectedEntries}\n}`,
      range: received.range,
    })
  }
}

class EnumExpectedTypeDiagnostic extends TDiagnostic {
  constructor (
    receivedValue: TDataWithPosition,
    enumSpec: TTypeEnumSpec,
  ) {
    super({
      message: `Expected enum value.\n - Expected: ${Object.keys(enumSpec).join(' | ')}`,
      range: receivedValue.range,
    })
  }
}
class EnumUnexpectedTypeDiagnostic extends TDiagnostic {
  constructor (
    receivedValue: TDataWithPosition,
    enumKey: string,
    dataKind: BlockType,
    type: TTypeSpec,
  ) {
    super({
      message: `Not expecting enum type.\n - Expected: ${typeName(type)}\n - Received: ${enumKey}${blockTypeKindName(dataKind)}`,
      range: receivedValue.range,
    })
  }
}
class EnumOptionUnavailableTypeDiagnostic extends TDiagnostic {
  constructor (
    receivedValue: TDataWithPosition,
    receivedEnumKey: string,
    enumSpec: TTypeEnumSpec,
  ) {
    super({
      message: `Enum key "${receivedEnumKey}" is not an option.\n - Expected: ${Object.keys(enumSpec).join(' | ')}\n - Received: ${receivedEnumKey}`,
      range: receivedValue.range,
    })
  }
}

export enum TypeResolutionIssue {
  CouldNotFind,
  ConflictingDeclarations,
  DefectiveDeclaration,
  ReferenceInvalid,
}

export function lintingTypeCheckOrTypeFindingError (
  data: TDataWithPosition,
  [typeName, type]: [string, Result<TTypeSpec, TypeResolutionIssue>],
  diagnostics: DiagnosticTracker,
): boolean {
  if (isErr(type)) { // Enums are represented internally as number, this selects for the `TypeResolutionIssue` enum
    diagnostics.add(new TypeResolutionIssueTypeDiagnostic(data, type[1], typeName))
    return false
  } else {
    return lintingTypeCheck(data, type[0], diagnostics)
  }
}

export function lintingTypeCheck (data: TDataWithPosition, type: TTypeSpec, diagnostics: DiagnosticTracker): boolean {
  switch (data.type) {
    case TDataType.Primitive:
      if (type.type === TTypeSpecType.Primitive) {
        if (data.which === type.which) {
          return true
        } else {
          // Found wrong primitive
          diagnostics.add(new TypeMismatchTypeDiagnostic(
            data.range,
            primitiveTypeName(type.which),
            primitiveTypeName(data.which),
          ))
          return false
        }
      } else {
        // Found block, expected something else
        diagnostics.add(new TypeMismatchTypeDiagnostic(
          data.range,
          typeName(type),
          primitiveTypeName(data.which),
        ))
        return false
      }
    case TDataType.Block:
      if (type.type === TTypeSpecType.Block) {
        if (data.kind !== type.kind) {
          // Found wrong kind of block
          diagnostics.add(new TypeMismatchTypeDiagnostic(
            data.range,
            blockTypeName(type),
            blockTypeKindName(data.kind),
          ))
          return false
        }

        switch (data.kind) {
          case BlockType.Arr:{
            if (type.kind !== BlockType.Arr) IMPOSSIBLE()
            let allOk = true
            for (const elt of data.contents) {
              const ok = lintingTypeCheck(elt, type.contents, diagnostics)
              allOk &&= ok
            }
            return allOk
          }
          case BlockType.Tuple: {
            if (type.kind !== BlockType.Tuple) IMPOSSIBLE()
            const nExpected = type.contents.length
            const nData = data.contents.length
            let allOk = true
            if (nData > nExpected) {
              // Received too many elements into tuple
              diagnostics.add(new TupleTooManyEltsTypeDiagnostic(type.contents, data.contents))
              allOk = false
            }
            if (nData < nExpected) {
              // Received too few elements into tuple
              diagnostics.add(new TupleTooFewEltsTypeDiagnostic(type.contents, data.contents, data.range))
              allOk = false
            }
            for (let i = 0; i < Math.min(nData, nExpected); i++) {
              const ok = lintingTypeCheck(data.contents[i], type.contents[i], diagnostics)
              allOk &&= ok
            }
            return allOk
          }
          case BlockType.Dict: {
            if (type.kind !== BlockType.Dict) IMPOSSIBLE()
            const keysExpected = new Set(Object.keys(type.contents))
            const keysData = new Set(Object.keys(data.contents))
            const keysDataLoose = new Set(Object.keys(data.keyRanges))

            const mismatched = setXOR(keysExpected, keysDataLoose)

            let allOk = true
            if (mismatched.size !== 0) {
              const unexpected = setAnd(mismatched, keysData)
              const missing = setAnd(mismatched, keysExpected)

              if (missing.size > 0) {
                // There are missing properties
                diagnostics.add(new DictMissingPropertyTypeDiagnostic(
                  data,
                  type,
                  missing,
                ))
              }
              for (const key of unexpected) {
                // There are extra properties
                diagnostics.add(new DictUnexpectedPropertyTypeDiagnostic(
                  data,
                  key,
                ))
              }
              allOk = false
            }

            for (const key of setAnd(keysExpected, keysData)) {
              const ok = lintingTypeCheck(data.contents[key], type.contents[key], diagnostics)
              allOk &&= ok
            }
            return allOk
          }
          default:
            return IMPOSSIBLE()
        }
      } else if (type.type === TTypeSpecType.Enum) {
        // Was expecting to receive enum key, but none is present
        diagnostics.add(new EnumExpectedTypeDiagnostic(
          data,
          type.enumSpec,
        ))
        return false
      } else {
        // Found primitive, expected something else
        diagnostics.add(new TypeMismatchTypeDiagnostic(
          data.range,
          typeName(type),
          blockTypeKindName(data.kind),
        ))
        return false
      }
    case TDataType.Enum:
      if (type.type === TTypeSpecType.Enum) {
        if (!(data.enumKey in type.enumSpec)) {
          // The enum key received was not a valid option
          diagnostics.add(new EnumOptionUnavailableTypeDiagnostic(
            data,
            data.enumKey,
            type.enumSpec,
          ))
          return false
        }

        const enumSpec = type.enumSpec[data.enumKey]
        const { contents } = data
        if (enumSpec === null) {
          if (contents === undefined) {
            return true
          } else {
            // Found structured, expected unit
            diagnostics.add(new TypeMismatchTypeDiagnostic(
              data.range,
              '<unit>',
              blockTypeKindName(contents.kind),
            ))
            return false
          }
        } else {
          if (contents === undefined) {
            // Found unit, expected structured
            diagnostics.add(new TypeMismatchTypeDiagnostic(
              data.range,
              blockTypeKindName(enumSpec.kind),
              '<unit>',
            ))
            return false
          } else {
            return lintingTypeCheck({ type: TDataType.Block, ...contents, tokenRange: data.tokenRange }, { type: TTypeSpecType.Block, ...enumSpec }, diagnostics)
          }
        }
      } else if (type.type === TTypeSpecType.Block && data.contents !== undefined) {
        // Was not expecting an enum key, but received one anyway
        diagnostics.add(new EnumUnexpectedTypeDiagnostic(
          data,
          data.enumKey,
          data.contents.kind,
          type,
        ))
        return false
      } else {
        // Found enum, expected something else
        diagnostics.add(new TypeMismatchTypeDiagnostic(
          data.range,
          typeName(type),
          data.enumKey,
        ))
        return false
      }
  }
}
