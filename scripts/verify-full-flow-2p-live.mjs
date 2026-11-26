// 雙人真實全流程（會呼叫兩次付費算圖）：P0 → 1P／2P 各選 Body 拍照送出 → 場景 → P3 等待（頭像 1P 完成後換 2P）→ 對戰 → P5 → P6 → END → P0，
// 再回選角確認兩位新角色依暫存區輪替規則落在 16 + (第幾位 % 15)。需要 Vite（5189）、後端（8765，CORS 含 5189）、ComfyUI（8188）。
// 用法：node scripts/verify-full-flow-2p-live.mjs <相機 y4m 絕對路徑>
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [camera] = process.argv.slice(2)
assert.ok(camera, '需要相機 y4m 絕對路徑')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/', out = 'outputs/full-flow-2p-live', errors = [], log = []
await mkdir(out, { recursive: true })
const started = Date.now(), elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`
const check = (message) => { const line = `PASS [${elapsed()}] ${message}`; log.push(line); console.log(line) }
const CROSS = 0, stamp = Date.now() % 10000, names = { P1: `ONE${stamp}`, P2: `TWO${stamp}` }
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${camera}`] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })
await context.addInitScript(() => {
  window.__pads = [{ index: 0, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }]
  navigator.getGamepads = () => window.__pads.slice()
})
const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
const hold = (buttons = []) => page.evaluate((buttons) => window.__pads[0].buttons.forEach((b, n) => { b.pressed = buttons.includes(n); b.value = b.pressed ? 1 : 0 }), buttons)
const tap = async (button) => { await hold([button]); await frames(); await hold(); await frames() }
const until = (fn, timeout = 15000, arg) => page.waitForFunction(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg }, { timeout, polling: 250 })
const state = () => s((s) => s.appStateMachine.getCurrentState())
const waitState = (prefix, timeout = 30000) => until((s, p) => s.appStateMachine.getCurrentState().startsWith(p) && s.screen?.alpha >= 0.99, timeout, prefix)
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })
const input = async (owner, action) => { await s((s, { owner, action }) => s.p1Input(owner, action), { owner, action }); await frames(3) }

const photo = async (owner) => {
  await until((s, o) => s.p1Model?.phase === 'NAME' && s.p1Model.owner === o, 20000, owner)
  await s((s, { owner, name }) => { s.p1Model.setNickname(owner, name); s.p1View.sync() }, { owner, name: names[owner] }); await input(owner, 'CONFIRM')
  await until((s) => s.p1Model?.phase === 'CUSTOMIZE' && s.p1View?.cameraVideo?.videoWidth > 0, 20000); await page.waitForTimeout(500)
  await input(owner, 'CONFIRM'); await until((s) => s.p1Model?.phase === 'REVIEW')
  await input(owner, 'CONFIRM'); await until((s, o) => s.jobs.has(o), 20000, owner)
  check(`${owner} 拍照送出（${names[owner]}）`)
}

