import { type Hover, type HoverParams } from 'vscode-languageserver'
import { TDocument } from '../TDocument'
import { THoverProvider } from './THoverProvider'

export function handleOnHover (params: HoverParams): Hover | null {
  const doc = TDocument.getByUri(params.textDocument.uri)?.getParsedDoc() ?? null
  if (doc === null) {
    return null
  }

  return THoverProvider.getHover(
    doc,
    params.position,
  )
}
