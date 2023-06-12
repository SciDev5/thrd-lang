import * as chokidar from 'chokidar'
import * as fs from 'fs/promises'
import * as url from 'url'
import { URL } from 'url'
import { type WorkspaceFolder, type URI } from 'vscode-languageserver'
import { type TextDocument } from 'vscode-languageserver-textdocument'
import { TDocument } from './TDocument'
import { THROW } from './util/THROW'
import path = require('path')
import { LOG } from './util/Logger'
import { Scheduler } from './util/Scheduler'

export class TWorkspace {
  static all = new Map<string, TWorkspace>()

  static add (uri: URI): void {
    const workspace = new TWorkspace(uri)
    TWorkspace.all.set(uri, workspace)
  }

  async remove (): Promise<void> {
    TWorkspace.all.delete(this.uri)
    await this.unloadWorkspace()
  }

  static async workspaceChanged (added: WorkspaceFolder[], removed: WorkspaceFolder[]): Promise<void> {
    for (const folder of added) {
      TWorkspace.add(SourceFile.normalizeURI(folder.uri))
    }
    const promises: Array<Promise<void>> = []
    for (const folder of removed) {
      const workspace = this.all.get(SourceFile.normalizeURI(folder.uri))
      if (workspace != null) {
        promises.push(workspace.remove())
      }
    }
    await Promise.all(promises)
  }

  static reportChangesFromLSP (document: TextDocument): void {
    const relevantWorkspaces = this.findContainingWorkspaces(document)
    // LOG.fileLoading.log('>>', relevantWorkspaces.map(v => v.uri), ';')

    relevantWorkspaces.forEach(v => {
      if (!v.sourceChange(document, true)) {
        v.sourceAdd(SourceFile.fromOpened(document))
      }
    })
  }

  sourceAdd (source: SourceFile): void {
    if (this.documents.has(source.uri)) return

    LOG.fileLoading.log('+', source.uri)

    this.documents.set(source.uri, new TDocument(source, this))
    this.refreshScheduler.schedule()
  }

  sourceRemove (srcRaw: { uri: URI } | TextDocument): void {
    const uri = SourceFile.normalizeURI(srcRaw.uri)

    LOG.fileLoading.log('-', uri)

    this.documents.get(uri)?.unwatch()
    if (this.documents.delete(uri)) {
      this.refreshScheduler.schedule()
    }
  }

  sourceChange (srcRaw: { uri: URI } | TextDocument, instantRefreshCurrentDocument: boolean): boolean {
    const uri = SourceFile.normalizeURI(srcRaw.uri)

    LOG.fileLoading.log('*', uri)

    const document = this.documents.get(uri)
    if (document == null) return false

    document.source.updateText().then(async v => {
      this.refreshScheduler.schedule()
      if (instantRefreshCurrentDocument) {
        LOG.general.log('validating current')
        document.refreshParse()
        await document.validateAndSend()
      }
    }).catch(e => { throw e })

    return true
  }

  private readonly refreshScheduler = new Scheduler(() => {
    this.refreshDocuments()
    this.validateAllAndSend().catch(e => { throw e })
  }, 20, 500)

  readonly documents = new Map<URI, TDocument>()
  private refreshDocuments (): void {
    for (const document of this.documents.values()) {
      document.refreshParse()
    }
  }

  async validateAllAndSend (): Promise<void> {
    LOG.general.log('validating all')

    await Promise.all(
      [...this.documents.values()]
        .map(async v => { await v.validateAndSend() }),
    )
  }

  /** Finds workspaces that contains the given uri */
  static findContainingWorkspaces (document: TextDocument): TWorkspace[] {
    const uriNorm = SourceFile.normalizeURI(document.uri)
    return [...this.all.entries()]
      .filter(v => uriNorm.startsWith(v[0]))
      .map(v => v[1])
  }

  private constructor (readonly uri: URI) {}

  private async unloadWorkspace (): Promise<void> {
    await this.chokidarInstance.close()
  }

