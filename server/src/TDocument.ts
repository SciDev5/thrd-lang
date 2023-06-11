import { CodeAction, CodeActionKind, TextDocuments, type Connection, type Position } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TEST_TYPE } from './TEST_TYPE'
import { capabilities } from './capabilities'
import { DiagnosticTracker } from './linting/DiagnosticTracker'
import { whitespaceLint } from './linting/whitespaceLint'
import { type TDataWithPosition } from './parsing/TData'
import { TToken } from './parsing/TToken'
import { lintingTypeCheck, type TTypeSpec } from './parsing/TTypeSpec'
import { parse } from './parsing/parse'
import { globalSettings, type THRDServerSettings } from './settings'
import { positionIsInRange } from './util/range'

const documents = new TextDocuments(TextDocument)
let connection: Connection
export function bindDocuments (connectionToBind: Connection): void {
  connection = connectionToBind
  documents.onDidClose(e => {
    TDocument.close(e.document)
  })

  documents.onDidChangeContent(e => {
    const doc = TDocument.get(e.document)
    doc.notifyDidChangeContent()
    doc.validateAndSend().catch(e => { throw e })
  })

  documents.listen(connection)
}

export type Lines = string[]
export class TParsedDoc {
  readonly typeDiagnostics = new DiagnosticTracker()
  constructor (
    readonly lines: Lines,
    readonly tokens: TToken[],
    readonly data: TDataWithPosition,
    readonly typeSpec: TTypeSpec,
  ) {
    lintingTypeCheck(this.data, typeSpec, this.typeDiagnostics)
  }

  tokenAt (pos: Position): number {
    let tokenI = 0
    for (; tokenI < this.tokens.length - 1; tokenI++) {
      if (positionIsInRange(pos, this.tokens[tokenI].range)) {
        break
      }
    }
    return tokenI
  }
}

export class TDocument {
  private static readonly open = new Map<string, TDocument>()

  static close (document: TextDocument): void {
    this.open.delete(document.uri)
  }

  static get (document: TextDocument): TDocument {
    return this.open.get(document.uri) ?? new TDocument(document)
  }

  static getByUri (uri: string): TDocument | null {
    return this.open.get(uri) ?? null
  }

  static all (): TDocument[] {
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
    TDocument.open.set(document.uri, this)
    this.parsed = this.parse()
  }

  private parsed: Promise<[TParsedDoc | null, DiagnosticTracker]>
  private parsedResolved: TParsedDoc | null = null
  private allDiagnostics = new DiagnosticTracker()
  private async parse (): Promise<[TParsedDoc | null, DiagnosticTracker]> {
    const syntaxDiagnosticTracker = new DiagnosticTracker()

    const lines = this.document.getText().split('\n')
    const tokens = await TToken.lex(lines)
    const data = await parse(tokens, syntaxDiagnosticTracker)

    const doc = data !== null
      ? new TParsedDoc(lines, tokens, data, TEST_TYPE)
      : null

    this.parsedResolved = doc
    return [
      doc,
      syntaxDiagnosticTracker,
    ]
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

  notifyDidChangeContent (): void {
    // refresh the document content
    this.parsed = this.parse()
  }

  async validateAndSend (): Promise<void> {
    const diagnostics = new DiagnosticTracker()

    const [parsedDoc, syntaxDiagnostics] = await this.parsed
    diagnostics.mergeIn(syntaxDiagnostics)

    // console.log('DOC', parsedDoc)

    console.log('H', parsedDoc !== null)

    if (parsedDoc !== null) {
      diagnostics.mergeIn(parsedDoc.typeDiagnostics)

      whitespaceLint(parsedDoc, diagnostics)
    }

    this.allDiagnostics = diagnostics
    await connection.sendDiagnostics({
      uri: this.document.uri,
      diagnostics: diagnostics.collectDiagnostcis(),
    })
  }

  generateSourceFixAllCodeAction (): CodeAction {
    return CodeAction.create('Fix all auto-fixable issues', {
      changes: {
        [this.document.uri]: this.allDiagnostics.collectAutoFixes(),
      },
    }, CodeActionKind.SourceFixAll)
  }

  /**
   * Get the parsed data for this document.
   *
   * @returns The `TParsedDoc`, or `null` if the document hasn't loaded or is invalid.
   */
  getParsedDoc (): TParsedDoc | null {
    return this.parsedResolved
  }
}
