// 實測：CONTROLS 切 2P 改鍵（跨玩家衝突被拒）→ 2P 以新確認鍵加入 → 雙人戰鬥 2P 操作 ENEMY、不呼叫 AI → 連擊標語、倒地震動。先啟動 Vite（預設 http://127.0.0.1:5189）。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const out = 'outputs/versus-verification', errors = []
await mkdir(out, { recursive: true })
const check = (message) => console.log('PASS ' + message)
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost:8000/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async (name) => { await page.keyboard.press(name); await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
  const waitState = (prefix, timeout = 10000) => page.waitForFunction((p) => window.__game.scene.getScene('AppScene').appStateMachine.getCurrentState().startsWith(p), prefix, { timeout })
  const texts = () => s((s) => { const out = []; const walk = (o) => { if (o.type === 'Text' && o.visible) out.push(o.text); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return out })
  const panel = () => s((s) => ({ title: s.controlsPanel.title.text, message: s.controlsPanel.message.text, light: s.controlsPanel.rows[4].key.text }))
  await waitState('P0')

  // 1 CONTROLS 切到 2P；綁 F（1P 輕拳）被拒，綁 L 成功
  await key('c'); assert.match((await panel()).title, /PLAYER 1/)
  await key('ArrowRight'); assert.match((await panel()).title, /PLAYER 2/); assert.equal((await panel()).light, '[ NUM 1 ]')
  for (let i = 0; i < 4; i++) await key('ArrowDown')
  await key('Enter'); await key('f'); assert.equal((await panel()).message, 'F IS USED BY PLAYER 1')
  await key('l'); assert.deepEqual([(await panel()).light, (await panel()).message], ['[ L ]', 'SAVED'])
  await page.screenshot({ path: `${out}/01-controls-p2.png` })
  await key('Escape'); assert.equal(await s((s) => Boolean(s.controlsPanel)), false)
  check('CONTROLS ← → 切到 PLAYER 2；綁 1P 的 F 被拒（F IS USED BY PLAYER 1）；綁 L 存檔')

  // 2 2P 以新確認鍵 L 加入，Enter 不再加入
  await key('Enter'); await waitState('P1'); await page.waitForTimeout(600)
  await key('Enter'); assert.equal(await s((s) => s.p1Model.player('P2').joined), false)
  assert.ok((await texts()).some((t) => t.includes('PRESS L TO JOIN')))
  await key('l'); assert.equal(await s((s) => s.p1Model.player('P2').joined), true)
  await key('ArrowRight'); await key('ArrowRight'); await key('l'); await key('f')
  assert.ok((await texts()).some((t) => t.includes('1P VS 2P')))
  await waitState('P2'); await key('Enter'); await waitState('P3'); await key('Enter'); await waitState('P4')
  check('2P 按改過的確認鍵 L 加入（Enter 無效），提示顯示 L；雙人鎖定進入戰鬥')

  // 3 2P 操作 ENEMY，AI 不被呼叫
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'FIGHTING', null, { timeout: 15000 })
  await s((s) => { window.__aiCalls = 0; const ai = s.flow.match.ai, get = ai.getIntent.bind(ai); ai.getIntent = (...args) => { window.__aiCalls += 1; return get(...args) } })
  assert.ok((await texts()).includes('2P')); assert.ok(!(await texts()).some((t) => /CPU/.test(t)))
  const x0 = await s((s) => s.flow.match.getSnapshot().world.fighters.ENEMY.x)
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft')
  const x1 = await s((s) => s.flow.match.getSnapshot().world.fighters.ENEMY.x)
  assert.ok(x1 < x0, `ENEMY should walk left: ${x0} -> ${x1}`)
  await s((s) => { window.__enemyAttacks = 0; s.flow.match.world.subscribe((e) => { if (e.type === 'ATTACK_STARTED' && e.attacker === 'ENEMY') window.__enemyAttacks += 1 }) })
  await key('l'); await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.__enemyAttacks), 1); assert.equal(await page.evaluate(() => window.__aiCalls), 0)
  check('HUD 標示 2P（無 CPU）；2P 按 ← 讓 ENEMY 左移、按 L 出拳；EnemyAI 呼叫 0 次')

  // 4 連擊標語與倒地震動（暫停時鐘後以真實 snapshot 呼叫呈現層）
  await s((s) => { s.clock.pause(); const w = s.flow.match.world; w.fighters.ENEMY.combo = 3; w.fighters.PLAYER.combo = 4; s.updateBattle(s.flow.match.getSnapshot()) })
  assert.deepEqual(await s((s) => ['PLAYER', 'ENEMY'].map((id) => { const c = s.battleView.combos[id]; return [c.visible, c.x, `${c.hitCount.text} ${c.word.text}`] })), [[true, 60, '4 HITS GREAT!'], [true, 1860, '3 HITS COMBO!']])
  await page.waitForTimeout(200); await page.screenshot({ path: `${out}/02-combo-callouts.png` })
  await s((s) => { s.tickEvents.push({ type: 'KNOCKDOWN', fighter: 'ENEMY' }); s.updateBattle(s.flow.match.getSnapshot()) })
  assert.equal(await s((s) => s.cameras.main.shakeEffect.isRunning), true)
  await s((s) => { const w = s.flow.match.world; w.fighters.ENEMY.combo = 0; s.updateBattle(s.flow.match.getSnapshot()) })
  await page.waitForTimeout(400); assert.equal(await s((s) => s.battleView.combos.ENEMY.visible), false)
  check('塗鴉連擊標語：站左的 1P 在左側 4 HITS GREAT!、站右的 2P 在右側 3 HITS COMBO!，歸零淡出隱藏；KNOCKDOWN 觸發畫面震動')

  assert.deepEqual(errors, [])
} finally { await browser.close() }
