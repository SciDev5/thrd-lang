import { DiagnosticSeverity, TextEdit, type Position, type Range } from 'vscode-languageserver'
import { type TParsedDoc } from '../TDocument'
import { TDataType, blockDataChildren, type BlockDataWithPosition, type TDataWithPosition } from '../parsing/TData'
import { TokenType } from '../parsing/TToken'
import { IMPOSSIBLE } from '../util/THROW'
import { contractRange, positionIsInRange, type TokenRange } from '../util/range'
import { TDiagnostic, type DiagnosticTracker } from './DiagnosticTracker'

export function whitespaceLint (doc: TParsedDoc, diagnostics: DiagnosticTracker): void {
  trailingWhitespaceLint(doc, diagnostics)
  intentationWhitespaceLint(doc, diagnostics)
  paddingWhitespaceLint(doc, diagnostics)
}

class TrailingWhitespaceLintDiagnostic extends TDiagnostic {
  constructor (
    line: number,
    matchStart: number,
    lineLength: number,
  ) {
    const range = { start: { line, character: matchStart }, end: { line, character: lineLength } }
    super({
      message: 'Trailing whitespace not allowed.',
      range,
      severity: DiagnosticSeverity.Warning,
    }, {
      autoFix: TextEdit.del(range),
    })
  }
}
function trailingWhitespaceLint (doc: TParsedDoc, diagnostics: DiagnosticTracker): void {
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i]
    const match = /\s*\r?$/.exec(line) ?? IMPOSSIBLE()
    if (match[0] === '' || match[0] === '\r') {
      continue
    }
    diagnostics.add(
      new TrailingWhitespaceLintDiagnostic(
        i,
        match.index,
        line.length,
      ),
    )
  }
}

class IndentationWhitespaceLintDiagnostic extends TDiagnostic {
  constructor (
    line: number,
    received: number,
    receivedNonSpace: boolean,
    expectedIndent: number,
  ) {
    const range = { start: { line, character: 0 }, end: { line, character: received } }
    super({
      message: `Expected indent of ${expectedIndent} spaces, received ${receivedNonSpace ? 'non-space whitespace.' : received.toString() + ' spaces'}`,
      range,
      severity: DiagnosticSeverity.Warning,
    }, {
      autoFix: TextEdit.replace(range, ' '.repeat(expectedIndent)),
    })
  }
}
function intentationWhitespaceLint (doc: TParsedDoc, diagnostics: DiagnosticTracker): void {
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i]
    if (line.trim().length === 0) {
      continue
    }
    const indent = (/^\s*/.exec(line) ?? IMPOSSIBLE())[0]
    const expectedIndent = expectedIndentAt(doc, { line: i, character: indent.length })

    const nonSpaceIndent = !/ *\r?/.test(indent)
    if (nonSpaceIndent || indent.length !== expectedIndent) {
      diagnostics.add(
        new IndentationWhitespaceLintDiagnostic(
          i,
          indent.length,
          nonSpaceIndent,
          expectedIndent,
        ),
      )
    }
  }
}
function expectedIndentAt (doc: TParsedDoc, pos: Position): number {
  return 4 * findDataBlockDepth(doc.data, pos)
}

function findDataBlockDepth (data: TDataWithPosition, pos: Position): number {
  switch (data.type) {
    case TDataType.Block: {
      return findBlockBlockDepth(data, pos, data.range)
    }
    case TDataType.Enum: {
      if (data.contents !== undefined) {
        return findBlockBlockDepth(data.contents, pos, data.contents.range)
      } else {
        return 0
      }
    }
    default:
      return 0
  }
}
function findBlockBlockDepth (data: BlockDataWithPosition, pos: Position, contentRange: Range): number {
  if (!positionIsInRange(pos, contractRange(contentRange, 1))) return 0
  const children = blockDataChildren(data)
  return 1 + Math.max(...children.map(elt => findDataBlockDepth(elt, pos)))
}

class InlinePaddingWhitespaceLintDiagnostic extends TDiagnostic {
  constructor (
    line: number,
    start: number,
    end: number,
    expectedSpaces: number,
    receivedNonSpace: boolean,
  ) {
    const range = { start: { line, character: start }, end: { line, character: end } }
    super({
      message: `Expected ${expectedSpaces} spaces, received ${receivedNonSpace ? 'non-space whitespace.' : (end - start).toString() + ' spaces'}`,
      range,
      severity: DiagnosticSeverity.Warning,
    }, {
      autoFix: TextEdit.replace(range, ' '.repeat(expectedSpaces)),
    })
  }
}

class LinebreakPaddingWhitespaceLintDiagnostic extends TDiagnostic {
  constructor (
    line: number,
    start: number,
    end: number,
    indent: number,
  ) {
    const range = { start: { line, character: start }, end: { line, character: end } }
    super({
      message: 'Expected line break.',
      range,
      severity: DiagnosticSeverity.Warning,
    }, {
      autoFix: TextEdit.replace(range, '\n' + ' '.repeat(indent)),
    })
  }
}

