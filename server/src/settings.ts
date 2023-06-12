import { type Connection } from 'vscode-languageserver'
import { TDocument } from './TDocument'
import { capabilities } from './capabilities'
import { THROW } from './util/THROW'
import { TWorkspace } from './TWorkspace'

export interface THRDServerSettings {
  maxNumberOfProblems: number
}

export const defaultSettings: THRDServerSettings = { maxNumberOfProblems: 1000 }

/** Used when the `workspace/configuration` request is not supported by the client. */
export function globalSettings (): THRDServerSettings { return globalSettings_ }
let globalSettings_: THRDServerSettings = defaultSettings

export function bindSettings (connection: Connection): void {
  connection.onDidChangeConfiguration(change => {
    if (capabilities.configuration) {
      TDocument.refreshSettings()
    } else {
      globalSettings_ = (change.settings.languageServerExample ?? defaultSettings) as THRDServerSettings
    }

    Promise.all([...TWorkspace.all.values()].map(async v => {
      await v.validateAllAndSend()
    })).catch(THROW)
  })
}
