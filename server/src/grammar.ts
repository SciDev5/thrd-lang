import { readFile } from 'fs/promises'

import { join } from 'path'
import * as vsctm from 'vscode-textmate'
import * as oniguruma from 'vscode-oniguruma'
import { IMPOSSIBLE } from './util/THROW'

const path = {
  onigWASM: join(__dirname, '../node_modules/vscode-oniguruma/release/onig.wasm'),
  thrdTMGrammerSpec: join(__dirname, '../../syntaxes/thrd.tmLanguage.json'),
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

/*
// Load the JavaScript grammar and any other grammars included by it async.
thrdGrammar.then(grammar => {
  const text = `
hell: "world",

world: 3,

h: [
    1,4,5,
],
  `.trim().split('\n')
  let ruleStack = vsctm.INITIAL
  for (let i = 0; i < text.length; i++) {
    const line = text[i]
    const lineTokens = grammar.tokenizeLine(line, ruleStack)
    console.log(`\nTokenizing line: ${line}`)
    for (let j = 0; j < lineTokens.tokens.length; j++) {
      const token = lineTokens.tokens[j]
      console.log(` - token from ${token.startIndex} to ${token.endIndex} ` +
                `(${line.substring(token.startIndex, token.endIndex)}) ` +
                `with scopes ${token.scopes.join(', ')}`,
      )
    }
    ruleStack = lineTokens.ruleStack
  }
}).catch(e => { throw e })
 */
