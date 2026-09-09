// Cross-repository release guard. No network, credentials or output artifacts.
// Usage: node scripts/check-cloud-sales.mjs /absolute/path/to/web
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const webRoot = process.argv[2]
assert.ok(webRoot && isAbsolute(webRoot), 'Pass the absolute web repository path')
const readWeb = (path) => readFileSync(resolve(webRoot, path), 'utf8')
function source(path) {
  return ts.createSourceFile(path, readWeb(path), ts.ScriptTarget.Latest, true)
}
function objects(file) {
  const out = []
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const row = {}
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const value = prop.initializer
        if (ts.isStringLiteral(value)) row[prop.name.getText(file)] = value.text
        if (ts.isNumericLiteral(value)) row[prop.name.getText(file)] = Number(value.text.replaceAll('_', ''))
      }
      out.push(row)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

const page = new JSDOM(readFileSync(new URL('../docs/cloud/index.html', import.meta.url), 'utf8')).window.document
const catalog = objects(source('apps/web/lib/chat/tier-models.ts'))
for (const element of page.querySelectorAll('[data-model-id]')) {
  const entry = catalog.find((item) => item.id === element.dataset.modelId)
  assert.ok(entry, `Model missing from catalog: ${element.dataset.modelId}`)
  assert.equal(element.textContent, entry.label)
}
const flashModel = page.querySelector('[data-model-id]')
assert.equal(catalog.find((item) => item.id === flashModel.dataset.modelId).usageClass, 'flash')
const allowanceSource = source('apps/web/lib/chat/flash-allowance.ts')
let daily
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(allowanceSource) === 'FLASH_DAILY_TOKENS') {
    assert.ok(node.initializer && ts.isNumericLiteral(node.initializer))
    daily = Number(node.initializer.text.replaceAll('_', ''))
  }
  ts.forEachChild(node, visit)
}
visit(allowanceSource)
assert.equal(Number(page.querySelector('[data-flash-limit]').dataset.flashLimit), daily)
assert.ok(page.querySelector('[data-flash-limit]').textContent.startsWith(daily.toLocaleString('en-US')))
const pack = page.querySelector('[data-pack-id]')
const catalogPack = objects(source('apps/web/lib/billing/topup.ts')).find((item) => item.id === pack.dataset.packId)
assert.ok(catalogPack)
assert.equal(Number(pack.dataset.eurCents), catalogPack.eurCents)
assert.equal(Number(pack.dataset.credits), catalogPack.credits)
assert.equal(pack.textContent, `EUR ${catalogPack.eurCents / 100} for ${catalogPack.credits.toLocaleString('en-US')} credits`)
console.log('Cloud sales guard passed: model IDs/labels, Flash membership/limit and pack price/credits match the web source.')
for (const slug of ['ollama-cloud', 'featherless']) {
  const comparison = new JSDOM(readFileSync(new URL(`../docs/vs/${slug}/index.html`, import.meta.url), 'utf8')).window.document
  const luFacts = [...comparison.querySelectorAll('[data-comparison-row] td:last-child')].map((cell) => cell.textContent).join(' ')
  assert.ok(luFacts.includes(`EUR ${catalogPack.eurCents / 100} for ${catalogPack.credits.toLocaleString('en-US')} credits`), `${slug}: pack claim drift`)
  assert.ok(luFacts.includes(daily.toLocaleString('en-US')), `${slug}: allowance claim drift`)
  console.log(`${slug}: LU pack and allowance claims match the web source.`)
}
