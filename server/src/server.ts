import {
  CodeActionKind,
  DidChangeConfigurationNotification,
  PositionEncodingKind,
  ProposedFeatures,
  TextDocumentSyncKind,
  createConnection,
  type InitializeParams,
  type InitializeResult,
  type URI,
} from 'vscode-languageserver/node'

import { bindDocuments } from './TDocument'
import { TWorkspace } from './TWorkspace'
import { handleOnCodeAction } from './actions/handleOnCodeAction'
import { capabilities, computeCapabilities } from './capabilities'
import { handleOnCompletion, handleOnCompletionResolve } from './completions/handleOnCompletion'
import { handleOnHover } from './hover/handleOnHover'
import { bindSettings } from './settings'

const connection = createConnection(ProposedFeatures.all)

connection.onInitialize((params: InitializeParams) => {
  computeCapabilities(params)

  TWorkspace.workspaceChanged(
    params.workspaceFolders ?? [{ uri: params.rootUri as URI, name: 'rootUri' }],
    [],
  ).catch(e => { throw e })

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      workspace: capabilities.workspaceFolder ? { workspaceFolders: { supported: true } } : undefined,
      completionProvider: { resolveProvider: true },
      codeActionProvider: { codeActionKinds: [CodeActionKind.SourceFixAll, CodeActionKind.Refactor] },
      hoverProvider: { },
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
      TWorkspace.workspaceChanged(ev.added, ev.removed)
        .catch(e => { throw e })
    })
  }
})

bindSettings(connection)
bindDocuments(connection)

connection.onCompletion(handleOnCompletion)
connection.onCompletionResolve(handleOnCompletionResolve)

connection.onCodeAction(handleOnCodeAction)
connection.onHover(handleOnHover)

connection.onDidChangeWatchedFiles(_change => {
  connection.console.log('config file update')
})

connection.listen()
