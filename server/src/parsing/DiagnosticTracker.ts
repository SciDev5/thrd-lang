import { type Diagnostic } from 'vscode-languageserver'

export class DiagnosticTracker {
  readonly diagnostics: Diagnostic[] = []
  private _canContinue = true
  get canContinue (): boolean { return this._canContinue }

  add (diagnostic: TDiagnostic): void {
    this.diagnostics.push(diagnostic.diagnostic)
    if (!diagnostic.canContinue) {
      this._canContinue = false
    }
  }

  addRaw (diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic)
  }

  mergeIn (tracker: DiagnosticTracker): void {
    this.diagnostics.push(...tracker.diagnostics)
  }
}

export abstract class TDiagnostic {
  readonly canContinue: boolean
  constructor (
    readonly diagnostic: Diagnostic,
    init?: { canContinue?: boolean },
  ) {
    this.canContinue = init?.canContinue ?? true
  }
}
