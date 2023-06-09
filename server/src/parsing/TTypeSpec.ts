import { type Range } from 'vscode-languageserver'
import { IMPOSSIBLE } from '../util/THROW'
import { setAnd, setXOR } from '../util/set'
import { TDiagnostic, type DiagnosticTracker } from './DiagnosticTracker'
import { TDataType, type TDataWithPosition } from './TData'
import { BlockType, SingleValueType } from './TToken'

export enum TTypeSpecType {
  Primitive,
  Block,
}

export type TTypeSpec = {
  type: TTypeSpecType.Primitive
  which: SingleValueType
} | ({
  type: TTypeSpecType.Block
} & BlockTypeSpec) | {
  type: TTypeSpecType.Block
  enumSpec: TTypeEnumSpec
}

export type TTypeEnumSpec = Record<string, BlockTypeSpec>

type BlockTypeSpec = {
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

function typeName (type: TTypeSpec): string {
  switch (type.type) {
    case TTypeSpecType.Block:
      if ('enumSpec' in type) {
        return Object.keys(type.enumSpec).join(' | ')
      } else if ('kind' in type) {
        return blockTypeName(type)
      } else {
        return IMPOSSIBLE()
      }
    case TTypeSpecType.Primitive:
      return primitiveTypeName(type.which)
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
    received: TDataWithPosition & { type: TDataType.Dict },
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

export function lintingTypeCheck (data: TDataWithPosition, type: TTypeSpec, diagnostics: DiagnosticTracker): boolean {
  switch (data.type) {
    case TDataType.Boolean:
    case TDataType.Int:
    case TDataType.Float:
    case TDataType.String: {
      const dataWhich = ({
        [TDataType.Boolean]: SingleValueType.Boolean,
        [TDataType.Int]: SingleValueType.Int,
        [TDataType.Float]: SingleValueType.Float,
        [TDataType.String]: SingleValueType.String,
      } satisfies { [v in typeof data['type']]: SingleValueType })[data.type]
      if (type.type === TTypeSpecType.Primitive) {
        if (dataWhich === type.which) {
          return true
        } else {
          // Found wrong primitive
          diagnostics.add(new TypeMismatchTypeDiagnostic(
            data.range,
            primitiveTypeName(type.which),
            primitiveTypeName(dataWhich),
          ))
          return false
        }
      } else {
        // Found primitive, expected block
        diagnostics.add(new TypeMismatchTypeDiagnostic(
          data.range,
          typeName(type),
          primitiveTypeName(dataWhich),
        ))
        return false
      }
    }
    case TDataType.Arr:
    case TDataType.Tuple:
    case TDataType.Dict: {
      const dataKind = ({
        [TDataType.Dict]: BlockType.Dict,
        [TDataType.Arr]: BlockType.Arr,
        [TDataType.Tuple]: BlockType.Tuple,
      } satisfies { [v in typeof data['type']]: BlockType })[data.type]

      if (type.type === TTypeSpecType.Block) {
        const receivedEnumKey = data.enumKey
        let expectedType_: BlockTypeSpec
        if ('enumSpec' in type) {
          const { enumSpec } = type
          if (receivedEnumKey === undefined) {
            // Was expecting to receive enum key, but none is present
            diagnostics.add(new EnumExpectedTypeDiagnostic(
              data,
              enumSpec,
            ))
            return false
          }
          if (!(receivedEnumKey in enumSpec)) {
            // The enum key received was not a valid option
            diagnostics.add(new EnumOptionUnavailableTypeDiagnostic(
              data,
              receivedEnumKey,
              enumSpec,
            ))
            return false
          }
          expectedType_ = enumSpec[receivedEnumKey]
        } else if ('kind' in type) {
          const enumKey = data.enumKey
          if (enumKey !== undefined) {
            // Was not expecting an enum key, but received one anyway
            diagnostics.add(new EnumUnexpectedTypeDiagnostic(
              data,
              enumKey,
              dataKind,
              type,
            ))
            return false
          }
          expectedType_ = type
        } else {
          IMPOSSIBLE()
        }
        const expectedType = expectedType_

        if (dataKind !== expectedType.kind) {
          // Found wrong kind of block
          diagnostics.add(new TypeMismatchTypeDiagnostic(
            data.range,
            blockTypeName(expectedType),
            blockTypeKindName(dataKind),
          ))
          return false
        }

        switch (data.type) {
          case TDataType.Arr:{
            if (expectedType.kind !== BlockType.Arr) IMPOSSIBLE()
            let allOk = true
            for (const elt of data.value) {
              const ok = lintingTypeCheck(elt, expectedType.contents, diagnostics)
              allOk &&= ok
            }
            return allOk
          }
          case TDataType.Tuple: {
            if (expectedType.kind !== BlockType.Tuple) IMPOSSIBLE()
            const nExpected = expectedType.contents.length
            const nData = data.value.length
            if (nData > nExpected) {
              // Received too many elements into tuple
              diagnostics.add(new TupleTooManyEltsTypeDiagnostic(expectedType.contents, data.value))
            }
            if (nData < nExpected) {
              // Received too few elements into tuple
              diagnostics.add(new TupleTooFewEltsTypeDiagnostic(expectedType.contents, data.value, data.range))
            }
            let allOk = true
            for (let i = 0; i < Math.min(nData, nExpected); i++) {
              const ok = lintingTypeCheck(data.value[i], expectedType.contents[i], diagnostics)
              allOk &&= ok
            }
            return allOk
          }
          case TDataType.Dict: {
            if (expectedType.kind !== BlockType.Dict) IMPOSSIBLE()
            const keysExpected = new Set(Object.keys(expectedType.contents))
            const keysData = new Set(Object.keys(data.value))
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
                  expectedType,
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
              const ok = lintingTypeCheck(data.value[key], expectedType.contents[key], diagnostics)
              allOk &&= ok
            }
            return allOk
          }
        }
      } else {
        // Found block, expected primitive
        diagnostics.add(new TypeMismatchTypeDiagnostic(
          data.range,
          primitiveTypeName(type.which),
          blockTypeKindName(dataKind),
        ))
        return false
      }
    }
  }
}
