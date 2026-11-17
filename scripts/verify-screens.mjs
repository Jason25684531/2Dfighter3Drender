// 單人完整流程 P0→P7 截圖，並記錄所有 /test-assets/ 請求與 404。先啟動 Vite（預設 http://127.0.0.1:5189）。
// 用法：node scripts/verify-screens.mjs [輸出資料夾]
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const out = process.argv[2] ?? 'outputs/screens-verification'
await mkdir(out, { recursive: true })
const errors = [], requested = new Set(), missing = new Set()
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const path = decodeURIComponent(new URL(response.url()).pathname)
    if (!path.startsWith('/test-assets/')) return
    requested.add(path)
    if (response.status() === 404) missing.add(path)
  })
  await page.route('http://localhost:8000/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'), null, { timeout: 60000 })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async (name) => { await page.keyboard.press(name); await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
  const waitState = (prefix, timeout = 15000) => page.waitForFunction((p) => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(p) && (s.screen?.alpha ?? 1) >= 0.99 }, prefix, { timeout })
  const texts = () => s((s) => { const found = []; const walk = (o) => { if (o.type === 'Text' && o.visible && o.text) found.push(o.text); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return found })
  const waitText = (pattern, timeout = 20000) => page.waitForFunction((source) => { const re = new RegExp(source), found = []; const walk = (o) => { if (o.type === 'Text' && o.visible) found.push(o.text); (o.list ?? []).forEach(walk) }; window.__game.scene.getScene('AppScene').children.list.forEach(walk); return found.some((t) => re.test(t)) }, pattern.source, { timeout })
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); console.log('SHOT ' + name) }
  const world = (fn) => s((s, code) => new Function('w', `return (${code})(w)`)(s.flow.match.world), fn.toString())

  await waitState('P0'); await shot('p0-home')
  await key('Enter'); await waitState('P1'); await page.waitForTimeout(600); await shot('p1-grid')
  await key('d'); await key('f'); await shot('p1-opponent')
  await key('f'); await shot('p1-difficulty')
  await key('f'); await waitState('P2'); await shot('p2-stage')
  await key('Enter'); await waitState('P3')
  await waitText(/^READY$|就緒/); await shot('p3-loading-ready')
  assert.ok((await texts()).some((t) => /FIGHT!/.test(t)), 'P3 shows the FIGHT! button')
  await key('Enter'); await waitState('P4')
  await waitText(/^FIGHT!$/); await page.waitForTimeout(900); await shot('p4-battle')
  await key('Escape'); await waitText(/^PAUSED$/); await shot('p4-pause')
  await key('Enter'); await page.waitForFunction(() => !window.__game.scene.getScene('AppScene').ui.navigation.isOverlayOpen())
  await world((w) => { w.fighters.ENEMY.currentHP = 0 }); await waitText(/^ROUND 2$/, 15000); await waitText(/^FIGHT!$/)
  await world((w) => { w.fighters.ENEMY.currentHP = 0 }); await waitState('P5'); await page.waitForTimeout(1200); await shot('p5-presentation')
  const p5 = await texts(); assert.ok(p5.includes('K.O.') && p5.includes('YOU WIN'), p5.join('|'))
  await key('Enter'); await waitState('P6'); await page.waitForTimeout(600); await shot('p6-result')
  await key('Enter'); await waitState('P7'); await shot('p7-end')
  await key('ArrowDown'); await key('Enter'); await waitState('P0')
  console.log('PASS 單人流程 P0→P7→P0 走完')
  await writeFile(`${out}/assets.json`, JSON.stringify({ requested: [...requested].sort(), missing: [...missing].sort() }, null, 2))
  assert.deepEqual([...missing], [], `404: ${[...missing].join(', ')}`)
  console.log(`PASS /test-assets/ 請求 ${requested.size} 個，0 個 404`)
  assert.deepEqual(errors, [], errors.join('\n'))
  console.log('PASS 沒有頁面錯誤')
} finally { await browser.close() }
