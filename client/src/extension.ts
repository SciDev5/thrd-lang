import { join } from 'path'
import { type ExtensionContext } from 'vscode'
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
        fileEvents: [ // This doesn't seem to work, using chokidor
          // workspace.createFileSystemWatcher('**/.thrdrc'),
          // workspace.createFileSystemWatcher('**/.thrd'),
          // workspace.createFileSystemWatcher('**/.thrdspec'),
        ],
      },
    },
  )
  client.start().catch(e => { throw e })
}

export function deactivate (): Thenable<void> | undefined {
  return client?.stop()
}