try {
  await page.goto(base)
  await until((s) => s.screen?.alpha >= 0.99, 60000); await frames(3)
  await tap(CROSS); await waitState('P1'); await until((s) => s.p1Model && s.jobs.entriesReady)
  const before = await s((s) => s.jobs.entries.length)
  check(`進入選角；後端已有 ${before} 位生成角色`)
  await input('P2', 'CONFIRM')
  await s((s) => { s.p1Model.focus('P1', 2); s.p1Model.focus('P2', 3); s.p1View.sync() })
  await input('P1', 'CONFIRM'); await input('P2', 'CONFIRM')
  await photo('P1'); await photo('P2')
  await waitState('P2_SETUP', 30000); await frames(5); await tap(CROSS)
  await waitState('P3', 30000)
  check('雙人選完場景，進入 P3 練習等待生成')

  const faces = []
  for (let i = 0; i < 15 * 60; i += 1) {
    const sample = await s((s) => ({ owner: s.jobs.generatingOwner ?? '-', face: s.current?.face?.texture.key ?? '-', p1: Boolean(s.jobs.assetId('P1')), p2: Boolean(s.jobs.assetId('P2')), failed: s.jobs.failed }))
    if (!faces.length || faces.at(-1).face !== sample.face || faces.at(-1).owner !== sample.owner) { faces.push(sample); console.log(`  [${elapsed()}] generating=${sample.owner} face=${sample.face}`) }
    if (sample.owner === 'P2' && sample.p1 && !faces.some((f) => f.shot)) { await page.waitForTimeout(600); await shot('p3-face-2p'); faces.at(-1).shot = true }
    if (sample.failed) { await shot('p3-failed'); await tap(CROSS); await page.waitForTimeout(2000) }
    if (sample.p1 && sample.p2) break
    await page.waitForTimeout(1000)
  }
  assert.ok(faces.some((f) => f.owner === 'P1' && f.face === 'face-P1'), `1P 生成中顯示 1P 頭像：${JSON.stringify(faces)}`)
  assert.ok(faces.some((f) => f.owner === 'P2' && f.face === 'face-P2'), `1P 完成後顯示 2P 頭像：${JSON.stringify(faces)}`)
  check('P3 等待：1P 生成中顯示 1P 頭像，1P 完成後換成 2P 頭像')
  const assets = await s((s) => [s.jobs.assetId('P1'), s.jobs.assetId('P2')])
  check(`兩位都生成完成：${assets.join('、')}`)

  await until((s) => s.current?.ready === true, 120000); await shot('p3-ready'); await tap(CROSS)
  await waitState('P4', 30000)
  assert.deepEqual(await s((s) => [s.playerSpriteId(), s.enemySpriteId()]), assets.map((id) => `generated-${id}`))
  check('對戰雙方都是剛生成的角色')
  await s((s) => { window.__renders = []; const render = s.render.bind(s); s.render = (st) => { window.__renders.push(st); render(st) } })
  for (let i = 0; i < 400 && (await state()).startsWith('P4'); i += 1) {
    if (await s((s) => s.flow.match.getSnapshot().matchState === 'FIGHTING')) {
      await s((s) => { const f = s.flow.match.world.fighters; f.ENEMY.currentHP = Math.min(f.ENEMY.currentHP, 1); f.ENEMY.x = f.PLAYER.x + 260 })
      await tap(2)
    }
    await frames(4)
  }
  await waitState('P5', 30000); await shot('p5'); await page.waitForTimeout(6000)
  const renders = await page.evaluate(() => window.__renders.filter((st) => st.startsWith('P5')).length)
  assert.equal(renders, 1, `勝利畫面只建一次（後端存好成績不重建），實際 ${renders} 次`)
  check('P5 勝利畫面只建立一次，後端存成績時沒有重播')
  for (let i = 0; i < 60 && !(await state()).startsWith('P6'); i += 1) { await tap(CROSS); await page.waitForTimeout(500) }
  await waitState('P6', 30000); await page.waitForTimeout(2500); await shot('p6')
  check(`結算 P6；排名 ${await s((s) => s.persistence?.context.snapshot.backendRank ?? 'n/a')}`)
  for (let i = 0; i < 20 && !(await state()).startsWith('P7'); i += 1) { await tap(CROSS); await page.waitForTimeout(500) }
  await waitState('P7', 30000); await shot('end')
  // END 預設焦點是 PLAY AGAIN；往下選 FINISH 才回主畫面。
  await tap(13); await tap(CROSS)
  await waitState('P0', 30000)
  check('END 選 FINISH → 回到 P0')

  await tap(CROSS); await waitState('P1'); await until((s) => s.p1Model && s.jobs.entriesReady)
  const placed = await s((s, ids) => ids.map((id) => ({ id, shown: s.p1Model.slots.find((slot) => slot.entry?.generationId === id)?.index, slot: s.jobs.entries.find((entry) => entry.generationId === id)?.slot })), assets)
  for (const { id, shown, slot } of placed) assert.ok(slot >= 16 && slot <= 30 && shown === slot, `${id} 後端格號 ${slot}、畫面格號 ${shown}`)
  assert.equal(placed[1].slot, placed[0].slot === 30 ? 16 : placed[0].slot + 1, '2P 接在 1P 的下一格（30 之後回 16）')
  await page.waitForTimeout(1500); await shot('roster')
  check(`新角色依序入格：${placed.map(({ id, slot }) => `${id} → ${slot}`).join('、')}`)
  assert.deepEqual(errors, [], errors.join('\n'))
  check('全程無頁面錯誤')
} catch (error) {
  await shot('FAIL').catch(() => undefined)
  log.push(`FAIL [${elapsed()}] ${error.message}`); console.log(`FAIL [${elapsed()}] ${error.message}`); process.exitCode = 1
} finally {
  await writeFile(`${out}/log.txt`, [...log, '', 'page errors:', ...errors].join('\n'))
  await browser.close()
}