function paddingWhitespaceLint (doc: TParsedDoc, diagnostics: DiagnosticTracker): void {
  paddingWhitespaceLint_recursive(doc, doc.data, diagnostics)

  const tokensExceptWhitespace = doc.tokens.filter(v => ![TokenType.Whitespace, TokenType.Newline].includes(v.data.type))
  for (let i = 1; i < tokensExceptWhitespace.length - 1; i++) {
    const current = tokensExceptWhitespace[i]
    const line = current.range.start.line // start/end doesn't matter here
    if (current.data.type === TokenType.Separator) {
      const before = tokensExceptWhitespace[i - 1]
      const after = tokensExceptWhitespace[i + 1]

      if (before.range.end.line === line) {
        const distance = current.range.start.character - before.range.end.character
        if (distance !== 0) {
          // require no space before comma
          diagnostics.add(new InlinePaddingWhitespaceLintDiagnostic(
            line,
            before.range.end.character,
            current.range.start.character,
            0,
            false,
          ))
        }
      }
      if (after.range.start.line === line) {
        const distance = after.range.start.character - current.range.end.character
        const receivedNonSpace = /[^ ]/.test(doc.lines[line].substring(current.range.end.character, after.range.start.character))
        if (distance !== 1) {
          // require 1 space after comma
          diagnostics.add(new InlinePaddingWhitespaceLintDiagnostic(
            line,
            current.range.end.character,
            after.range.start.character,
            1,
            receivedNonSpace,
          ))
        }
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function paddingWhitespaceLint_recursive (doc: TParsedDoc, data: TDataWithPosition, diagnostics: DiagnosticTracker): void {
  switch (data.type) {
    case TDataType.Block: {
      paddingWhitespaceLint_recursiveBlock(doc, data, data.range, data.tokenRange, diagnostics)
      break
    }
    case TDataType.Enum: {
      if (data.contents !== undefined) {
        paddingWhitespaceLint_recursiveBlock(doc, data.contents, data.contents.range, data.contents.tokenRange, diagnostics)
        break
      } else {
        break
      }
    }
    default:
      break
  }
}
// eslint-disable-next-line @typescript-eslint/naming-convention
function paddingWhitespaceLint_recursiveBlock (doc: TParsedDoc, data: BlockDataWithPosition, range: Range, tokenRange: TokenRange, diagnostics: DiagnosticTracker): void {
  const isMultiline = range.start.line !== range.end.line
  if (isMultiline) {
    // end is a lengthlike value, -1 gets us to the last token, -2 gets us to the one before that
    let last = tokenRange.end - 2
    for (; last >= tokenRange.start + 1; last--) {
      if (![TokenType.Whitespace, TokenType.Newline, TokenType.Invalid].includes(doc.tokens[last].data.type)) {
        break
      }
    }
    const lastTokenInBlock = doc.tokens[last]
    if (lastTokenInBlock.range.end.line === range.end.line) {
      // when the last non-space token in a block is on the same line
      // not allowed in multiline block for nice formatting reasons
      diagnostics.add(new LinebreakPaddingWhitespaceLintDiagnostic(
        range.end.line,
        lastTokenInBlock.range.end.character,
        range.end.character - 1,
        expectedIndentAt(doc, range.end),
      ))
    }

    let first = tokenRange.start + 1
    let lastNonWhitespaceBeforeFirstI = tokenRange.start
    for (; first < tokenRange.end + 1; first++) {
      if (![TokenType.Whitespace, TokenType.Newline, TokenType.Invalid].includes(doc.tokens[first].data.type)) {
        // let comments be at the start of blocks
        if (doc.tokens[first].data.type === TokenType.Comment) {
          lastNonWhitespaceBeforeFirstI = first
          continue
        }

        break
      }
    }
    const firstTokenInBlock = doc.tokens[first]
    if (firstTokenInBlock.range.end.line === range.start.line) {
      // when the first non-space, non-comment token in a block is on the same line
      // not allowed in multiline block for nice formatting reasons
      diagnostics.add(new LinebreakPaddingWhitespaceLintDiagnostic(
        range.start.line,
        doc.tokens[lastNonWhitespaceBeforeFirstI].range.end.character,
        firstTokenInBlock.range.start.character,
        expectedIndentAt(doc, firstTokenInBlock.range.start),
      ))
    }

    // diagnostics.addRaw({ message: 'mark', range: firstTokenInBlock.range, severity: DiagnosticSeverity.Information })

    // diagnostics.addRaw({ message: 'mark. ' + TokenType[doc.tokens[tokenRange.end - 1].data.type], range: doc.tokens[tokenRange.end - 1].range, severity: DiagnosticSeverity.Information })
    // diagnostics.addRaw({ message: 'mark* ' + TokenType[doc.tokens[tokenRange.start].data.type], range: doc.tokens[tokenRange.start].range, severity: DiagnosticSeverity.Information })
  } else {
    //
  }

  for (const elt of blockDataChildren(data)) {
    paddingWhitespaceLint_recursive(doc, elt, diagnostics)
  }
}