  private static getWatchGlobs (uri: URI): string[] | null {
    try {
      const basePath = url.fileURLToPath(uri)
      return ['/**/*.thrd'].map(ext => path.join(basePath, ext))
    } catch (e) {
      console.warn('Cannot watch non-filesystem directory')
      return null
    }
  }

  private readonly chokidarInstance = chokidar.watch(
    // TODO add non-filesystem directory watching
    TWorkspace.getWatchGlobs(this.uri) ?? THROW(new Error('Cannot handle non-filesystem directory watch')),
  )
    .on('add', (path, stats) => {
      if (stats?.isFile() ?? false) {
        const uri = url.pathToFileURL(path).toString() satisfies URI
        LOG.fileLoading.log('<chokidar> +', uri)

        SourceFile.fromFile(uri)
          .then(src => { this.sourceAdd(src) })
          .catch(e => { throw e })
      }
    }).on('change', (path, stats) => {
      if (stats?.isFile() ?? false) {
        const uri = url.pathToFileURL(path).toString() satisfies URI
        LOG.fileLoading.log('<chokidar> *', uri)

        this.sourceChange({ uri }, false)
      }
    }).on('unlink', (path) => {
      const uri = url.pathToFileURL(path).toString() satisfies URI
      LOG.fileLoading.log('<chokidar> -', uri)

      this.sourceRemove({ uri })
    })

  static openInEditor (document: TextDocument): void {
    this.findContainingWorkspaces(document).forEach(workspace => {
      workspace.documents.get(SourceFile.normalizeURI(document.uri))?.source.openInEditor(document)
    })
  }

  static closedInEditor (document: TextDocument): void {
    this.findContainingWorkspaces(document).forEach(workspace => {
      workspace.documents.get(SourceFile.normalizeURI(document.uri))?.source.closedInEditor()
    })
  }
}

export class SourceFile {
  static async fromFile (uri: URI): Promise<SourceFile> {
    const uriNormalized = SourceFile.normalizeURI(uri)
    return new SourceFile(uriNormalized, await SourceFile.readText(uriNormalized))
  }

  static fromOpened (doc: TextDocument): SourceFile {
    const uriNormalized = SourceFile.normalizeURI(doc.uri)
    const source = new SourceFile(uriNormalized, doc.getText())
    source.openInEditor(doc)
    return source
  }

  private constructor (
    readonly uri: string,
    private text: string,
  ) { }

  textDocument?: TextDocument
  openInEditor (document: TextDocument): void {
    if (this.textDocument == null) {
      LOG.fileLoading.log('opened in editor', this.uri)
    }

    this.textDocument = document
  }

  closedInEditor (): void {
    if (this.textDocument != null) {
      LOG.fileLoading.log('closed in editor', this.uri)
    }

    delete this.textDocument
  }

  shouldUpdateFromDisk (): boolean {
    return this.textDocument == null
  }

  async updateText (): Promise<void> {
    if (!this.shouldUpdateFromDisk()) return
    const text = await SourceFile.readText(this.uri)
    if (!this.shouldUpdateFromDisk()) return
    this.text = text
  }

  getText (): string {
    return this.textDocument?.getText() ?? this.text
  }

  static async readText (uri: URI): Promise<string> {
    LOG.fileLoading.log('read from disk', uri)

    let fsPath: string | undefined
    try { fsPath = url.fileURLToPath(uri) } catch (_) {}
    if (fsPath != null) {
      return await fs.readFile(fsPath, { encoding: 'utf8' })
    }

    let httpUrl: URL | undefined
    try { httpUrl = new URL(uri) } catch (_) { }
    if (httpUrl != null && (httpUrl.protocol === 'http' || httpUrl.protocol === 'https')) {
      return await (await fetch(httpUrl)).text()
    }

    throw new Error(`Cannot process protocol for uri: '${uri}'`)
  }

  static normalizeURI (uri: URI): URI {
    let fsPath: string | undefined
    try { fsPath = url.fileURLToPath(uri) } catch (_) {}
    if (fsPath != null) {
      return url.pathToFileURL(fsPath).toString()
    }

    return uri // else default
  }
}
