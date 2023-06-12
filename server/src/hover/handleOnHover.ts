import { type Hover, type HoverParams } from 'vscode-languageserver'
import { TDocument } from '../TDocument'
import { THoverProvider } from './THoverProvider'
import { SourceFile } from '../TWorkspace'

export function handleOnHover (params: HoverParams): Hover | null {
  const doc = TDocument.getByUri(SourceFile.normalizeURI(params.textDocument.uri))?.getParsedDoc() ?? null
  if (doc === null) {
    return null
  }

  return THoverProvider.getHover(
    doc,
    params.position,
  )
}
