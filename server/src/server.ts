import {
  CompletionItemKind,
  createConnection,
  DidChangeConfigurationNotification,
  MarkupKind,
  PositionEncodingKind,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextEdit,
  type CompletionItem,
  type CompletionParams,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node'

import { capabilities, computeCapabilities } from './capabilities'
import { bindSettings } from './settings'
import { bindDocuments } from './TDocument'

const connection = createConnection(ProposedFeatures.all)

connection.onInitialize((params: InitializeParams) => {
  computeCapabilities(params)

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

bindSettings(connection)
bindDocuments(connection)

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
