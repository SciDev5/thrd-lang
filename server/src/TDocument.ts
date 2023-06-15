import { CodeAction, CodeActionKind, TextDocuments, type Connection, type Position } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TWorkspace, type SourceFile } from './TWorkspace'
import { TYPESPEC_SPEC } from './TWorkspaceTypeIndex'
import { capabilities } from './capabilities'
import { DiagnosticTracker } from './linting/DiagnosticTracker'
import { whitespaceLint } from './linting/whitespaceLint'
import { type TDataWithPosition } from './parsing/TData'
import { TToken } from './parsing/TToken'
import { TypeResolutionIssue, lintingTypeCheckOrTypeFindingError, type TTypeSpec } from './parsing/TTypeSpec'
import { parse } from './parsing/parse'
import { globalSettings, type THRDServerSettings } from './settings'
import { positionIsInRange } from './util/range'
import { Err, Ok, isOk, type Result, unwrapResult } from './util/Result'
import { IMPOSSIBLE } from './util/THROW'

const documents = new TextDocuments(TextDocument)
let connection: Connection
export function bindDocuments (connectionToBind: Connection): void {
  connection = connectionToBind

  documents.onDidChangeContent(e => {
    TWorkspace.openInEditor(e.document)
    TWorkspace.reportChangesFromLSP(e.document)
  })
  documents.onDidClose(e => {
    TWorkspace.closedInEditor(e.document)
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
    readonly typeSpec: [string, Result<TTypeSpec, TypeResolutionIssue>],
  ) {
    lintingTypeCheckOrTypeFindingError(this.data, typeSpec, this.typeDiagnostics)
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
  private static readonly all = new Map<string, TDocument>()

  static getByUri (uri: string): TDocument | null {
    return this.all.get(uri) ?? null
  }

  constructor (
    readonly source: SourceFile,
    readonly workspace: TWorkspace,
  ) {
    if (TDocument.all.has(source.uri)) {
      throw new Error('TODO handle overlapping workspaces')
    }
    TDocument.all.set(source.uri, this)
    this.parsed = this.parse()
  }

  unwatch (): void {
    TDocument.all.delete(this.source.uri)
  }

  private parsed: Promise<[TParsedDoc | null, DiagnosticTracker]>
  private parsedResolved: TParsedDoc | null = null
  private allDiagnostics = new DiagnosticTracker()
  private async parse (): Promise<[TParsedDoc | null, DiagnosticTracker]> {
    const syntaxDiagnosticTracker = new DiagnosticTracker()

    const lines = this.source.getText().split('\n')
    const tokens = await TToken.lex(lines)
    const data = await parse(tokens, syntaxDiagnosticTracker)

    const doc = data !== null
      ? new TParsedDoc(lines, tokens, data, await this.getTypespec())
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
        scopeUri: this.source.uri,
        section: 'thrdLanguageServer',
      })
      : null
  }

  refreshSettings (): void {
    this._documentSettings = this.computeDocumentSettings()
  }

  static refreshSettings (): void {
    this.all.forEach(v => { v.refreshSettings() })
  }

  get documentSettings (): Promise<THRDServerSettings> {
    return this._documentSettings.then(v => v ?? globalSettings())
  }

  refreshParse (): void {
    // refresh the document content
    this.parsed = this.parse()
  }

  async validateAndSend (): Promise<void> {
    const diagnostics = new DiagnosticTracker()

    const [parsedDoc, syntaxDiagnostics] = await this.parsed
    diagnostics.mergeIn(syntaxDiagnostics)

    if (parsedDoc !== null) {
      diagnostics.mergeIn(parsedDoc.typeDiagnostics)

      whitespaceLint(parsedDoc, diagnostics)
    }

    this.allDiagnostics = diagnostics
    await connection.sendDiagnostics({
      uri: this.source.uri,
      diagnostics: diagnostics.collectDiagnostcis(),
    })
  }

  generateSourceFixAllCodeAction (): CodeAction {
    return CodeAction.create('Fix all auto-fixable issues', {
      changes: {
        [this.source.uri]: this.allDiagnostics.collectAutoFixes(),
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

  getText (): string {
    return this.source.getText()
  }

  get isTypespec (): boolean {
    return this.source.uri.endsWith('.thrdspec')
  }

  get nameKey (): { type: string } | null {
    const match = this.isTypespec
      ? this.source.uri.match(/[\\/](\w+)\.thrdspec$/)
      : this.source.uri.match(/[\\/](?:.+?\.)?(\w+)\.thrd$/)

    if (match == null) {
      return null
    } else {
      return { type: match[1] }
    }
  }

  async getTypespec (): Promise<[string, Result<TTypeSpec, TypeResolutionIssue>]> {
    if (this.isTypespec) {
      return ['', Ok(TYPESPEC_SPEC)]
    } else if (this.nameKey != null) {
      await this.workspace.typeIndex.ready
      return [this.nameKey.type, this.workspace.typeIndex.map.get(this.nameKey.type) ?? Err(TypeResolutionIssue.CouldNotFind)]
    } else {
      return [(this.source.uri.match(/([\\/][^\\/]*?)$/) ?? IMPOSSIBLE())[1], Err(TypeResolutionIssue.ReferenceInvalid)]
    }
  }

  getTypespecOrNullImmediate (): TTypeSpec | null {
    if (this.isTypespec) {
      return TYPESPEC_SPEC
    } else if (this.nameKey != null) {
      const typ = this.workspace.typeIndex.map.get(this.nameKey.type)
      return typ != null && isOk(typ) ? unwrapResult(typ) : null
    } else {
      return null
    }
  }
}
