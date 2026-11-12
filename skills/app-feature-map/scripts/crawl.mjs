#!/usr/bin/env node
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = `Usage: node crawl.mjs --base <url> --out <dir> [options]

  --base <url>         App origin, e.g. http://localhost:3000
  --start <path>       Page to start from (repeatable, default /)
  --state <file>       Playwright storageState from a signed-in session
  --role <name>        Label for this crawl's user role (default "default")
  --out <dir>          Where to write index.json and screens/
  --scope <prefix>     Only follow paths under this prefix (repeatable)
  --deny <regex>       Never follow URLs matching this (repeatable)
  --max-pages <n>      Stop after n pages (default 300)
  --per-pattern <n>    Samples per URL pattern like /projects/:id (default 2)
  --allow-host         Permit a host that is not localhost/.test/.localhost
  --headed             Show the browser`

const { values: opts } = parseArgs({
  options: {
    base: { type: 'string' },
    start: { type: 'string', multiple: true, default: ['/'] },
    state: { type: 'string' },
    role: { type: 'string', default: 'default' },
    out: { type: 'string' },
    scope: { type: 'string', multiple: true, default: [] },
    deny: { type: 'string', multiple: true, default: [] },
    'max-pages': { type: 'string', default: '300' },
    'per-pattern': { type: 'string', default: '2' },
    'allow-host': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false }
  }
})

const fail = message => {
  console.error(message)
  process.exit(1)
}

if (opts.help || !opts.base || !opts.out) fail(USAGE)

const base = new URL(opts.base)
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/
if (!LOCAL_HOST.test(base.hostname) && !opts['allow-host']) {
  fail(`${base.hostname} is not a local host. Pass --allow-host only for a test environment the user named.`)
}

const DEFAULT_DENY = [
  /sign_?out|log_?out/i,
  /\/rails\//,
  /\/(destroy|delete)(\/|\?|$)/i,
  /\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|svg|stp|step|dxf|dwg)(\?|$)/i
]
const deny = [...DEFAULT_DENY, ...opts.deny.map(source => new RegExp(source, 'i'))]
const SIGN_IN = /sign_?in|log_?in|sessions?\/new/i
const maxPages = Number(opts['max-pages'])
const perPattern = Number(opts['per-pattern'])

function loadPlaywright() {
  const requireFromProject = createRequire(path.join(process.cwd(), 'package.json'))
  for (const name of ['playwright', '@playwright/test']) {
    try {
      return requireFromProject(name)
    } catch {}
  }
  fail('Playwright is not installed in this project. Run from the project root, add playwright as a dev dependency, then `npx playwright install chromium`.')
}

function isIdSegment(segment) {
  return (
    /^\d+$/.test(segment) ||
    /^\d+-/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    (segment.length >= 20 && /\d/.test(segment) && /[a-z]/i.test(segment))
  )
}

function patternOf(url) {
  const segments = url.pathname.split('/').filter(Boolean)
  return '/' + segments.map(segment => (isIdSegment(segment) ? ':id' : segment)).join('/')
}

function sectionOf(pattern) {
  return pattern.split('/').find(segment => segment && segment !== ':id') || 'root'
}

function slugOf(pattern, sample) {
  const slug = pattern === '/' ? 'root' : pattern.slice(1).replaceAll('/', '__').replaceAll(':id', '_id_')
  return sample > 1 ? `${slug}--${sample}` : slug
}

const FINGERPRINT_ROLES = /^\s*- (button|link|textbox|searchbox|spinbutton|combobox|listbox|checkbox|radio|switch|slider|tab|menuitem|heading)(?: "((?:[^"\\]|\\.)*)")?/

function fingerprintOf(ariaSnapshot) {
  const lines = ariaSnapshot
    .split('\n')
    .map(line => line.match(FINGERPRINT_ROLES))
    .filter(Boolean)
    .map(([, role, name = '']) => `${role}|${name}`)
    .sort()
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12)
}

function pageFacts() {
  const links = []
  let canvas = false
  const roots = [document]
  while (roots.length) {
    const root = roots.shift()
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
      if (element.localName === 'canvas') {
        const box = element.getBoundingClientRect()
        if (box.width >= 150 && box.height >= 150) canvas = true
      }
      if (element.localName === 'a' && typeof element.href === 'string' && element.href) {
        links.push({
          href: element.href,
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          method: element.dataset.turboMethod || element.dataset.method || null,
          confirm: element.dataset.turboConfirm || element.dataset.confirm || null
        })
      }
    }
  }
  return { title: document.title, links, canvas }
}

function linkSkipReason(link, url) {
  if (url.origin !== base.origin) return 'external'
  if (link.method && link.method.toLowerCase() !== 'get') return `non-GET (${link.method})`
  if (link.confirm) return 'asks for confirmation'
  if (deny.some(pattern => pattern.test(url.pathname + url.search))) return 'denied'
  if (opts.scope.length && !opts.scope.some(prefix => url.pathname.startsWith(prefix))) return 'out of scope'
  return null
}

