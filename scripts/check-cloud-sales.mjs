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
        // Ein Schluessel wie 'hosted-max' kommt als Quelltext MIT Anfuehrungs-
        // zeichen zurueck. Ohne das Abstreifen findet keine Suche ihn wieder.
        const key = prop.name.getText(file).replace(/^['"`]|['"`]$/g, '')
        if (ts.isStringLiteral(value)) row[key] = value.text
        if (ts.isNumericLiteral(value)) row[key] = Number(value.text.replaceAll('_', ''))
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

// ── /pricing/ auf locallyuncensored.com ──────────────────────────────
//
// Die Seite nennt Zahlen, die alle im Web-Repo stehen. Sie darf nicht selbst
// entscheiden, was ein Plan kostet, und sie darf nicht stehen bleiben, wenn
// dort etwas anderes beschlossen wird. Jede Zahl der Seite wird hier gegen
// ihre Quelle gehalten: Plaene, Guthaben, Pakete, das Tagesbudget und die
// Anzahl der Modelle, die ohne Ablehnung antworten.
const pricing = new JSDOM(readFileSync(new URL('../docs/pricing/index.html', import.meta.url), 'utf8')).window.document
const tiers = objects(source('apps/web/lib/pricing.ts'))
const tierCredits = objects(source('apps/web/lib/billing/credits.ts'))
  .find((row) => typeof row.hosted === 'number' && typeof row['hosted-max'] === 'number')
assert.ok(tierCredits, 'TIER_CREDITS not found in credits.ts')

for (const cell of pricing.querySelectorAll('[data-plan-id]')) {
  const tier = tiers.find((row) => row.id === cell.dataset.planId)
  assert.ok(tier, `Plan missing from pricing.ts: ${cell.dataset.planId}`)
  assert.equal(Number(cell.dataset.monthlyEur), tier.monthlyEUR, `${tier.id}: monthly price drift`)
  assert.equal(cell.textContent, `EUR ${tier.monthlyEUR}`)
  const row = cell.closest('[data-plan-row]')
  const annual = row.querySelector('[data-annual-eur]')
  assert.equal(Number(annual.dataset.annualEur), tier.annualEUR, `${tier.id}: annual price drift`)
  assert.equal(annual.textContent, `EUR ${tier.annualEUR}`)
  const credits = row.querySelector('[data-plan-credits]')
  assert.equal(Number(credits.dataset.planCredits), tierCredits[cell.dataset.planId], `${tier.id}: credit drift`)
  assert.equal(credits.textContent, tierCredits[cell.dataset.planId].toLocaleString('en-US'))
}
assert.equal(pricing.querySelectorAll('[data-plan-id]').length, tiers.filter((t) => typeof t.monthlyEUR === 'number').length,
  'Every paid plan must appear on the pricing page, and nothing else')

const packs = objects(source('apps/web/lib/billing/topup.ts')).filter((row) => typeof row.credits === 'number' && typeof row.eurCents === 'number')
for (const span of pricing.querySelectorAll('[data-pack-id]')) {
  const entry = packs.find((row) => row.id === span.dataset.packId)
  assert.ok(entry, `Pack missing from topup.ts: ${span.dataset.packId}`)
  assert.equal(Number(span.dataset.eurCents), entry.eurCents)
  assert.equal(Number(span.dataset.credits), entry.credits)
  assert.equal(span.textContent, `EUR ${entry.eurCents / 100} for ${entry.credits.toLocaleString('en-US')} credits`)
}
assert.equal(pricing.querySelectorAll('[data-pack-id]').length, packs.length, 'Every pack must appear, and nothing else')

// Das Handbuch-Kapitel zu LU Cloud nennt dasselbe Tagesbudget mit demselben
// Anker und haengt hier an derselben Quelle wie die beiden Verkaufsseiten.
const handbookCloud = new JSDOM(readFileSync(new URL('../docs/guide/cloud/index.html', import.meta.url), 'utf8')).window.document
for (const doc of [pricing, page, handbookCloud]) {
  const limit = doc.querySelector('[data-flash-limit]')
  assert.ok(limit, 'flash allowance anchor missing')
  assert.equal(Number(limit.dataset.flashLimit), daily, 'flash allowance drift')
  assert.ok(limit.textContent.startsWith(daily.toLocaleString('en-US')))
}

// Die gemessene Zahl. Sie steht als Verkaufsargument auf der Seite, also darf
// sie nur so lange dort stehen, wie der Katalog sie hergibt.
const catalogSize = catalog.filter((row) => typeof row.inM === 'number' && typeof row.outM === 'number').length
const unfilteredFull = catalog.filter((row) => row.unfiltered === 'full').length
const claimed = pricing.querySelector('[data-unfiltered-count]')
assert.equal(Number(claimed.dataset.unfilteredCount), unfilteredFull, 'unfiltered count drift')
assert.equal(claimed.textContent, String(unfilteredFull))
const claimedTotal = pricing.querySelector('[data-catalog-count]')
assert.equal(Number(claimedTotal.dataset.catalogCount), catalogSize, 'catalog size drift')
assert.equal(claimedTotal.textContent, String(catalogSize))
// Gemessen wurde am 10.09.2026; ein Modell kam danach in den Katalog. Die
// Seite darf "27 von N" nur mit dem N sagen, das der Messlauf wirklich hatte,
// und das steht in der Messtabelle: die Zeilen VOR der Zaehlzeile.
const factsTable = readWeb('apps/web/lib/chat/model-facts.md').split('\nCounts:')[0]
const measuredSize = factsTable.split('\n').filter((line) => /^\|\s*\S+\/\S+\s*\|\s*(full|partial|none|unknown)\s*\|/.test(line)).length
assert.ok(measuredSize > 40 && measuredSize <= catalogSize, `measured set ${measuredSize} out of range`)
const claimedMeasured = pricing.querySelector('[data-measured-count]')
assert.equal(Number(claimedMeasured.dataset.measuredCount), measuredSize, 'measured size drift')
assert.equal(claimedMeasured.textContent, String(measuredSize))
// ── Der Wolkenschalter im Desktop ────────────────────────────────────
//
// Die Oberflaeche zeigt diese Zahlen, BEVOR jemand angemeldet ist, also bevor
// es einen Katalog zu lesen gibt. Sie stehen deshalb fest in
// src/lib/cloud-pitch.ts, und hier haengen sie an ihrer Quelle. Ein Schalter,
// der eine Zahl verspricht, die der Katalog nicht mehr hergibt, ist eine
// Falschaussage im Kaufmoment.
const pitchSource = ts.createSourceFile(
  'cloud-pitch.ts',
  readFileSync(new URL('../src/lib/cloud-pitch.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const pitch = objects(pitchSource).find((row) => typeof row.chatModels === 'number')
assert.ok(pitch, 'CLOUD_PITCH not found in cloud-pitch.ts')
const mediaSource = source('apps/web/lib/render/cloud-models.ts')
const mediaRows = objects(mediaSource).filter((row) => typeof row.id === 'string' && typeof row.kind === 'string')
// `ops`-Eintraege sind Sondermodelle (Lipsync, Extend, Training), keine
// Auswahleintraege. Die Zaehlung der Seite meint die Auswahl.
const opsIds = new Set(
  mediaSource.getFullText().split('\n')
    .filter((line) => /ops: \[/.test(line))
    .map((line) => /id: '([^']+)'/.exec(line)?.[1])
    .filter(Boolean),
)
const countKind = (kind) => mediaRows.filter((row) => row.kind === kind && !opsIds.has(row.id)).length
assert.equal(pitch.chatModels, catalogSize, 'pitch: chat model count drift')
assert.equal(pitch.measuredChatModels, measuredSize, 'pitch: measured set drift')
assert.equal(pitch.unfilteredChatModels, unfilteredFull, 'pitch: unfiltered count drift')
assert.equal(pitch.flashModels, catalog.filter((row) => row.usageClass === 'flash').length, 'pitch: flash count drift')
assert.equal(pitch.flashDailyTokens, daily, 'pitch: daily ceiling drift')
assert.equal(pitch.imageModels, countKind('image'), 'pitch: image model count drift')
assert.equal(pitch.videoModels, countKind('video'), 'pitch: video model count drift')
console.log(`Cloud switch guard passed: ${pitch.unfilteredChatModels}/${pitch.chatModels} chat, ${pitch.flashModels} flash, ${pitch.imageModels} image and ${pitch.videoModels} video match the web catalogue.`)

console.log(`Pricing guard passed: ${tiers.filter((t) => typeof t.monthlyEUR === 'number').length} plans, ${packs.length} packs, ${unfilteredFull}/${catalogSize} models and the ${daily.toLocaleString('en-US')} token ceiling match the web source.`)
for (const slug of ['ollama-cloud', 'featherless', 'venice', 'chutes', 'infermatic', 'arliai', 'cerebras-code', 'backyard-ai', 'sillyhost']) {
  const comparison = new JSDOM(readFileSync(new URL(`../docs/vs/${slug}/index.html`, import.meta.url), 'utf8')).window.document
  const luFacts = [...comparison.querySelectorAll('[data-comparison-row] td:last-child')].map((cell) => cell.textContent).join(' ')
  assert.ok(luFacts.includes(`EUR ${catalogPack.eurCents / 100} for ${catalogPack.credits.toLocaleString('en-US')} credits`), `${slug}: pack claim drift`)
  assert.ok(luFacts.includes(daily.toLocaleString('en-US')), `${slug}: allowance claim drift`)
  console.log(`${slug}: LU pack and allowance claims match the web source.`)
}
