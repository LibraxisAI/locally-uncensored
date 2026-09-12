// Cross-repository release guard. No network, credentials or output artifacts.
// Usage: node scripts/check-cloud-sales.mjs /absolute/path/to/web
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

// Jede Kundenseite unter docs/, einmal eingesammelt.
function docsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`
    if (statSync(path).isDirectory()) docsFiles(path, out)
    else if (/\.(html|txt|md)$/.test(entry)) out.push(path)
  }
  return out
}
const docsRoot = new URL('../docs', import.meta.url).pathname

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
const pricingRaw = readFileSync(new URL('../docs/pricing/index.html', import.meta.url), 'utf8')
const pricing = new JSDOM(pricingRaw).window.document
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
// Beide Verkaufsseiten nennen denselben Satz Zahlen, also haengen beide hier.
// Eine Seite allein zu aendern war bisher moeglich, weil nur die Preisseite
// geprueft wurde.
const zahlenseiten = [['docs/pricing/index.html', pricing], ['docs/cloud/index.html', page]]
for (const [name, doc] of zahlenseiten) {
  const claimed = doc.querySelector('[data-unfiltered-count]')
  assert.ok(claimed, `${name}: unfiltered count anchor missing`)
  assert.equal(Number(claimed.dataset.unfilteredCount), unfilteredFull, `${name}: unfiltered count drift`)
  assert.equal(claimed.textContent, String(unfilteredFull), `${name}: unfiltered count text drift`)
  const claimedTotal = doc.querySelector('[data-catalog-count]')
  assert.ok(claimedTotal, `${name}: catalog count anchor missing`)
  assert.equal(Number(claimedTotal.dataset.catalogCount), catalogSize, `${name}: catalog size drift`)
  assert.equal(claimedTotal.textContent, String(catalogSize), `${name}: catalog size text drift`)
}
// Gemessen wurde am 10.09.2026; ein Modell kam danach in den Katalog. Die
// Seite darf "27 von N" nur mit dem N sagen, das der Messlauf wirklich hatte,
// und das steht in der Messtabelle: die Zeilen VOR der Zaehlzeile.
const factsTable = readWeb('apps/web/lib/chat/model-facts.md').split('\nCounts:')[0]
const measuredSize = factsTable.split('\n').filter((line) => /^\|\s*\S+\/\S+\s*\|\s*(full|partial|none|unknown)\s*\|/.test(line)).length
assert.ok(measuredSize > 40 && measuredSize <= catalogSize, `measured set ${measuredSize} out of range`)
for (const [name, doc] of zahlenseiten) {
  const claimedMeasured = doc.querySelector('[data-measured-count]')
  assert.ok(claimedMeasured, `${name}: measured count anchor missing`)
  assert.equal(Number(claimedMeasured.dataset.measuredCount), measuredSize, `${name}: measured size drift`)
  assert.equal(claimedMeasured.textContent, String(measuredSize), `${name}: measured size text drift`)
}
console.log(`Denominator guard passed: ${unfilteredFull} of ${measuredSize} measured and ${catalogSize} in the catalogue, identical on ${zahlenseiten.length} sales pages.`)
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
// ── Die zwoelf Motoren, Name fuer Name ──────────────────────────────
//
// Die Anzahl stimmte schon, der zwoelfte Name nicht: die Sprachmodell-Dateien
// fuehrten TGI, der Erkennungslauf kennt text-generation-webui. Zwei
// verschiedene Produkte. Geprueft wird deshalb jeder Name gegen LOCAL_BACKENDS
// in der Ersteinrichtung, nicht die Anzahl.
const backendsStep = readFileSync(new URL('../src/components/onboarding/BackendsStep.tsx', import.meta.url), 'utf8')
const backendNames = [...backendsStep.matchAll(/name: '([^']+)',\s+description:/g)].map((treffer) => treffer[1])
assert.ok(backendNames.length >= 12, `LOCAL_BACKENDS not read: ${backendNames.length} names`)
const backendDrift = []
for (const datei of ['llms.txt', 'llms-full.txt']) {
  const text = readFileSync(new URL(`../docs/${datei}`, import.meta.url), 'utf8')
  const liste = /auto-detected \(([^)]+)\)|auto-detects \d+ local backends: (.+?)\. ComfyUI/.exec(text)
  assert.ok(liste, `docs/${datei}: the backend list is gone`)
  const genannt = (liste[1] ?? liste[2]).split(/,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean)
  for (const name of genannt) if (!backendNames.includes(name)) backendDrift.push(`${datei}: ${name}`)
  for (const name of backendNames) if (!genannt.includes(name)) backendDrift.push(`${datei}: missing ${name}`)
}
assert.equal(
  backendDrift.length,
  0,
  `The engine names come from LOCAL_BACKENDS: ${backendDrift.length} difference(s) [${backendDrift.join(', ')}]`,
)
console.log(`Backend guard passed: both language-model files name the same ${backendNames.length} engines as LOCAL_BACKENDS.`)

// ── Eine Installergroesse fuer den ganzen Baum ──────────────────────
//
// Gemessen wurde bei jedem Bau: der Installerbericht zu 3.0.0 nennt
// Locally Uncensored_3.0.0_x64-setup.exe mit 14.075.397 Bytes. Im Repo haelt
// das Handbuch diese Zahl, und es ist die einzige docs/-Datei, die fuer 3.0.0
// geschrieben wurde. Jede Seite, die eine Installergroesse nennt, nennt diese.
const installGuide = readFileSync(new URL('../docs/guide/install/index.html', import.meta.url), 'utf8')
const installerMB = Number(/about (\d+) MB on Windows/.exec(installGuide)?.[1])
assert.ok(Number.isFinite(installerMB), 'docs/guide/install/index.html: the installer size is gone')
const installerDrift = []
for (const path of docsFiles(docsRoot)) {
  for (const claim of readFileSync(path, 'utf8').match(/~\s?\d+ MB installer/g) ?? []) {
    if (Number(/\d+/.exec(claim)[0]) !== installerMB) installerDrift.push(`${path.slice(docsRoot.length + 1)}: ${claim}`)
  }
}
assert.equal(
  installerDrift.length,
  0,
  `The handbook measures the installer at ${installerMB} MB, so every page says that: ${installerDrift.length} page(s) disagree [${installerDrift.join(', ')}]`,
)
console.log(`Installer guard passed: every "MB installer" claim in docs/ says ${installerMB} MB, the size the handbook carries.`)

// ── Der Mac, einmal beantwortet ─────────────────────────────────────
//
// Das Handbuch ist die einzige docs/-Flaeche, die fuer 3.0.0 geschrieben
// wurde, und es sagt: es gibt keinen Mac-Bau und hat nie einen gegeben. Keine
// andere Seite darf daneben eine Roadmap versprechen. Der Anker ist der Satz
// im Handbuch: verschwindet er, faellt auch diese Pruefung auf.
const startseite = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
const macAnswer = readFileSync(new URL('../docs/guide/faq-and-glossary/index.html', import.meta.url), 'utf8')
assert.ok(
  macAnswer.includes('There is no Mac build and there has never been one'),
  'docs/guide/faq-and-glossary/index.html: the Mac answer drifted',
)
const macRoadmapClaims = []
for (const path of docsFiles(docsRoot)) {
  const text = readFileSync(path, 'utf8')
  for (const satz of text.split(/(?<=[.!?])["\s]|\n/)) {
    if (/roadmap/i.test(satz) && /\bmac(os)?\b/i.test(satz)) macRoadmapClaims.push(`${path.slice(docsRoot.length + 1)}: ${satz.trim().slice(0, 70)}`)
  }
}
assert.equal(
  macRoadmapClaims.length,
  0,
  `The handbook says there has never been a Mac build, so no page may put one on a roadmap: ${macRoadmapClaims.length} claim(s) [${macRoadmapClaims.join(' | ')}]`,
)
// Die Startseite hat den Mac ausserdem als behobenen Fehler gefuehrt. Jede
// Stelle, die den Mac nennt, muss im selben Satz sagen, dass es den Bau nicht
// gibt, sonst liest die Startseite sich wie eine Plattformzusage. Ein Bau
// gaebe es an einem .dmg zu erkennen, und das kommt im ganzen Baum nicht vor.
const macMentions = []
for (const satz of startseite.split(/(?<=[.!?])["\s]|\n/)) {
  if (!/\bmac(os)?\b/i.test(satz.replace(/machine/gi, ''))) continue
  // Die Frage selbst darf den Mac nennen, nur die Antwort ist gebunden.
  if (/\?/.test(satz)) continue
  if (/no Mac build|on a Mac, use the hosted studio/i.test(satz)) continue
  macMentions.push(satz.trim().slice(0, 70))
}
assert.equal(
  macMentions.length,
  0,
  `There is no Mac build, so docs/index.html may only say so: ${macMentions.length} other Mac mention(s) [${macMentions.join(' | ')}]`,
)
const dmgClaims = docsFiles(docsRoot).filter((path) => /\.dmg\b|\bdmg\b/i.test(readFileSync(path, 'utf8')))
assert.equal(dmgClaims.length, 0, `No Mac build exists, so docs/ may not offer a .dmg: ${dmgClaims.length} page(s)`)
// Die Fernzugriff-Anleitung endet im Fenster der App, und das laeuft auf
// einem Mac nicht. Eine Installationszeile fuer macOS fuehrt den Leser bis
// Schritt 2 und dann ins Leere.
const remoteAccess = readFileSync(new URL('../docs/remote-access/index.html', import.meta.url), 'utf8')
const macSetupLines = remoteAccess.split('\n').filter((zeile) => /macos/i.test(zeile))
assert.equal(macSetupLines.length, 0, `There is no Mac build, so docs/remote-access/index.html may not carry a macOS setup line: ${macSetupLines.length}`)
for (const platform of ['Windows:', 'Linux:']) {
  assert.ok(remoteAccess.includes(platform), `docs/remote-access/index.html: the ${platform} line is gone`)
}
console.log('Mac guard passed: 0 roadmap promises, 0 stray Mac mentions on the home page, 0 macOS setup lines in the remote-access guide and 0 dmg offers in docs/, and the handbook answer is unchanged.')

// ── Die Startseite verneint nicht, was die Wolkenseite verkauft ─────
//
// docs/cloud/index.html ist die Verkaufsseite fuer LU Cloud auf derselben
// Domain. Solange es sie gibt, darf die Startseite nicht "No cloud" sagen,
// auch nicht im JSON-LD, aus dem Suchmaschinen und Sprachmodelle zitieren.
const cloudPageExists = existsSync(new URL('../docs/cloud/index.html', import.meta.url))
// Ein Satz darf "no cloud" sagen, wenn er die Bedingung mitnennt: im lokalen
// Modus gibt es wirklich keine Wolke. Unbedingt gesagt ist es eine Verneinung
// des eigenen Angebots.
const noCloudClaims = cloudPageExists
  ? startseite
      .split(/(?<=[.!?])["\s]|\n/)
      .filter((satz) => /no cloud/i.test(satz) && !/local mode/i.test(satz))
  : []
assert.equal(
  noCloudClaims.length,
  0,
  `docs/cloud/index.html sells hosted models, so the home page may not deny the cloud: ${noCloudClaims.length} unqualified claim(s) in docs/index.html [${noCloudClaims.map((satz) => satz.trim().slice(-60)).join(' | ')}]`,
)
console.log('Home page guard passed: 0 "No cloud" claims in docs/index.html while docs/cloud/index.html sells hosted models.')

// ── Die zwei Zeilen, die kein Schalter bewegt ───────────────────────
//
// Derselbe Satz steht im Blatt (src/lib/release-notes.ts) und auf der
// Preisseite. Zwei Flaechen, ein Versprechen: sie muessen wortgleich bleiben,
// sonst liest ein Kunde im Fenster etwas anderes als auf der Seite. Der
// Ablehnungsteil wird hier nie schwaecher geprueft, nur gleichgehalten.
const sheet = readFileSync(new URL('../src/lib/release-notes.ts', import.meta.url), 'utf8')
const csamLines = [
  'aterial involving minors is refused on every request',
  'ou may not upload a photograph of a real, identifiable person without their consent',
]
for (const [name, text] of [['docs/pricing/index.html', pricingRaw], ['src/lib/release-notes.ts', sheet]]) {
  for (const line of csamLines) {
    assert.ok(text.includes(line), `${name}: the content-policy line drifted, expected "${line}"`)
  }
}
// "and reported" ist eine Zusage ueber eine Meldung. Der einzige Meldeweg im
// Web ist alertCsamBlock, und der steigt ohne gesetzte SAFETY_ALERT_WEBHOOK_URL
// sofort aus. Solange der Weg an einer Umgebungsvariablen haengt, darf keine
// Seite in docs/ eine Meldung versprechen.
const safetySink = readWeb('apps/web/lib/render/safety.ts')
const alertIsOptional = /SAFETY_ALERT_WEBHOOK_URL/.test(safetySink) && /if \(!url\) return/.test(safetySink)
const reportedClaims = alertIsOptional
  ? docsFiles(docsRoot).filter((path) => /refused on every request and reported/i.test(readFileSync(path, 'utf8')))
  : []
assert.equal(
  reportedClaims.length,
  0,
  `alertCsamBlock returns early without SAFETY_ALERT_WEBHOOK_URL, so no page may promise a report: ${reportedClaims.length} page(s) [${reportedClaims.map((path) => path.slice(docsRoot.length + 1)).join(', ')}]`,
)
console.log('Content-policy guard passed: the two lines are word-identical on the pricing page and in the release sheet, and 0 pages in docs/ promise a report the code cannot make.')

// ── Keine erfundene Tiersperre in docs/ ─────────────────────────────
//
// Der Katalog kennt kein Tier-Feld: die Zeichenkette `tier:` kommt in
// tier-models.ts null Mal vor, und die Datei sagt daneben, dass jede
// Wolkenberechtigung jeden Eintrag erreicht. Solange das so ist, darf kein
// Absatz in docs/ einen Modellnamen aus dem Katalog mit einem Plan als Sperre
// paaren. Beide Wortlisten kommen aus der Quelle: die Modellnamen aus dem
// Katalog, die Plannamen aus TIERS. Vom mehrteiligen Plannamen zaehlt auch das
// unterscheidende Wort allein, weil die Seiten "Pro" schreiben und nicht
// "Hosted Pro".
const catalogHasTierField = /\btier\s*:/.test(readWeb('apps/web/lib/chat/tier-models.ts'))
const planWords = [...new Set(
  tiers
    .filter((row) => typeof row.id === 'string' && typeof row.name === 'string')
    .flatMap((row) => (row.name.includes(' ') ? [row.name, row.name.split(' ').at(-1)] : [row.name])),
)].filter((word) => word !== 'Hosted' && word !== 'Self-Host')
assert.ok(planWords.length > 0, 'No plan names found in pricing.ts')
const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// "GLM 5.3" im Katalog, "GLM-5.3" auf der Seite: der Trenner bleibt offen.
const modelPatterns = catalog
  .filter((row) => typeof row.id === 'string' && typeof row.label === 'string')
  .map((row) => ({ label: row.label, re: new RegExp(`\\b${row.label.split(/[\s-]+/).map(escapeForRegExp).join('[\\s-]?')}\\b`, 'i') }))
const planGate = new RegExp(
  `\\b(?:on|for|requires?|needs?|limited to|included in)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:Hosted\\s+)?(?:${planWords.map(escapeForRegExp).join('|')})\\b`
  + `|\\b(?:Hosted\\s+)?(?:${planWords.map(escapeForRegExp).join('|')})\\s+(?:plan|tier|subscribers?|accounts?|only)\\b`,
  'g',
)
const tierGateOffences = []
if (!catalogHasTierField) {
  for (const path of docsFiles(docsRoot)) {
    const raw = readFileSync(path, 'utf8')
    const blocks = path.endsWith('.html')
      ? [...new JSDOM(raw).window.document.querySelectorAll('p, li, td, th, dd, dt, h1, h2, h3, h4, h5, h6, figcaption, blockquote')].map((node) => node.textContent)
      : raw.split('\n')
    for (const text of blocks) {
      const gates = text.match(planGate)
      if (!gates) continue
      const named = modelPatterns.filter((model) => model.re.test(text))
      if (!named.length) continue
      tierGateOffences.push(`${path.slice(docsRoot.length + 1)}: ${named.map((m) => m.label).join('/')} + "${gates.join('", "')}"`)
    }
  }
}
assert.equal(
  tierGateOffences.length,
  0,
  `The catalogue has no tier field, so no page may put a model behind a plan: ${tierGateOffences.length} pairing(s) [${tierGateOffences.join(' | ')}]`,
)
console.log(`Tier-gate guard passed: 0 model-behind-a-plan claims in docs/, and the catalogue still carries no tier field (plan words: ${planWords.join(', ')}).`)

// ── Vergleichsseiten: kein Gratispfad ───────────────────────────────
//
// `planPays` im Web verlangt ein Konto, das schon Geld geschickt hat. Solange
// das so ist, darf keine LU-Spalte einer Vergleichsseite einen kostenlosen
// Flash-Pfad versprechen. Gebunden ist hier die Regel, nicht ihr Wortlaut:
// faellt `tierIsPaid` aus `planPays` heraus, faellt auch dieses Verbot. Nur die
// letzte Spalte wird geprueft, denn die Gegenseite darf ihren eigenen
// Gratistarif nennen.
const planPaysBody = /export function planPays\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(readWeb('apps/web/lib/pricing.ts'))?.[1]
assert.ok(planPaysBody, 'planPays not found in pricing.ts')
const flashNeedsPaidAccount = /tierIsPaid\(/.test(planPaysBody) && /paidBefore/.test(planPaysBody)
const freePathOffences = []

for (const slug of ['ollama-cloud', 'featherless', 'venice', 'chutes', 'infermatic', 'arliai', 'cerebras-code', 'backyard-ai', 'sillyhost']) {
  const comparison = new JSDOM(readFileSync(new URL(`../docs/vs/${slug}/index.html`, import.meta.url), 'utf8')).window.document
  const luFacts = [...comparison.querySelectorAll('[data-comparison-row] td:last-child')].map((cell) => cell.textContent).join(' ')
  assert.ok(luFacts.includes(`EUR ${catalogPack.eurCents / 100} for ${catalogPack.credits.toLocaleString('en-US')} credits`), `${slug}: pack claim drift`)
  assert.ok(luFacts.includes(daily.toLocaleString('en-US')), `${slug}: allowance claim drift`)
  if (flashNeedsPaidAccount) {
    for (const hit of luFacts.match(/free Flash|free allowance|competing free/gi) ?? []) {
      freePathOffences.push(`${slug}: "${hit}"`)
    }
  }
  console.log(`${slug}: LU pack and allowance claims match the web source.`)
}

const freePathPages = new Set(freePathOffences.map((entry) => entry.split(':')[0])).size
assert.equal(
  freePathOffences.length,
  0,
  `planPays requires an account that has paid, so no LU column may promise a free Flash path: ${freePathOffences.length} claim(s) on ${freePathPages} page(s) [${freePathOffences.join(', ')}]`,
)
console.log('Comparison guard passed: 0 free-path claims in the LU column of 9 comparison pages, and planPays still requires an account that has paid.')

// ── Das Handbuch spricht dem Paketkunden nichts ab ──────────────────
//
// planPays ist true, sobald Geld angekommen ist: ein Paketkauf schreibt eine
// starter-Lizenz und setzt paidBefore, also zahlt das Konto. Die Bedingung ist
// "hat je gezahlt", nicht "haelt einen Plan". Solange die Regel so lautet, darf
// das Handbuch dem Paketkunden die Freimenge nicht absprechen.
const handbookText = readFileSync(new URL('../docs/guide/cloud/index.html', import.meta.url), 'utf8')
if (flashNeedsPaidAccount) {
  assert.ok(
    !/pack without a plan does not get it/i.test(handbookText),
    'docs/guide/cloud/index.html: planPays counts a paid pack, so the handbook may not exclude it',
  )
  assert.ok(
    /an account that has never paid does not get it/i.test(handbookText),
    'docs/guide/cloud/index.html: the condition planPays really applies is missing',
  )
}
console.log('Handbook guard passed: the Flash condition reads as planPays writes it, paid once rather than plan held.')

// ── Das Wort Flash ist kein Kriterium ───────────────────────────────
//
// Der Katalog fuehrt Modelle, deren Name Flash enthaelt, die aber kein
// usageClass 'flash' tragen: DeepSeek V4.1 Flash kostet 0,30 ein und 1,20 aus
// je Million. Solange es so einen Eintrag gibt, darf das Handbuch den Namen
// nicht zum Kriterium machen. Der Beleg kommt aus dem Katalog, nicht aus einem
// getippten Modellnamen.
const flashByNameOnly = catalog.filter(
  (row) => typeof row.label === 'string' && /\bflash\b/i.test(row.label) && row.usageClass !== 'flash',
)
if (flashByNameOnly.length > 0) {
  assert.ok(
    !/carry the word Flash/i.test(handbookText),
    `docs/guide/cloud/index.html: ${flashByNameOnly.length} catalogue entr(y/ies) carry Flash in the name without the Flash class, so the name may not be the criterion`,
  )
  assert.ok(
    /The word Flash in a model name does not decide it/i.test(handbookText),
    'docs/guide/cloud/index.html: the sentence that the name does not decide it is missing',
  )
}
console.log(`Flash-class guard passed: the handbook names the class and not the word, with ${flashByNameOnly.length} catalogue entry carrying Flash in the name without the class.`)

// ── Das Datum der Messung, einmal ───────────────────────────────────
//
// Beide Verkaufsseiten zitieren den Messlauf im Fliesstext und tragen oben ein
// <time>. Die Messtabelle datiert sich selbst, und das ist die Quelle fuer
// beide Angaben. Eine Seite, die den 9. stempelt und im Text den 10. zitiert,
// laesst den Leser raten, welcher Lauf gemeint ist.
const factsDate = /Produced by the owner on (\d{4}-\d{2}-\d{2})/.exec(readWeb('apps/web/lib/chat/model-facts.md'))?.[1]
assert.ok(factsDate, 'model-facts.md carries no production date')
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const [factsYear, factsMonth, factsDay] = factsDate.split('-')
const factsSpelled = `${monthNames[Number(factsMonth) - 1]} ${Number(factsDay)}, ${factsYear}`
for (const [name, doc] of zahlenseiten) {
  const stamp = doc.querySelector('.post-meta time')
  assert.ok(stamp, `${name}: the post date is gone`)
  assert.equal(stamp.getAttribute('datetime'), factsDate, `${name}: the stamped date is not the date of the measurement it cites`)
  assert.equal(stamp.textContent, factsSpelled, `${name}: the spelled date does not match the stamp`)
  assert.ok(new RegExp(`measured on ${factsDate}`, 'i').test(doc.body.textContent), `${name}: the cited measurement date drifted`)
}
console.log(`Measurement-date guard passed: both sales pages stamp and cite ${factsDate}, the date model-facts.md carries.`)

// ── Die Elf verlinkt nicht auf die Seite, die Fuenf sagt ────────────
//
// publicMediaModels auf lu-labs.ai filtert ueber keptOffThisDomain, dort
// stehen fuenf Videomodelle. Auf locallyuncensored.com gilt die volle Zahl.
// Beide duerfen nebeneinander stehen, nur nicht als Verlinkung: ein Satz, der
// eine Videomodellzahl nennt und im selben Atemzug auf die Preisseite der
// anderen Domain zeigt, schickt den Leser zu einer anderen Zahl.
const linkedCountClaims = []
for (const path of docsFiles(`${docsRoot}/blog`)) {
  for (const satz of readFileSync(path, 'utf8').split(/(?<=\.)\s+/)) {
    if (/\d+ video models?/i.test(satz) && /lu-labs\.ai\/pricing/.test(satz)) {
      linkedCountClaims.push(path.slice(docsRoot.length + 1))
    }
  }
}
assert.equal(
  linkedCountClaims.length,
  0,
  `lu-labs.ai publishes a smaller video count, so no blog sentence may link a count to its pricing page: ${linkedCountClaims.length} sentence(s) [${linkedCountClaims.join(', ')}]`,
)
console.log('Blog guard passed: 0 video-model counts linked to the lu-labs.ai pricing page, where keptOffThisDomain publishes a smaller set.')
