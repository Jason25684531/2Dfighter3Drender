// 真實 ComfyUI 全流程（會呼叫付費算圖）：P0 → Body → 暱稱 → 假相機拍照 → 送出 → P3 等待 → 生成角色上場 → 回名錄。
// 需要 Vite（5189）、後端（8765，CORS 含 5189）與 ComfyUI（8188）都在跑。
// 用法：node scripts/verify-generation-live.mjs <相機 y4m> [暱稱] [Body 1–4]
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const [camera, nickname = `LIVE${Date.now() % 100000}`, body = '2'] = process.argv.slice(2)
assert.ok(camera, '需要相機 y4m 路徑')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/', out = 'outputs/generation-live-261125', errors = [], log = []
await mkdir(out, { recursive: true })
const started = Date.now(), elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`
const check = (message) => { const line = `PASS [${elapsed()}] ${message}`; log.push(line); console.log(line) }
const CROSS = 0
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${camera}`] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })
await context.addInitScript(() => {
  window.__pads = [{ index: 0, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }]
  navigator.getGamepads = () => window.__pads.slice()
})
const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
const generationCalls = []
page.on('response', (response) => { if (response.url().includes('/generation')) generationCalls.push(`${response.request().method()} ${response.url().replace(/^.*\/api\/v1/, '')} ${response.status()}`) })
await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
const hold = (buttons = []) => page.evaluate((buttons) => window.__pads[0].buttons.forEach((b, n) => { b.pressed = buttons.includes(n); b.value = b.pressed ? 1 : 0 }), buttons)
const tap = async (button) => { await hold([button]); await frames(); await hold(); await frames() }
const until = (fn, timeout = 15000, arg) => page.waitForFunction(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg }, { timeout, polling: 250 })
const waitState = (prefix, timeout = 20000) => until((s, p) => s.appStateMachine.getCurrentState().startsWith(p) && s.screen?.alpha >= 0.99, timeout, prefix)
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })

try {
  await page.goto(base)
  await until((s) => s.screen?.alpha >= 0.99, 60000); await frames(3)
  await tap(CROSS); await waitState('P1'); await until((s) => s.p1Model && s.jobs.entriesReady)
  const before = await s((s) => s.jobs.entries.map((entry) => entry.id))
  check(`P0 → 選角；後端名錄目前 ${before.length} 位生成角色，連線 ${await s((s) => s.persistence?.lastLeaderboardOk !== false ? 'ONLINE' : 'OFFLINE')}`)
  await s((s, i) => { s.p1Model.focus('P1', i); s.p1View.sync() }, Number(body)); await frames()
  await tap(CROSS); await until((s) => s.p1Model?.phase === 'NAME')
  await page.keyboard.type(nickname); await frames(2); await shot('01-name')
  await page.keyboard.press('Enter'); await until((s) => s.p1Model?.phase === 'CUSTOMIZE')
  await until((s) => s.p1View?.cameraVideo?.videoWidth > 0, 20000)
  const resolution = await s((s) => `${s.p1View.cameraVideo.videoWidth}x${s.p1View.cameraVideo.videoHeight}`)
  await page.waitForTimeout(800); await shot('02-camera')
  check(`暱稱 ${nickname}，Body 0${body}，假相機畫面 ${resolution}`)
  await tap(CROSS); await until((s) => s.p1Model?.phase === 'REVIEW'); await page.waitForTimeout(500); await shot('03-review')
  const photoBytes = await s((s) => s.p1Model.player('P1').photo?.length ?? 0)
  assert.ok(photoBytes > 10000, `拍到的照片 dataURL 長度 ${photoBytes}`)
  check(`拍照完成，照片 dataURL ${Math.round(photoBytes / 1024)} KB，進入確認頁`)
  await tap(CROSS)
  await until((s) => s.jobs.has('P1'), 20000)
  check(`確認送出，前端已建立生成工作；API：${generationCalls.join('、')}`)
  await until((s) => s.p1Model?.phase === 'OPPONENT', 20000); await shot('04-opponent')
  await tap(CROSS); await tap(CROSS)
  await waitState('P2'); await frames(5); await tap(CROSS)
  await waitState('P3', 30000); await page.waitForTimeout(1000); await shot('05-p3-generating')
  check('選完對手與場景，進入 P3 練習等待生成')
  for (let attempt = 1; ; attempt += 1) {
    await until((s) => s.jobs.assetId('P1') || s.jobs.failed, 15 * 60 * 1000)
    if (!(await s((s) => s.jobs.failed))) break
    await page.waitForTimeout(800); await shot(`05-failed-${attempt}`)
    assert.ok(attempt <= 2, '重試 2 次仍失敗')
    check(`第 ${attempt} 次生成失敗，P3 顯示 RETRY；按確認重試`)
    await tap(CROSS); await until((s) => !s.jobs.failed && s.jobs.generating, 20000)
  }
  const assetId = await s((s) => s.jobs.assetId('P1'))
  assert.ok(assetId, '生成完成要有 assetId')
  check(`ComfyUI 生成完成並載入遊戲：${assetId}`)
  await until((s) => s.current?.ready === true, 60000); await page.waitForTimeout(1000); await shot('06-p3-ready')
  await tap(CROSS)
  await until((s) => s.flow.match.getSnapshot().matchState === 'FIGHTING', 30000)
  const sprite = await s((s) => s.playerSpriteId())
  assert.equal(sprite, `generated-${assetId}`)
  await s((s) => { window.__attacks = 0; s.flow.match.world.subscribe((e) => { if (e.type === 'ATTACK_STARTED' && e.attacker === 'PLAYER') window.__attacks += 1 }) })
  for (const button of [2, 3, 0, 1]) { await tap(button); await frames(20) }
  await shot('07-battle')
  const attacks = await page.evaluate(() => window.__attacks)
  assert.ok(attacks >= 2, `出招次數 ${attacks}`)
  check(`對戰中 1P 使用 ${sprite}，出招 ${attacks} 次`)
  await s((s) => s.appStateMachine.transitionTo('P0_IDLE')); await waitState('P0')
  await tap(CROSS); await waitState('P1'); await until((s) => s.p1Model && s.jobs.entriesReady)
  const slot = await s((s, id) => s.p1Model.slots.find((slot) => slot.entry?.generationId === id)?.index, assetId)
  assert.ok(slot >= 16 && slot <= 30, `名錄格 ${slot}`)
  await page.waitForTimeout(1500); await shot('08-roster')
  check(`回選角，新角色出現在玩家區第 ${slot} 格（固定格 11–15 之後）`)
  assert.deepEqual(errors, [], errors.join('\n'))
  check('全程無頁面錯誤')
} catch (error) {
  await shot('FAIL').catch(() => undefined)
  log.push(`FAIL [${elapsed()}] ${error.message}`); console.log(`FAIL [${elapsed()}] ${error.message}`); process.exitCode = 1
} finally {
  await writeFile(`${out}/log.txt`, [...log, '', 'generation API calls:', ...generationCalls, '', 'page errors:', ...errors].join('\n'))
  await browser.close()
}
