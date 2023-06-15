import { CompletionItemKind, InsertTextFormat, type CompletionItem, type CompletionParams } from 'vscode-languageserver'
import { TDocument } from '../TDocument'
import { SourceFile } from '../TWorkspace'
import { type BlockDataWithPosition } from '../parsing/TData'
import { BlockType, SingleValueType } from '../parsing/TToken'
import { TTypeSpecType, type BlockTypeSpec, type TTypeSpec } from '../parsing/TTypeSpec'
import { isErr, unwrapResult } from '../util/Result'
import { IMPOSSIBLE } from '../util/THROW'
import { setSubtract } from '../util/set'
import { blockTrace, traceInsideBlock } from './trace'

export function handleOnCompletion (params: CompletionParams): CompletionItem[] {
  const completions: CompletionItem[] = []

  const doc = TDocument.getByUri(SourceFile.normalizeURI(params.textDocument.uri)) ?? null
  const parsedDoc = doc?.getParsedDoc() ?? null

  if (doc === null) {
    return []
  }
  if (parsedDoc == null) {
    const typeSpec = doc.getTypespecOrNullImmediate()
    if (typeSpec != null) {
      completions.push(...valueCompletion(typeSpec))
    }
    return completions
  }

  const topLevelTypeResult = parsedDoc.typeSpec

  if (topLevelTypeResult == null || isErr(topLevelTypeResult[1])) {
    return []
  }
  const topLevelType = unwrapResult(topLevelTypeResult[1])

  const trace = blockTrace(parsedDoc.data, topLevelType, params.position)

  if (trace == null) {
    completions.push(...valueCompletion(topLevelType))
    return completions
  }
  if (trace.typeTraceFail) {
    return []
  }

  const { nValuesBefore, justPassedKey } = traceInsideBlock(trace.data.d, params.position)

  completions.push(...blockCompletion(trace.data.d, trace.data.t, justPassedKey, nValuesBefore))

  return completions

  /*
<...> -> completion
| -> "tab-to" spot
/ -> completion "or"
// ... // -> something dynamicly generated

Examples:
{
    hel<lo: {|}>
}

[
    <true/false>
]

(
    3
    []
    <{|}>
)

:INT: <|>
:FLOAT: <|>
:BOOL: <true/false>
:STR: <"|">

:DICT:OUTER: <{|}>
:DICT:INNER: // tag + ": " + valueCompletion //
:ARR:OUTER: <[|]>
:ARR:INNER: // valueCompletion //
:TUPLE:OUTER: <(|)>
:TUPLE:INNER: // valueCompletion( based the number of complete value statements before ) //

:ENUM: // "#" + tag (+ " " + blockCompletion( :OUTER: ) )? //

  */
}

export function handleOnCompletionResolve (item: CompletionItem): CompletionItem {
//   item.detail = item.data
//   item.documentation = {
//     kind: MarkupKind.Markdown,
//     value: '# wah \n\n - cool `test` \n ```thrd\na: 432\n```',
//   }

  return item
}

function blockCompletion (data: BlockDataWithPosition, type: BlockTypeSpec, justPassedKey: string | undefined, nValuesBefore: number): CompletionItem[] {
  switch (data.kind) {
    case BlockType.Dict:
      if (type.kind !== BlockType.Dict) IMPOSSIBLE()
      if (justPassedKey != null) {
        // expect value
        const expectedType = type.contents[justPassedKey]
        if (expectedType != null) {
          return valueCompletion(expectedType)
        }
        return []
      } else {
        // expect key
        const missingKeys = setSubtract(new Set(Object.keys(type.contents)), new Set(Object.keys(data.contents)))
        const completions: CompletionItem[] = []
        for (const key of missingKeys) {
          completions.push(keyCompletion(key, type.contents[key]))
        }
        return completions
      }
    case BlockType.Arr:
      if (type.kind !== BlockType.Arr) IMPOSSIBLE()
      return valueCompletion(type.contents)
    case BlockType.Tuple: {
      if (type.kind !== BlockType.Tuple) IMPOSSIBLE()
      const expectedType = type.contents[nValuesBefore]
      if (expectedType != null) {
        return valueCompletion(expectedType)
      }
      return []
    }
    default: return []
  }
}

function keyCompletion (keyName: string, valueType: TTypeSpec): CompletionItem {
  return {
    label: `${keyName}`,
    insertText: `${keyName}: ` + (valueType.type === TTypeSpecType.Block ? blockTypeSnippetText(valueType.kind) : ''),
    insertTextFormat: InsertTextFormat.Snippet,
    kind: CompletionItemKind.Variable,
  }
}
function valueCompletion (valueType: TTypeSpec): CompletionItem[] {
  switch (valueType.type) {
    case TTypeSpecType.Block:
      return [{ label: blockTypeLabelText(valueType.kind), insertText: blockTypeSnippetText(valueType.kind), insertTextFormat: InsertTextFormat.Snippet, kind: CompletionItemKind.Snippet }]
    case TTypeSpecType.Primitive:
      return ({
        [SingleValueType.Boolean]: [{ label: 'true', kind: CompletionItemKind.Keyword }, { label: 'false', kind: CompletionItemKind.Keyword }],
        [SingleValueType.Int]: [],
        [SingleValueType.Float]: [],
        [SingleValueType.String]: [{ label: '" ... "', insertText: '"$0"', insertTextFormat: InsertTextFormat.Snippet, kind: CompletionItemKind.Snippet }],
      } satisfies { [v in SingleValueType]: CompletionItem[] })[valueType.which]
    case TTypeSpecType.Enum:
      return Object.keys(valueType.enumSpec).map(enumKey => {
        const enumSpecEnt = valueType.enumSpec[enumKey]
        return {
          label: `#${enumKey}`,
          insertText: `#${enumKey}${enumSpecEnt != null ? blockTypeSnippetText(enumSpecEnt.kind) : ''}`,
          kind: CompletionItemKind.EnumMember,
          insertTextFormat: InsertTextFormat.Snippet,
        }
      })
  }
}
function blockTypeSnippetText (blockType: BlockType): string {
  switch (blockType) {
    case BlockType.Dict: return '{$1}$0'
    case BlockType.Arr: return '[$1]$0'
    case BlockType.Tuple: return '($1)$0'
  }
}
function blockTypeLabelText (blockType: BlockType): string {
  switch (blockType) {
    case BlockType.Dict: return '{ ... }'
    case BlockType.Arr: return '[ ... ]'
    case BlockType.Tuple: return '( ... )'
  }
}
