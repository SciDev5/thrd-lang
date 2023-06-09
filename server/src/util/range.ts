import { type Range } from 'vscode-languageserver'

/** Creates a range that contains all the input ranges */
export function combineRanges (ranges0: Range, ...ranges1: Range[]): Range {
  const combined = { ...ranges0 }
  for (const { start, end } of ranges1) {
    if (start.line < combined.start.line) {
      combined.start = start
    }
    if (start.line === combined.start.line && start.character < combined.start.character) {
      combined.start = start
    }
    if (end.line > combined.end.line) {
      combined.end = end
    }
    if (end.line === combined.end.line && end.character > combined.end.character) {
      combined.end = end
    }
  }
  return { start: { ...combined.start }, end: { ...combined.end } }
}
