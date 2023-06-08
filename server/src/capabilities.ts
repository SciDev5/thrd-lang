import { type InitializeParams } from 'vscode-languageserver'

export const capabilities = {
  configuration: false,
  workspaceFolder: false,
  diagnostic: {
    relatedInfo: false,
  },
}

export function computeCapabilities (params: InitializeParams): void {
  capabilities.configuration = params.capabilities.workspace?.configuration ?? false
  capabilities.workspaceFolder = params.capabilities.workspace?.workspaceFolders ?? false
  capabilities.diagnostic.relatedInfo = params.capabilities.textDocument?.publishDiagnostics?.relatedInformation ?? false
}
