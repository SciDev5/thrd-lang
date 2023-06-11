import { type Diagnostic } from 'vscode-languageserver'
import { type TextEdit } from 'vscode-languageserver-textdocument'

export class DiagnosticTracker {
  readonly diagnostics: TDiagnostic[] = []
  private _canContinue = true
  get canContinue (): boolean { return this._canContinue }

  add (diagnostic: TDiagnostic): void {
    this.diagnostics.push(diagnostic)
    if (!diagnostic.canContinue) {
      this._canContinue = false
    }
  }

  addRaw (diagnostic: Diagnostic): void {
    this.diagnostics.push(new TDiagnostic(diagnostic))
  }

  mergeIn (tracker: DiagnosticTracker): void {
    this.diagnostics.push(...tracker.diagnostics)
  }

  collectDiagnostcis (): Diagnostic[] {
    return this.diagnostics.map(v => v.diagnostic)
  }

  collectAutoFixes (): TextEdit[] {
    return this.diagnostics.flatMap(({ autoFix }) => autoFix !== undefined ? [autoFix] : [])
  }
}

export class TDiagnostic {
  readonly canContinue: boolean
  readonly autoFix?: TextEdit
  constructor (
    readonly diagnostic: Diagnostic,
    init?: { canContinue?: boolean, autoFix?: TextEdit },
  ) {
    this.canContinue = init?.canContinue ?? true
    this.autoFix = init?.autoFix
  }
}
