// 實測：首頁排行榜、1P 選對手（取消重選／返回層級）、起手序列、AI profile。先啟動 Vite（預設 http://127.0.0.1:5189）。
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const out = 'outputs/opponent-flow-verification', errors = []
await mkdir(out, { recursive: true })
const check = (message) => console.log('PASS ' + message)
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost:8000/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async (name) => { await page.keyboard.press(name); await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
  const state = () => s((s) => s.appStateMachine.getCurrentState())
  const sub = () => s((s) => s.ui.substates.get('P2_SETUP'))
  const waitState = (prefix, timeout = 10000) => page.waitForFunction((p) => window.__game.scene.getScene('AppScene').appStateMachine.getCurrentState().startsWith(p), prefix, { timeout })
  const toOpponent = async () => { await key('Enter'); await waitState('P1'); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/00-p1-grid.png` }); await key('j'); await waitState('P2', 15000); assert.equal(await sub(), 'OPPONENT') }

  // 1 首頁排行榜
  await waitState('P0'); assert.equal(await s((s) => s.ui.focus.current()), 'p0-start')
  await key('ArrowRight'); assert.equal(await s((s) => s.ui.focus.current()), 'p0-board')
  await key('Enter'); assert.ok(await s((s) => Boolean(s.boardPanel))); assert.match(await state(), /^P0/)
  await page.screenshot({ path: `${out}/01-board.png` })
  await key('Enter'); assert.ok(!(await s((s) => Boolean(s.boardPanel)))); assert.match(await state(), /^P0/)
  await key('Escape'); assert.match(await state(), /^P0/)
  check('排行榜按鈕開啟面板（離線有明確狀態）、ENTER 關閉、P0 不變')

  // 2 1P 選對手
  await key('ArrowLeft'); await toOpponent()
  const ids = await s((s) => s.opponentModel.candidates.map((c) => c.id)); assert.ok(!ids.includes('preset-a')); assert.ok(ids.length >= 5)
  await page.screenshot({ path: `${out}/02-opponent.png` })
  await key('Enter'); assert.equal(await s((s) => s.opponentModel.canProceed()), true); assert.equal(await s((s) => s.ui.focus.current()), 'opp-next')
  await key('Escape'); assert.equal(await s((s) => s.opponentModel.canProceed()), false); assert.equal(await sub(), 'OPPONENT'); assert.match(await state(), /^P2/)
  check('選定對手後 BACK 取消、留在 OPPONENT、NEXT 停用，可重選')
  await key('Enter'); await key('ArrowLeft'); await key('Enter') // 鎖定 → 焦點 NEXT → 左移到難度 → 確認循環
  assert.equal(await s((s) => s.opponentModel.difficulty), 'HARD')
  await key('ArrowRight')
  await key('Enter'); assert.equal(await sub(), 'DEFAULT')
  await key('Escape'); assert.equal(await sub(), 'OPPONENT'); assert.equal(await s((s) => s.opponentModel.canProceed()), true)
  await key('Escape'); assert.equal(await s((s) => s.opponentModel.canProceed()), false); assert.match(await state(), /^P2/)
  await key('Escape'); assert.match(await state(), /^P1/)
  check('STAGE→OPPONENT 保留選擇；再 BACK 取消；再 BACK 回 P1')

  // 3 進戰鬥：對手名稱、AI profile、起手序列
  await key('Escape'); await waitState('P0'); await toOpponent()
  await key('Enter'); await key('Enter') // 鎖定並進 NEXT
  assert.equal(await sub(), 'DEFAULT'); const enemy = await s((s) => s.enemyName()); assert.notEqual(enemy, 'ROG_SAGA')
  await s((s) => s.confirmStage()); await waitState('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').loadingReady === true, null, { timeout: 15000 })
  assert.equal(await s((s) => s.loadingPercent.text), 'READY')
  await key('Enter'); await waitState('P4')
  assert.equal(await s((s) => s.match.ai.profile.id), 'NORMAL')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').match.getSnapshot().introPhase === 'ROUND')
  const frozen = await s((s) => s.match.getSnapshot().remainingTicks); await page.screenshot({ path: `${out}/03-round.png` })
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').match.getSnapshot().introPhase === 'READY')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').match.getSnapshot().introPhase === 'FIGHT')
  const t = await s((s) => s.match.getSnapshot()); assert.equal(t.matchState, 'FIGHTING'); assert.ok(t.remainingTicks >= frozen - 3)
  assert.equal(await s((s) => s.battleBanner.label.text), 'FIGHT!'); await page.screenshot({ path: `${out}/04-fight.png` })
  check('P3 顯示 READY；P4 依序 ROUND→READY?→FIGHT!，期間時間不減；對手與 NORMAL AI 已套用')
  assert.deepEqual(errors, [], errors.join('\n'))
} finally { await browser.close() }
