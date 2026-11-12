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
  --out <dir>          Where to write index.json, pages/ and screens/
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

function locatorFor(element) {
  const quote = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  if (element.testid) return `getByTestId(${quote(element.testid)})`
  if (!element.name || element.role === 'generic') return null
  return `getByRole(${quote(element.role)}, { name: ${quote(element.name)} })`
}

function fingerprintOf(inventory) {
  const lines = inventory.elements
    .filter(element => element.visible)
    .map(element => `${element.role}|${element.name}|${element.region}`)
    .concat(inventory.headings)
    .sort()
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12)
}

function inventoryPage() {
  const INTERACTIVE = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=radio]', '[role=switch]', '[role=combobox]', '[role=slider]',
    '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])'
  ].join(',')
  const REGION = [
    'dialog', '[role=dialog]', 'header', 'nav', 'main', 'aside', 'footer', 'form',
    '[role=navigation]', '[role=banner]', '[role=main]', '[role=complementary]',
    '[role=contentinfo]', '[role=tabpanel]', '[role=toolbar]', '[role=menu]', 'turbo-frame'
  ].join(',')
  const INPUT_ROLES = {
    checkbox: 'checkbox', radio: 'radio', range: 'slider', submit: 'button', button: 'button',
    reset: 'button', image: 'button', file: 'button', search: 'searchbox', number: 'spinbutton'
  }

  const clean = value => (value || '').replace(/\s+/g, ' ').trim()
  const parentOf = node => node.parentNode || node.host || null

  const roleOf = element => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.localName
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return element.multiple || element.size > 1 ? 'listbox' : 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') return INPUT_ROLES[(element.getAttribute('type') || '').toLowerCase()] || 'textbox'
    return element.isContentEditable ? 'textbox' : 'generic'
  }

  const nameOf = element => {
    const root = element.getRootNode()
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = clean(labelledBy.split(/\s+/).map(id => root.getElementById?.(id)?.textContent).join(' '))
      if (text) return text
    }
    if (element.getAttribute('aria-label')) return clean(element.getAttribute('aria-label'))
    if (element.labels?.length) return clean([...element.labels].map(label => label.textContent).join(' '))
    if (element.matches('input[type=submit],input[type=button]')) return clean(element.value)
    const text = clean(element.innerText ?? element.textContent)
    if (text) return text.slice(0, 80)
    return clean(
      element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.querySelector?.('img[alt]')?.alt ||
        element.getAttribute('name')
    )
  }

  const regionOf = element => {
    for (let node = parentOf(element); node; node = parentOf(node)) {
      if (node.nodeType === 1 && node.matches(REGION)) {
        const label = node.getAttribute('aria-label') || node.id
        return `${node.getAttribute('role') || node.localName}${label ? ` "${clean(label)}"` : ''}`
      }
    }
    return 'page'
  }

  const isVisible = element => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
  }

  const shadowHostOf = element => {
    const root = element.getRootNode()
    return root === document ? null : root.host?.localName || null
  }

  const formOf = form => {
    const method = form.querySelector('input[name=_method]')?.value || form.getAttribute('method') || 'get'
    return `${method.toUpperCase()} ${form.getAttribute('action') || location.pathname}`
  }

  const describe = element => {
    const data = element.dataset || {}
    const record = {
      role: roleOf(element),
      name: nameOf(element),
      tag: element.localName,
      type: element.getAttribute('type'),
      testid: data.testid || element.getAttribute('data-test-id') || data.cy || null,
      href: element.localName === 'a' ? element.href : null,
      method: data.turboMethod || data.method || null,
      confirm: data.turboConfirm || data.confirm || null,
      form: element.form ? formOf(element.form) : null,
      required: element.required || null,
      disabled: element.disabled || element.getAttribute('aria-disabled') === 'true' || null,
      popup: element.getAttribute('aria-haspopup'),
      controls: element.getAttribute('aria-controls'),
      expanded: element.getAttribute('aria-expanded'),
      action: data.action || null,
      target: element.getAttribute('target'),
      shadowHost: shadowHostOf(element),
      region: regionOf(element),
      visible: isVisible(element)
    }
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== ''))
  }

  const elements = []
  const headings = []
  const canvases = []
  const components = new Set()
  const forms = new Map()
  const roots = [document]

  while (roots.length) {
    const root = roots.shift()
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot)
        components.add(element.localName)
      }
      if (/^h[1-3]$/.test(element.localName) && isVisible(element)) {
        headings.push(`${element.localName}: ${clean(element.textContent)}`)
      }
      if (element.localName === 'canvas') {
        const box = element.getBoundingClientRect()
        if (box.width >= 150 && box.height >= 150) {
          canvases.push({ width: Math.round(box.width), height: Math.round(box.height), region: regionOf(element), shadowHost: shadowHostOf(element) })
        }
      }
      if (element.localName === 'form') forms.set(element, formOf(element))
      if (element.matches(INTERACTIVE)) elements.push(describe(element))
    }
  }

  return {
    title: document.title,
    headings,
    elements,
    forms: [...forms.values()],
    canvases,
    components: [...components]
  }
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
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true })
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

    const inventory = await page.evaluate(inventoryPage)
    inventory.elements.forEach(element => {
      const locator = locatorFor(element)
      if (locator) element.locator = locator
    })
    const ariaSnapshot = await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch(error => `# aria snapshot failed: ${error.message}`)
    await page.screenshot({ path: path.join(outDir, 'screens', `${slug}.png`), fullPage: true }).catch(() => {})

    const record = {
      slug,
      url: finalUrl.href,
      pattern,
      section: sectionOf(pattern),
      status: response?.status() ?? null,
      from,
      via,
      fingerprint: fingerprintOf(inventory),
      ...inventory,
      consoleErrors,
      serverErrors
    }
    fs.writeFileSync(path.join(outDir, 'pages', `${slug}.json`), JSON.stringify(record, null, 2))
    fs.writeFileSync(path.join(outDir, 'pages', `${slug}.aria.yml`), ariaSnapshot)
    index.pages.push({
      slug, url: record.url, pattern, section: record.section, title: record.title, status: record.status,
      from, via, fingerprint: record.fingerprint, canvas: inventory.canvases.length > 0,
      problems: consoleErrors.length + serverErrors.length
    })
    process.stderr.write(`[${index.pages.length}] ${pattern} ${record.status ?? ''}\n`)

    for (const link of inventory.elements.filter(element => element.href)) {
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
      queue.push({ url: target.href, from: finalUrl.pathname, via: link.name || null })
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
    pagesWithProblems: index.pages.filter(entry => entry.problems).length,
    errors: index.errors.length,
    skippedPatterns: index.skipped.length,
    unvisitedQueue: index.unvisitedQueue,
    authLost: index.authLost,
    index: path.join(outDir, 'index.json')
  }, null, 2))
  if (index.authLost) process.exitCode = 2
}

main().catch(error => fail(error.stack || String(error)))
