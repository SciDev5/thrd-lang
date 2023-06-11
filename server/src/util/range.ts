import { type Position, type Range } from 'vscode-languageserver'

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

export function positionIsInRange (pos: Position, range: Range): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) {
    return false
  }
  if (pos.character < range.start.character && pos.line === range.start.line) {
    return false
  }
  if (pos.character >= range.end.character && pos.line === range.end.line) {
    return false
  }
  return true
}

export function contractRange (range: Range, amountStart: number, amountEnd: number = amountStart): Range {
  return {
    start: { line: range.start.line, character: range.start.character + amountStart },
    end: { line: range.end.line, character: range.end.character - amountEnd },
  }
}

export interface TokenRange {
  start: number
  end: number
}

export function combineTokenRanges (ranges0: TokenRange, ...ranges1: TokenRange[]): TokenRange {
  const combined = { ...ranges0 }
  for (const { start, end } of ranges1) {
    if (start < combined.start) {
      combined.start = start
    }
    if (end > combined.end) {
      combined.end = end
    }
  }
  return combined
}
export function tokenRangeSingle (i: number): TokenRange {
  return { start: i, end: i + 1 }
}
