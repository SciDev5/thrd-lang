import { TextDocuments, type Diagnostic, type Connection, type Range } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { capabilities } from './capabilities'
import { type THRDServerSettings, globalSettings } from './settings'
import * as vsctm from 'vscode-textmate'
import { grammarPromise } from './grammar'
import { type IToken } from 'vscode-textmate'
import { StringSwitcher } from './util/StringSwitcher'
import { THRDTypeType, parse } from './THRDObject'

const documents = new TextDocuments(TextDocument)
let connection: Connection
export function bindDocuments (connectionToBind: Connection): void {
  connection = connectionToBind
  documents.onDidClose(e => {
    THRDDocument.close(e.document)
  })

  documents.onDidChangeContent(e => {
    THRDDocument.get(e.document).validate().catch(e => { throw e })
  })

  documents.listen(connection)
}

export enum Side {
  Begin,
  End,
}
export enum SurroundingPairType {
  Dict,
  Arr,
  Tuple,
  String,
}
export enum SeparatorType {
  KeyValue,
  List,
}
export enum PrimitiveValueType {
  Int,
  Float,
  Boolean,
}
export enum TokenType {
  PropertyKey,
  PrimitiveData,
  StringData,
  SurroundingPair,
  Separator,
  Ignored,
  Invalid,
}
export type TokenData = ({
  type: TokenType.SurroundingPair
  pair: SurroundingPairType
  side: Side
} | {
  type: TokenType.Separator
  separator: SeparatorType
} | {
  type: TokenType.PrimitiveData
  data: PrimitiveValueType
} | {
  type: TokenType.StringData
  isEscapeSequence?: boolean
} | {
  type: TokenType.PropertyKey | TokenType.Invalid | TokenType.Ignored
})

export class THRDToken {
  constructor (
    readonly line: string,
    readonly rawToken: IToken,
    readonly range: Range,
    readonly data: TokenData,
  ) {}

  get text (): string {
    return this.line.substring(this.rawToken.startIndex, this.rawToken.endIndex)
  }

  get isTextWhitespace (): boolean {
    return /^\s*$/.test(this.text)
  }

  private static wouldBeWhitespace (line: string, rawToken: IToken): boolean {
    return /^\s*$/.test(line.substring(rawToken.startIndex, rawToken.endIndex))
  }

  get isInvalid (): boolean {
    return this.data.type === TokenType.Invalid
  }

  get isIgnored (): boolean {
    return this.data.type === TokenType.Ignored
  }

  static from (line: string, lineNumber: number, rawToken: IToken): THRDToken {
    const scope = rawToken.scopes[rawToken.scopes.length - 1]

    const switcher = new StringSwitcher(scope)

    const data = switcher.switch<TokenData>({
      'variable.name.': () => ({ type: TokenType.PropertyKey }),
      'punctuation.separator.': () => ({
        type: TokenType.Separator,
        separator: switcher.switch({
          'keyValue.': () => SeparatorType.KeyValue,
          'list.': () => SeparatorType.List,
        }),
      }),
      'punctuation.block.': () => ({
        type: TokenType.SurroundingPair,
        // Begin must come first, because it comes first in the string
        side: switcher.switch({ 'begin.': () => Side.Begin, 'end.': () => Side.End }),
        pair: switcher.switch({ 'arr.': () => SurroundingPairType.Arr, 'dict.': () => SurroundingPairType.Dict, 'tuple.': () => SurroundingPairType.Tuple }),
      }),
      'punctuation.string.': () => ({
        type: TokenType.SurroundingPair,
        side: switcher.switch({ 'begin.': () => Side.Begin, 'end.': () => Side.End }),
        pair: SurroundingPairType.String,
      }),
      'constant.': () => (switcher.match('character.escape.string.')
        ? {
            type: TokenType.StringData,
            isEscapeSequence: true,
          }
        : {
            type: TokenType.PrimitiveData,
            data: switcher.switch({
              'numeric.integer.': () => PrimitiveValueType.Int,
              'numeric.float.': () => PrimitiveValueType.Float,
              'language.boolean.': () => PrimitiveValueType.Boolean,
            }),
          }),
      'string.': () => ({
        type: TokenType.StringData,
      }),
      'comment.': () => ({
        type: TokenType.Ignored,
      }),
    }, () => THRDToken.wouldBeWhitespace(line, rawToken) ? { type: TokenType.Ignored } : { type: TokenType.Invalid })

    return new THRDToken(line, rawToken, { start: { line: lineNumber, character: rawToken.startIndex }, end: { line: lineNumber, character: rawToken.endIndex } }, data)
  }
}

export class THRDDocument {
  private static readonly open = new Map<string, THRDDocument>()

  static close (document: TextDocument): void {
    this.open.delete(document.uri)
  }

  static get (document: TextDocument): THRDDocument {
    return this.open.get(document.uri) ?? new THRDDocument(document)
  }

  static all (): THRDDocument[] {
    return [...this.open.values()]
  }

  static refreshSettings (): void {
    for (const document of this.open.values()) {
      document._documentSettings = document.computeDocumentSettings()
    }
  }

  constructor (
    readonly document: TextDocument,
  ) {
    THRDDocument.open.set(document.uri, this)
    // TODO: lexing
  }

  private readonly tokens: THRDToken[][] = []
  // private readonly syntaxDiagnostics: Diagnostic[] = []

  private async lex (): Promise<void> {
    const grammar = await grammarPromise

    this.tokens.length = 0
    // this.syntaxDiagnostics.length = 0

    const lines = this.document.getText().split('\n')

    let ruleStack = vsctm.INITIAL
    for (const [line, lineNum] of lines.map((v, i) => [v, i] as const)) {
      const lineTokens = grammar.tokenizeLine(line, ruleStack)
      this.tokens.push([])
      for (const token of lineTokens.tokens) {
        this.tokens[this.tokens.length - 1].push(THRDToken.from(line, lineNum, token))
      }
      ruleStack = lineTokens.ruleStack
    }

    console.log(this.tokens.map(v => v.map(t => `\x1b[0;30;${t.isInvalid ? 101 : 47}m${t.text}\x1b[0m`).join(' ')).join('\n'))
  }

  private _documentSettings = this.computeDocumentSettings()
  private async computeDocumentSettings (): Promise<THRDServerSettings | null> {
    return capabilities.configuration
      ? await connection.workspace.getConfiguration({
        scopeUri: this.document.uri,
        section: 'thrdLanguageServer',
      })
      : null
  }

  get documentSettings (): Promise<THRDServerSettings> {
    return this._documentSettings.then(v => v ?? globalSettings())
  }

  private async computeDiagnostics (): Promise<Diagnostic[]> {
    const [,diagnostics] = parse(this.tokens, this.document.getText().split('\n'), { type: THRDTypeType.Primitive, which: PrimitiveValueType.Boolean })
    return diagnostics
    // return [
    //   {
    //     message: 'linter under construction',
    //     range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    //   },
    // ]
  }

  async validate (): Promise<void> {
    console.log('validate')

    await this.lex()
    await connection.sendDiagnostics({
      uri: this.document.uri,
      diagnostics: await this.computeDiagnostics(),
    })
  }
}
