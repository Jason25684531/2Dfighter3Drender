// 實測：長官排序＋YG、暱稱與拍照分兩頁（含 2P 同名檢查）、算圖送出後不可回上一頁／主選單。先啟動 Vite（預設 http://127.0.0.1:5189/）；後端以假回應取代，算圖狀態由腳本控制。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const out = 'outputs/render-lock-pages', errors = []
await mkdir(out, { recursive: true })
const check = (message) => console.log('PASS ' + message)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })).newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => errors.push(error.message))
  let generation = 'processing'
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' }
  await page.route('http://localhost:8765/**', async (route) => {
    const { pathname } = new URL(route.request().url()), method = route.request().method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (pathname.endsWith('/generation') && method === 'POST') return route.fulfill({ headers: cors, body: JSON.stringify({ job: 'job-1' }) })
    if (pathname.endsWith('/generation/job-1')) return route.fulfill({ headers: cors, body: JSON.stringify({ status: generation }) })
    if (pathname.endsWith('/generation/assets')) return route.fulfill({ headers: cors, body: '[]' })
    return route.abort()
  })
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const tick = () => s((s) => new Promise((resolve) => s.events.once('postupdate', resolve)))
  const key = async (name) => { await page.keyboard.down(name); await tick(); await page.keyboard.up(name); await tick() }
  const waitState = (prefix) => page.waitForFunction((p) => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(p) && s.screen?.alpha >= 0.99 }, prefix)
  const waitPhase = (phase) => page.waitForFunction((p) => window.__game.scene.getScene('AppScene').p1Model?.phase === p, phase)
  const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png` }) }
  const home = async () => { await s((s) => { s.jobs.clear(); s.appStateMachine.transitionTo('P0_IDLE') }); await waitState('P0') }
  const start = async () => { await key('Enter'); await waitState('P1'); await waitPhase('GRID'); await page.waitForTimeout(500) }
  const notice = () => s((s) => s.lockedNotice?.text ?? null)
  await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene')); await waitState('P0')

  // 1 長官區順序與 YG
  await start()
  const officers = await s((s) => s.p1Model.slots.slice(4, 10).map((slot) => slot.entry.displayName))
  assert.deepEqual(officers, ['GO', 'SE7EN', 'Joneey', 'YG', 'Tony', 'Chris'])
  await page.waitForFunction(() => ['go', 'se7en', 'joneey', 'yg', 'tony', 'chris'].every((id) => window.__game.textures.exists(`head-${id}`) || window.__game.textures.getTextureKeys().some((k) => k.includes(id) && k.includes('head'))), null, { timeout: 15000 }).catch(() => undefined)
  await shot('01-officers-grid')
  for (let i = 0; i < 3; i++) await key('d')
  assert.equal(await s((s) => s.p1Model.heroSlot('P1').entry.displayName), 'YG')
  await page.waitForFunction(() => window.__game.textures.exists('hd-yg-idle'), null, { timeout: 20000 })
  await shot('02-yg-hero')
  check('OFFICERS 05–10 依序為 GO、SE7EN、Joneey、YG、Tony、Chris；游標移到第 8 格顯示 YG 大圖（hd-yg-idle 已載入）')

  // 2 YG 走完整流程進對戰
  await key('f'); await waitPhase('OPPONENT'); await key('f'); await waitPhase('DIFFICULTY'); await key('f'); await waitPhase('ALL_READY')
  await waitState('P2'); await shot('03-stage-select'); await key('Enter'); await waitState('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current.ready === true, null, { timeout: 30000 })
  await shot('04-practice-yg'); await key('Enter'); await waitState('P4')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'FIGHTING', null, { timeout: 30000 })
  assert.match(await s((s) => s.current.view.player.image.texture.key), /yg-/)
  await page.waitForTimeout(800); await shot('05-battle-yg')
  check('選 YG → 對手 → 難度 → 選場景 → 練習 → 對戰：YG 以自己的圖集（yg-*）出場')
  await home()

  // 3 暱稱頁 → 拍照頁 → 確認頁（1P）
  await start(); await key('a'); await key('f'); await waitPhase('NAME')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT')
  assert.equal(await page.locator('video').count(), 0)
  assert.match(await s((s) => s.p1View.stepLabel.text), /02 \/ 05 · 輸入暱稱/)
  await shot('06-name-page')
  await key('Enter'); assert.equal(await s((s) => s.p1Model.phase), 'NAME') // 空名稱不能往下
  await page.locator('input').fill('Kazu'); await page.keyboard.press('Enter'); await waitPhase('CUSTOMIZE')
  assert.equal(await page.locator('input').count(), 0); assert.equal(await page.locator('video').count(), 1)
  assert.match(await s((s) => s.p1View.stepLabel.text), /03 \/ 05 · 拍照/)
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); await shot('07-photo-page')
  await key('k'); await waitPhase('NAME'); assert.equal(await page.locator('input').inputValue(), 'Kazu')
  await key('Enter'); await waitPhase('CUSTOMIZE')
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await key('f'); await waitPhase('REVIEW'); await shot('08-review-page')
  check('1P：暱稱頁（自動聚焦、空名稱擋下）→ 拍照頁（只有取景＋L 型標記）→ BACK 回暱稱頁保留名稱 → 拍照 → 確認頁')

  // 4 算圖送出後不能返回
  generation = 'processing'
  await key('f'); await waitPhase('OPPONENT')
  assert.equal(await s((s) => s.jobs.locked), true)
  await key('k'); assert.equal(await s((s) => s.p1Model.phase), 'OPPONENT'); assert.match(await notice(), /無法返回/)
  await key('Escape'); assert.ok((await s((s) => s.appStateMachine.getCurrentState())).startsWith('P1')); await shot('09-locked-select')
  await key('f'); await waitPhase('DIFFICULTY'); await key('f'); await waitPhase('ALL_READY'); await waitState('P2')
  await key('Escape'); assert.ok((await s((s) => s.appStateMachine.getCurrentState())).startsWith('P2'))
  await key('Enter'); await waitState('P3'); await key('Escape')
  assert.ok((await s((s) => s.appStateMachine.getCurrentState())).startsWith('P3')); assert.match(await notice(), /無法返回/); await shot('10-locked-practice')
  check('算圖進行中：選角 BACK／Esc、選場景 Esc、練習 Esc 都被擋下並顯示提示，狀態不變')
  generation = 'failed'
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').jobs.failed === true, null, { timeout: 20000 })
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').jobs.assets === 'ready')
  await key('Enter')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').jobs.generating)
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').jobs.failed)
  await key('ArrowDown')
  assert.equal(await s(s => s.ui.focus.current()), 'loading-skip-generation')
  await key('Enter'); await waitState('P4')
  assert.equal(await s(s => s.current.view.player.spriteId), 's3ww')
  check('算圖失敗後可重試，也可略過生成並以暫用身形開戰')
  await home()

  // 5 2P：兩人各自暱稱頁 → 拍照頁；2P 不能與 1P 同名；2P 返回只影響自己
  generation = 'processing'
  await start(); await key('Numpad1'); assert.equal(await s((s) => s.p1Model.player('P2').joined), true)
  await key('a'); await key('f'); for (let i = 0; i < 3; i++) await key('ArrowLeft'); await key('Numpad1'); await waitPhase('NAME')
  assert.equal(await s((s) => s.p1Model.owner), 'P1')
  await page.locator('input').fill('Kazu'); await page.keyboard.press('Enter'); await waitPhase('CUSTOMIZE')
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await key('f'); await waitPhase('REVIEW'); await key('f')
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('AppScene'); return s.p1Model.owner === 'P2' && s.p1Model.phase === 'NAME' })
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT'); assert.equal(await page.locator('input').inputValue(), '')
  assert.match(await s((s) => s.p1View.nameHint.text), /ENTER A NAME FIRST/)
  await shot('11-p2-name-page')
  await page.keyboard.type('kazu'); await page.keyboard.press('Enter')
  assert.equal(await s((s) => s.p1Model.phase), 'NAME'); assert.match(await s((s) => s.p1View.nameHint.text), /NAME ALREADY USED/)
  await shot('12-p2-name-taken')
  await page.locator('input').fill('Lee'); await page.keyboard.press('Enter'); await waitPhase('CUSTOMIZE')
  assert.equal(await s((s) => s.p1Model.owner), 'P2'); await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); await shot('13-p2-photo-page')
  await key('Backspace'); await waitPhase('NAME'); assert.equal(await page.locator('input').inputValue(), 'Lee')
  await key('Escape'); await key('Escape'); await page.waitForTimeout(200)
  check('2P：輪到 2P 時重新進暱稱頁並自動聚焦；與 1P 同名（不分大小寫）被擋並提示 NAME ALREADY USED；改名後進 2P 拍照頁；2P BACK 回暱稱頁')
  assert.equal(await s((s) => s.jobs.locked), true)
  check('1P 已送出算圖、2P 還在輸入時，鎖定維持')

  assert.deepEqual(errors, [])
} finally { await browser.close() }
