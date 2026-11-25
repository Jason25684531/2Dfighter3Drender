// 待機忽大忽小檢查：指定格子的角色（預設 Body 04＝S3WW，Body 會跳過拍照）上場，站著不動時逐格記錄畫面使用的影格與縮放，
// 再用原圖每格的人物身高換算成畫面上的身高，比較最大／最小。需要 Vite（預設 http://127.0.0.1:5189）。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/', body = Number(process.argv[2] ?? 4)
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  window.__pads = [{ index: 0, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }]
  navigator.getGamepads = () => window.__pads.slice()
})
await page.route('**/api/v1/**', (route) => route.abort())
await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((r) => s.events.once('postupdate', r))) }
const hold = (b = []) => page.evaluate((b) => window.__pads[0].buttons.forEach((x, n) => { x.pressed = b.includes(n); x.value = x.pressed ? 1 : 0 }), b)
const tap = async (...bs) => { for (const b of bs) { await hold([b]); await frames(3); await hold(); await frames(3) } }
const until = (fn, timeout = 30000) => page.waitForFunction(new Function(`return (${fn.toString()})(window.__game.scene.getScene('AppScene'))`), null, { timeout, polling: 200 })
const CROSS = 0, CIRCLE = 1, DOWN = 13, RIGHT = 15

await page.goto(base)
await until((s) => s.screen?.alpha >= 0.99, 60000); await frames(5)
await tap(CROSS); await until((s) => s.p1Model && s.jobs.entriesReady); await frames(5)
await s((s, i) => { s.p1Model.focus('P1', i); s.p1View.sync() }, body); await tap(CROSS)
if (await s((s) => s.p1Model.phase === 'NAME')) {
  await tap(CROSS, DOWN, DOWN, DOWN, DOWN, RIGHT, RIGHT, CROSS)
  await until((s) => s.p1Model?.phase === 'CUSTOMIZE'); await frames(5)
  await tap(CIRCLE)
}
await until((s) => s.p1Model?.phase === 'OPPONENT')
await s((s, i) => { s.p1Model.rival.cursor = i === 5 ? 6 : 5; s.p1View.sync() }, body)
await tap(CROSS, CROSS)
await until((s) => s.appStateMachine.getCurrentState().startsWith('P2') && s.screen?.alpha >= 0.99); await frames(5); await tap(CROSS)
await until((s) => s.current?.ready === true, 60000); await tap(CROSS)
await until((s) => s.flow.match.getSnapshot().matchState === 'FIGHTING')
await until((s) => s.current.view.player.image?.texture.key.startsWith('hd-'), 20000)
const samples = await page.evaluate(async () => {
  const s = window.__game.scene.getScene('AppScene'), image = s.current.view.player.image, out = []
  const span = (frame) => {
    const c = Object.assign(document.createElement('canvas'), { width: 128, height: 256 }).getContext('2d', { willReadFrequently: true })
    c.drawImage(frame.source.image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, 128, 256)
    const d = c.getImageData(0, 0, 128, 256).data, rows = []
    for (let y = 0; y < 256; y++) { let n = 0; for (let x = 0; x < 128; x++) if (d[(y * 128 + x) * 4 + 3] > 32) n++; if (n >= 2) rows.push(y) }
    return (rows.at(-1) - rows[0]) / 256
  }
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => s.events.once('postupdate', r))
    out.push({ key: image.texture.key, frame: String(image.frame.name), shown: span(image.frame) * image.displayHeight })
  }
  return out
})
await page.screenshot({ path: `outputs/scale-audit/idle-battle-${body}.png` })
const idle = samples.filter((x) => x.key.endsWith('-idle'))
const byFrame = Object.fromEntries(idle.map((x) => [x.frame, Math.round(x.shown)]))
const heights = Object.values(byFrame), spread = Math.max(...heights) / Math.min(...heights)
console.log(`sprite ${idle[0]?.key}  frames seen ${Object.keys(byFrame).length}  on-screen body height per frame`, byFrame)
console.log(`max/min ${spread.toFixed(3)}`)
assert.ok(Object.keys(byFrame).length >= 6, 'idle loop sampled')
assert.ok(spread < 1.045, `idle body height spread ${spread.toFixed(3)} must stay under 4.5%`)
assert.deepEqual(errors, [], errors.join('\n'))
console.log('PASS 待機循環中畫面上的身高差異低於 4.5%')
await browser.close()
