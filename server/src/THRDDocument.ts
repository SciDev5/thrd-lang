import { DiagnosticSeverity, TextDocuments, type Connection, type Diagnostic } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { capabilities } from './capabilities'
import { TToken } from './parsing/TToken'
import { TChunkType, chunkify, parseChunkTopLevel } from './parsing/parse'
import { globalSettings, type THRDServerSettings } from './settings'
import { combineRanges } from './util/range'

const documents = new TextDocuments(TextDocument)
let connection: Connection
export function bindDocuments (connectionToBind: Connection): void {
  connection = connectionToBind
  documents.onDidClose(e => {
    THRDDocument.close(e.document)
  })

  documents.onDidChangeContent(e => {
    const doc = THRDDocument.get(e.document)
    doc.notifyDidChangeContent()
    doc.validateAndSend().catch(e => { throw e })
  })

  documents.listen(connection)
}

export type Lines = string[]
export interface TLexedDoc {
  readonly lines: Lines
  readonly tokens: TToken[]
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
    this.lexedDoc = this.lex()
  }

  currentContent (): Lines {
    return this.document.getText().split('\n')
  }

  private lexedDoc: Promise<TLexedDoc>
  private async lex (): Promise<TLexedDoc> {
    const lines = this.currentContent()
    return {
      tokens: await TToken.lex(lines),
      lines,
    }
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
    // re-lex the document
    this.lexedDoc = this.lex()
  }

  async validateAndSend (): Promise<void> {
    await connection.sendDiagnostics({
      uri: this.document.uri,
      diagnostics: await this.validate(),
    })
  }

  private async validate (): Promise<Diagnostic[]> {
    const lexedDoc = await this.lexedDoc
    console.log('VALIDATING... TOKEN COUNT:', lexedDoc.tokens.length)

    // TODO TYPE CHECKING

    const diagnostics: Diagnostic[] = [
      // {
      //   message: 'linter under construction',
      //   range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      //   severity: DiagnosticSeverity.Warning,
      // },
    ]

    const chunkified = chunkify(lexedDoc.tokens, false)
    const chunks = chunkified.chunks.filter(v => [TChunkType.Block, TChunkType.Value].includes(v.type))
    // for (const chunk of chunkified.allChunks) {
    //   diagnostics.push({
    //     message: JSON.stringify(chunk, null, 2),
    //     severity: DiagnosticSeverity.Hint,
    //     range: chunk.range,
    //   })
    // }
    diagnostics.push(...chunkified.syntaxDiagnostics.map(v => v.diagnostic))
    const canContinue = chunkified.syntaxDiagnostics.every(v => v.errorTolerable)

    if (!canContinue) return diagnostics

    if (chunks.length === 0) {
      diagnostics.push({
        message: 'Data expected.',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      })
      return diagnostics
    }
    if (chunks.length > 1) {
      diagnostics.push({
        message: 'End of file expected.',
        range: combineRanges(chunks[1].range, ...chunks.slice(2).map(v => v.range)),
      })
    }

    const { data, parseDiagnostics } = parseChunkTopLevel(chunks[0])
    diagnostics.push(...parseDiagnostics.map(v => v.diagnostic))

    diagnostics.push({
      message: JSON.stringify(data),
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      severity: DiagnosticSeverity.Information,
    })

    return diagnostics
  }
}
