import { CodeActionKind, type CodeAction, type CodeActionParams } from 'vscode-languageserver'
import { TDocument } from '../TDocument'
import { StringSwitcher } from '../util/StringSwitcher'
import { SourceFile } from '../TWorkspace'

export function handleOnCodeAction (params: CodeActionParams): CodeAction[] {
  const actions: CodeAction[] = []

  if (params.context.only === undefined) {
    // no idea
  } else {
    for (const type of params.context.only) {
      const switcher = new StringSwitcher(type)

      switcher.switch({
        [CodeActionKind.SourceFixAll]: () => {
          if (switcher.remaining.length > 0 && switcher.remaining !== 'thrd') {
            return
          }
          const document = TDocument.getByUri(SourceFile.normalizeURI(params.textDocument.uri))
          if (document !== null) {
            actions.push(document.generateSourceFixAllCodeAction())
          }
        },
      }, () => {
        // else do nothing ig
      })
    }
  }

  return actions
}
