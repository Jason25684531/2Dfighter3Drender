// 固定玩家格（HW／HSI／JF／Grace＋保留空位）與隱藏角色 Jeansen（P0 連按三次 L1）的瀏覽器驗證；假手把，後端離線。
// 先啟動 Vite（http://127.0.0.1:5189）。結束碼：0 通過、1 失敗、2 SKIPPED（找不到 Playwright 或 Chrome）。
import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromium
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')); await access(executablePath) } catch (error) { console.log(`SKIPPED: ${error.message}`); process.exit(2) }
const out = 'outputs/pinned-hidden-roster', errors = []
await mkdir(out, { recursive: true })
const check = (message) => console.log(`PASS ${message}`)
const CROSS = 0, L1 = 4
const browser = await chromium.launch({ headless: true, executablePath })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
await context.addInitScript(() => {
  window.__pads = [{ index: 0, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }]
  navigator.getGamepads = () => window.__pads.slice()
})
const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
await page.route('http://localhost:8765/**', (route) => route.abort())
await page.route('http://127.0.0.1:8765/**', (route) => route.abort())
await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
const hold = (buttons = []) => page.evaluate((buttons) => window.__pads[0].buttons.forEach((b, n) => { b.pressed = buttons.includes(n); b.value = b.pressed ? 1 : 0 }), buttons)
const tap = async (button) => { await hold([button]); await frames(); await hold(); await frames() }
const waitState = (prefix, timeout = 15000) => page.waitForFunction((p) => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(p) && s.screen?.alpha >= 0.99 }, prefix, { timeout })
const boot = async () => { await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene') && window.__game.scene.getScene('AppScene').screen?.alpha >= 0.99, null, { timeout: 60000 }); await frames(3) }
const toSelect = async () => { await tap(CROSS); await waitState('P1'); await page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1Model, null, { timeout: 15000 }) }
const names = () => s((s) => s.p1Model.slots.map((slot) => [slot.index, slot.entry?.displayName ?? null, Boolean(slot.pinned)]))

await boot()
await tap(L1); await tap(L1)
assert.equal(await s((s) => s.secretUnlocked), false); check('P0 兩下 L1 不解鎖')
await page.waitForTimeout(1300); await tap(L1)
assert.equal(await s((s) => s.secretUnlocked), false); check('間隔超過 1.2 秒的第三下不算連按')
await tap(L1); await tap(L1)
assert.equal(await s((s) => s.secretUnlocked), true); check('P0 1.2 秒內連按三次 L1 解鎖隱藏角色')
await toSelect()
const unlocked = await names()
assert.deepEqual(unlocked.slice(10, 15), [[11, 'HW', true], [12, 'HSI', true], [13, 'JF', true], [14, 'Grace', true], [15, null, true]])
assert.equal(unlocked.filter(([, , pinned]) => pinned).length, 5)
assert.deepEqual(unlocked[30], [31, 'Jeansen', false])
check('選角：11–14 為 HW／HSI／JF／Grace、15 為保留空位（5 格皆有固定框）、第 31 格為 Jeansen')
await s((s) => { s.p1Model.focus('P1', 30); s.p1View.sync() }); await frames()
await tap(15)
assert.equal(await s((s) => s.p1Model.player('P1').cursor), 31); check('第 30 格按右進入第 31 格')
await page.waitForFunction(() => ['hw', 'hsi', 'jf', 'grace', 'jeansen'].every((id) => window.__game.scene.getScene('AppScene').textures.exists(`head-${id}`) || window.__game.scene.getScene('AppScene').textures.exists(`${id}-head`)), null, { timeout: 15000 }).catch(() => undefined)
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/select-unlocked.png` })

async function battle(index, label) {
  await s((s, index) => { s.p1Model.focus('P1', index); s.p1View.sync() }, index); await frames()
  await tap(CROSS)
  assert.equal(await s((s) => s.p1Model.phase), 'OPPONENT')
  await s((s) => { s.p1Model.rival.cursor = 5; s.p1View.sync() }); await frames()
  await tap(CROSS); await tap(CROSS)
  await waitState('P2'); await frames(5); await tap(CROSS)
  await waitState('P3', 20000)
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.ready === true, null, { timeout: 60000 })
  await page.screenshot({ path: `${out}/p3-${label}.png` })
  await tap(CROSS)
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'FIGHTING', null, { timeout: 20000 })
  await s((s) => { window.__attacks = 0; s.flow.match.world.subscribe((e) => { if (e.type === 'ATTACK_STARTED' && e.attacker === 'PLAYER') window.__attacks += 1 }) })
  const sprite = await s((s) => s.playerSpriteId())
  const keys = new Set()
  for (const button of [2, 3, 0, 1]) { await tap(button); for (let i = 0; i < 20; i += 1) { await frames(1); keys.add(await s((s) => { const all = []; const walk = (o) => { if (o.texture?.key) all.push(o.texture.key); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return all.filter((k) => /-(idle|attack|punch|kick|walk|jump|crouch|block|prone|intro)/.test(k)).join(',') })) } }
  const played = [...new Set([...keys].join(',').split(','))].filter((k) => k.replace(/^hd-/, '').startsWith(sprite + '-'))
  assert.ok(await page.evaluate(() => window.__attacks) >= 2, `${label} attacks`)
  assert.ok(played.length >= 3, `${label} 播放的貼圖 ${played}`)
  await page.screenshot({ path: `${out}/battle-${sprite}.png` })
  check(`${label}（${sprite}）可上場對戰：出招 ${await page.evaluate(() => window.__attacks)} 次，播放 ${played.length} 種動作貼圖 ${played.join(' ')}`)
}

await battle(31, 'Jeansen')
await s((s) => s.ui.navigation.dispatch('FINISH')); await frames(5)
for (let i = 0; i < 40 && !(await s((s) => s.appStateMachine.getCurrentState())).startsWith('P0'); i += 1) { await s((s) => s.appStateMachine.transitionTo('P0_IDLE') || s.ui.navigation.dispatch('FINISH')); await frames(3) }
await waitState('P0')
assert.equal(await s((s) => s.secretUnlocked), false); check('回到主畫面後隱藏角色清除')
await toSelect()
assert.equal((await names()).length, 30); check('清除後再進選角只剩 30 格')

for (const [index, label] of [[11, 'HW'], [12, 'HSI'], [13, 'JF'], [14, 'Grace']]) {
  await boot(); await toSelect(); await battle(index, label)
}
assert.deepEqual(errors, [], errors.join('\n'))
check('全程無頁面錯誤')
await browser.close()