async function sessionExpired(page) {
  await page.goto(new URL(opts.start[0], base).href, { waitUntil: 'load', timeout: 30000 }).catch(() => {})
  return SIGN_IN.test(new URL(page.url()).pathname) && !SIGN_IN.test(opts.start[0])
}

async function main() {
  const { chromium } = loadPlaywright()
  const outDir = path.resolve(opts.out)
  fs.mkdirSync(path.join(outDir, 'screens'), { recursive: true })

  const browser = await chromium.launch({ headless: !opts.headed })
  const context = await browser.newContext({
    storageState: opts.state,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: false
  })

  const page = await context.newPage()
  let consoleErrors = []
  let serverErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', error => consoleErrors.push(String(error.message).slice(0, 300)))
  page.on('response', response => response.status() >= 500 && serverErrors.push(`${response.status()} ${response.url()}`))
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}))

  const index = { base: base.origin, role: opts.role, startedAt: new Date().toISOString(), pages: [], skipped: [], errors: [], authLost: null }
  const visitedPaths = new Set()
  const samplesByPattern = new Map()
  const skipped = new Map()
  const queue = opts.start.map(start => ({ url: new URL(start, base).href, from: null, via: null }))

  while (queue.length && index.pages.length < maxPages) {
    const { url, from, via } = queue.shift()
    consoleErrors = []
    serverErrors = []

    let response
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    } catch (error) {
      const reason = /Download is starting/.test(error.message) ? 'download' : error.message.split('\n')[0]
      index.errors.push({ url, from, reason })
      continue
    }

    const finalUrl = new URL(page.url())
    if (SIGN_IN.test(finalUrl.pathname) && !SIGN_IN.test(new URL(url).pathname)) {
      if (await sessionExpired(page)) {
        index.authLost = { url, redirectedTo: finalUrl.pathname }
        break
      }
      index.errors.push({ url, from, reason: `redirected to ${finalUrl.pathname}` })
      continue
    }
    if (finalUrl.origin !== base.origin || (visitedPaths.has(finalUrl.pathname) && finalUrl.href !== url)) continue
    visitedPaths.add(finalUrl.pathname)

    const pattern = patternOf(finalUrl)
    const sample = (samplesByPattern.get(pattern) || 0) + 1
    samplesByPattern.set(pattern, sample)
    const slug = slugOf(pattern, sample)

    const facts = await page.evaluate(pageFacts)
    const ariaSnapshot = await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch(() => '')
    await page.screenshot({ path: path.join(outDir, 'screens', `${slug}.png`), fullPage: true }).catch(() => {})

    index.pages.push({
      slug,
      url: finalUrl.href,
      pattern,
      section: sectionOf(pattern),
      title: facts.title,
      status: response?.status() ?? null,
      from,
      via,
      fingerprint: fingerprintOf(ariaSnapshot),
      canvas: facts.canvas,
      consoleErrors,
      serverErrors
    })
    process.stderr.write(`[${index.pages.length}] ${pattern} ${response?.status() ?? ''}\n`)

    for (const link of facts.links) {
      const target = new URL(link.href)
      target.hash = ''
      const reason = linkSkipReason(link, target)
      if (reason) {
        const skippedPattern = reason === 'external' ? target.origin : patternOf(target)
        const key = `${skippedPattern} ${reason}`
        if (!skipped.has(key)) skipped.set(key, { pattern: skippedPattern, reason, example: target.href, from: finalUrl.pathname })
        continue
      }
      if (visitedPaths.has(target.pathname) || queue.some(item => new URL(item.url).pathname === target.pathname)) continue
      const queuedForPattern = queue.filter(item => patternOf(new URL(item.url)) === patternOf(target)).length
      if ((samplesByPattern.get(patternOf(target)) || 0) + queuedForPattern >= perPattern) continue
      queue.push({ url: target.href, from: finalUrl.pathname, via: link.text || null })
    }
  }

  index.skipped = [...skipped.values()]
  index.unvisitedQueue = queue.length
  index.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2))
  await browser.close()

  const sections = new Set(index.pages.map(entry => entry.section))
  console.log(JSON.stringify({
    pages: index.pages.length,
    sections: [...sections],
    canvasPages: index.pages.filter(entry => entry.canvas).length,
    pagesWithProblems: index.pages.filter(entry => entry.consoleErrors.length || entry.serverErrors.length).length,
    errors: index.errors.length,
    skippedPatterns: index.skipped.length,
    unvisitedQueue: index.unvisitedQueue,
    authLost: index.authLost,
    index: path.join(outDir, 'index.json')
  }, null, 2))
  if (index.authLost) process.exitCode = 2
}

main().catch(error => fail(error.stack || String(error)))
