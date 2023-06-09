import { readFile } from 'fs/promises'
import { join } from 'path'
import * as oniguruma from 'vscode-oniguruma'
import * as vsctm from 'vscode-textmate'
import { IMPOSSIBLE } from '../util/THROW'

const path = {
  onigWASM: join(__dirname, '../../node_modules/vscode-oniguruma/release/onig.wasm'),
  thrdTMGrammerSpec: join(__dirname, '../../../syntaxes/thrd.tmLanguage.json'),
} as const

const sourceRoot = 'source.thrd'

export const grammarPromise = (async () => (
  await new vsctm.Registry({
    onigLib: oniguruma.loadWASM((await readFile(path.onigWASM)).buffer).then(() => {
      return {
        createOnigScanner (patterns) { return new oniguruma.OnigScanner(patterns) },
        createOnigString (s) { return new oniguruma.OnigString(s) },
      }
    }),
    loadGrammar: async () => {
      return vsctm.parseRawGrammar(
        await readFile(path.thrdTMGrammerSpec, { encoding: 'utf8' }),
        path.thrdTMGrammerSpec,
      )
    },
  }).loadGrammar(sourceRoot) ?? IMPOSSIBLE()
))()
