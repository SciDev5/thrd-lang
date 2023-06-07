import {
  type CompletionParams,
  type InitializeParams,
  TextDocuments,
  createConnection,
  type CompletionItem,
  type InitializeResult,
  TextDocumentSyncKind,
  DidChangeConfigurationNotification,
  type Diagnostic,
  DiagnosticSeverity,
  MarkupKind,
  CompletionItemKind,
  TextEdit,
  PositionEncodingKind,
  ProposedFeatures,
} from 'vscode-languageserver/node'

import {
  TextDocument,
} from 'vscode-languageserver-textdocument'

const connection = createConnection(ProposedFeatures.all)

const documents = new TextDocuments(TextDocument)

const capabilities = {
  configuration: false,
  workspaceFolder: false,
  diagnostic: {
    relatedInfo: false,
  },
}

connection.onInitialize((params: InitializeParams) => {
  capabilities.configuration = params.capabilities.workspace?.configuration ?? false
  capabilities.workspaceFolder = params.capabilities.workspace?.workspaceFolders ?? false
  capabilities.diagnostic.relatedInfo = params.capabilities.textDocument?.publishDiagnostics?.relatedInformation ?? false

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      workspace: capabilities.workspaceFolder ? { workspaceFolders: { supported: true } } : undefined,
      completionProvider: { resolveProvider: true },
      positionEncoding: PositionEncodingKind.UTF16,
    },
  }
  return result
})
connection.onInitialized(() => {
  if (capabilities.configuration) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined).catch(e => { throw e })
  }
  if (capabilities.workspaceFolder) {
    connection.workspace.onDidChangeWorkspaceFolders(ev => {
      console.log('workspace changed', ev)
    })
  }
})

interface THRDServerSettings {
  maxNumberOfProblems: number
}

const defaultSettings: THRDServerSettings = { maxNumberOfProblems: 1000 }
/** Used when the `workspace/configuration` request is not supported by the client. */
let globalSettings: THRDServerSettings = defaultSettings
const cachedDocumentSettings = new Map<string, Thenable<THRDServerSettings>>()

connection.onDidChangeConfiguration(change => {
  if (capabilities.configuration) {
    cachedDocumentSettings.clear()
  } else {
    globalSettings = (change.settings.languageServerExample ?? defaultSettings) as THRDServerSettings
  }

  for (const document of documents.all()) {
    validateTextDocument(document).catch(e => { throw e })
  }
})

function getDocumentSettings (resource: string): Thenable<THRDServerSettings> {
  if (!capabilities.configuration) {
    return Promise.resolve(globalSettings)
  }
  return cachedDocumentSettings.get(resource) ?? ((): Thenable<THRDServerSettings> => {
    const result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'thrdLanguageServer',
    })
    cachedDocumentSettings.set(resource, result)
    return result
  })()
}

documents.onDidClose(e => {
  cachedDocumentSettings.delete(e.document.uri)
})

documents.onDidChangeContent(e => {
  validateTextDocument(e.document).catch(e => { throw e })
})

async function validateTextDocument (textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri)

  // TODO: replace sample code with actual code
  const text = textDocument.getText()
  const pattern = /\b[A-Z]{2,}\b/g
  let m: RegExpExecArray | null

  let problems = 0
  const diagnostics: Diagnostic[] = []
  while (((m = pattern.exec(text)) != null) && problems < settings.maxNumberOfProblems) {
    problems++
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: textDocument.positionAt(m.index),
        end: textDocument.positionAt(m.index + m[0].length),
      },
      message: `${m[0]} is all uppercase.`,
      source: 'ex',
    }
    if (capabilities.diagnostic.relatedInfo) {
      diagnostic.relatedInformation = [
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: 'Spelling matters',
        },
        {
          location: {
            uri: textDocument.uri,
            range: Object.assign({}, diagnostic.range),
          },
          message: 'Particularly for names',
        },
      ]
    }
    diagnostics.push(diagnostic)
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics }).catch(e => { throw e })
}

documents.listen(connection)

connection.onCompletion((params: CompletionParams) => {
  const completions: CompletionItem[] = []

  completions.push({
    label: 'info',
    data: `${JSON.stringify(params)}`,
  })

  completions.push({
    label: 'replace',
    kind: CompletionItemKind.Enum,
    detail: '1',
    textEdit: TextEdit.replace({ start: { line: params.position.line, character: 0 }, end: { line: params.position.line, character: params.position.character } }, ':3'),
  })
  completions.push({
    label: 'testValue',
    insertText: 'testValue: ',
    kind: CompletionItemKind.Variable,
  })

  return completions
})
connection.onCompletionResolve((item: CompletionItem) => {
  item.detail = item.data
  item.documentation = {
    kind: MarkupKind.Markdown,
    value: '# wah \n\n - cool `test` \n ```thrd\na: 432\n```',
  }

  return item
})

connection.onDidChangeWatchedFiles(_change => {
  connection.console.log('config file update')
})

connection.listen()
