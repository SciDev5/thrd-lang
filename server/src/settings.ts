import { type Connection } from 'vscode-languageserver'
import { TDocument } from './TDocument'
import { capabilities } from './capabilities'
import { THROW } from './util/THROW'

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

    Promise.all(TDocument.all().map(async v => {
      await v.validateAndSend()
    })).catch(THROW)
  })
}
