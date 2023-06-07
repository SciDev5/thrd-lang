import { join } from 'path'
import { workspace, type ExtensionContext } from 'vscode'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'

let client: LanguageClient | null = null

export function activate (context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(
    join('server', 'out', 'server.js'),
  )

  client = new LanguageClient(
    'thrdLanguageServer',
    'THRD Language Server',
    {
      run: {
        module: serverModule,
        transport: TransportKind.ipc,
      },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: {
          execArgv: ['--inspect=6009'],
        },
      },
    },
    {
      documentSelector: [{ scheme: 'file', language: 'thrd' }],
      synchronize: {
        fileEvents: workspace.createFileSystemWatcher('**/.thrdrc'),
      },
    },
  )
  client.start().catch(e => { throw e })
}

export function deactivate (): Thenable<void> | undefined {
  return client?.stop()
}
