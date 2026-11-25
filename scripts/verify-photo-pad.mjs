// 拍照頁／確認照片頁只用手把操作：搖桿左右切換底部按鈕、✕ 執行選到的按鈕；並截圖檢查各畫面只剩手把提示。
// 需要 Vite（預設 http://127.0.0.1:5189）。用法：node scripts/verify-photo-pad.mjs <相機 y4m 絕對路徑>
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const camera = process.argv[2], base = process.env.APP_URL ?? 'http://127.0.0.1:5189/', out = 'outputs/photo-pad'
assert.ok(camera, '需要相機 y4m 絕對路徑')
await mkdir(out, { recursive: true })
const CROSS = 0, CIRCLE = 1, R1 = 5, DOWN = 13, LEFT = 14, RIGHT = 15
const KEYBOARD_HINT = /\bENTER\b|\bESC\b|\bNUM\b|WASD|右鍵|\bP 播放|\bC \//
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${camera}`] })
const errors = []
const check = (message) => console.log(`PASS ${message}`)

async function open() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })
  await context.addInitScript(() => {
    window.__pads = [{ index: 0, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }]
    navigator.getGamepads = () => window.__pads.slice()
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/generation', (route) => route.request().method() === 'POST' ? route.abort() : route.continue())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((r) => s.events.once('postupdate', r))) }
  const hold = (b = []) => page.evaluate((b) => window.__pads[0].buttons.forEach((x, n) => { x.pressed = b.includes(n); x.value = x.pressed ? 1 : 0 }), b)
  const tap = async (...buttons) => { for (const b of buttons) { await hold([b]); await frames(3); await hold(); await frames(3) } }
  const phase = () => s((s) => s.p1Model?.phase)
  const texts = () => s((s) => { const all = []; const walk = (o) => { if (typeof o.text === 'string' && o.visible !== false) all.push(o.text); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return all.join(' | ') })
  const noKeyboardHints = async (where) => { const t = await texts(); assert.ok(!KEYBOARD_HINT.test(t), `${where} 仍有鍵盤提示：${t.match(KEYBOARD_HINT)?.[0]} ⋯ ${t}`) }
  await page.goto(base)
  await page.waitForFunction(() => window.__game?.scene.getScene('AppScene')?.screen?.alpha >= 0.99, null, { timeout: 60000 }); await frames(5)
  const toCamera = async () => {
    await tap(CROSS); await page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1Model, null, { timeout: 20000 }); await frames(10)
    await s((s) => { s.p1Model.focus('P1', 2); s.p1View.sync() }); await tap(CROSS)
    assert.equal(await phase(), 'NAME')
    await tap(CROSS, CROSS, DOWN, DOWN, DOWN, DOWN, RIGHT, RIGHT, CROSS)
    assert.equal(await phase(), 'CUSTOMIZE')
    await page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1View?.cameraVideo?.videoWidth > 0, null, { timeout: 15000 })
  }
  return { page, s, tap, phase, texts, noKeyboardHints, toCamera, close: () => context.close() }
}

let g = await open()
await g.noKeyboardHints('P0'); await g.page.screenshot({ path: `${out}/p0.png` }); check('P0 提示只有手把鍵')
await g.toCamera()
await g.noKeyboardHints('拍照頁'); await g.page.screenshot({ path: `${out}/customize-default.png` }); check('拍照頁提示只有手把鍵')
await g.tap(LEFT); await g.page.screenshot({ path: `${out}/customize-skip-focused.png` })
await g.tap(CROSS)
assert.equal(await g.phase(), 'OPPONENT'); check('拍照頁：← 選到 SKIP PHOTO，✕ 跳過拍照 → 選對手')
await g.noKeyboardHints('選角'); await g.page.screenshot({ path: `${out}/grid.png` }); check('選角頁提示只有手把鍵')
await g.close()

g = await open(); await g.toCamera()
await g.tap(LEFT, LEFT, LEFT, CROSS)
assert.equal(await g.phase(), 'NAME'); check('拍照頁：← ← 停在 BACK（不會繞回），✕ 回暱稱頁')
await g.close()

g = await open(); await g.toCamera()
await g.tap(CROSS)
assert.equal(await g.phase(), 'REVIEW'); check('拍照頁：預設選 TAKE PHOTO，✕ 拍照 → 確認照片頁')
await g.noKeyboardHints('確認照片頁'); await g.page.screenshot({ path: `${out}/review.png` })
await g.tap(LEFT, CROSS)
assert.equal(await g.phase(), 'CUSTOMIZE'); check('確認照片頁：← 選 RETAKE，✕ 重拍 → 回拍照頁')
await g.page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1View?.cameraVideo?.videoWidth > 0, null, { timeout: 15000 })
await g.tap(CIRCLE)
assert.equal(await g.phase(), 'OPPONENT'); check('⭘ 快捷鍵直接跳過拍照')
await g.close()

g = await open(); await g.toCamera()
await g.tap(R1)
assert.equal(await g.phase(), 'NAME'); check('R1 快捷鍵直接回暱稱頁')
await g.tap(DOWN, DOWN, DOWN, DOWN, RIGHT, RIGHT, CROSS)
await g.page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1View?.cameraVideo?.videoWidth > 0, null, { timeout: 15000 })
await g.tap(CROSS, RIGHT, CROSS)
assert.equal(await g.phase(), 'OPPONENT'); assert.ok(await g.s((s) => s.jobs.has('P1')), '已送出生成'); check('確認照片頁：預設選 CONFIRM，✕ 確認送出 → 背景生成並進選對手')
await g.close()

assert.deepEqual(errors, [], errors.join('\n')); check('全程無頁面錯誤')
await browser.close()
