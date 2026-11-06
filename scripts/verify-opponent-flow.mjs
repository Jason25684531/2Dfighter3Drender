// 實測：首頁排行榜、1P 在選角頁選對手與難度、P2 只選場景、起手序列、命中／防禦特效、回合 K.O. 停留與 Announcer、P5、Replay。先啟動 Vite（預設 http://127.0.0.1:5189）。
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
  const model = () => s((s) => ({ phase: s.p1Model?.phase, rival: s.p1Model?.rival, locked: s.p1Model?.player('P1').locked, p2: s.p1Model?.player('P2').joined }))
  // P0 → P1 → 1P 鎖定 05（ARIA）→ 對手階段
  const toOpponent = async () => { await key('Enter'); await waitState('P1'); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/00-p1-grid.png` }); await key('f'); assert.equal((await model()).phase, 'OPPONENT') }
  const texts = () => s((s) => { const out = []; const walk = (o) => { if (o.type === 'Text' && o.visible) out.push(o.text); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return out })
  const waitAnnounce = (text, timeout = 10000) => page.waitForFunction((t) => { const a = window.__game.scene.getScene('AppScene').battleView.announcer; return a?.visible && a.label.text === t }, text, { timeout })
  const world = (fn) => s((s, code) => new Function('w', `return (${code})(w)`)(s.flow.match.world), fn.toString())

  // 1 首頁排行榜
  await waitState('P0'); assert.equal(await s((s) => s.ui.focus.current()), 'p0-start')
  await key('ArrowRight'); assert.equal(await s((s) => s.ui.focus.current()), 'p0-board')
  await key('Enter'); assert.ok(await s((s) => Boolean(s.boardPanel))); assert.match(await state(), /^P0/)
  await page.screenshot({ path: `${out}/01-board.png` })
  await key('Enter'); assert.ok(!(await s((s) => Boolean(s.boardPanel)))); assert.match(await state(), /^P0/)
  await key('Escape'); assert.match(await state(), /^P0/)
  check('排行榜按鈕開啟面板（離線有明確狀態）、ENTER 關閉、P0 不變')

  // 2 1P 在選角頁選對手與難度
  await key('ArrowLeft'); await toOpponent()
  assert.deepEqual((await model()).rival, { cursor: 6, difficulty: 'NORMAL' }); assert.match(await state(), /^P1/)
  assert.ok((await texts()).some((t) => t.startsWith('SELECT OPPONENT'))); assert.ok((await texts()).includes('CPU'))
  await page.screenshot({ path: `${out}/02-opponent.png` })
  await key('a'); await key('f'); assert.equal((await model()).phase, 'OPPONENT'); assert.ok((await texts()).some((t) => t.startsWith('YOURSELF')))
  check('鎖定角色後直接在同一格子選對手（敵方色 CPU 游標），選自己被拒絕')
  await key('d'); await key('d'); await key('f'); assert.equal((await model()).phase, 'DIFFICULTY')
  await key('d'); assert.equal((await model()).rival.difficulty, 'HARD'); await page.screenshot({ path: `${out}/03-difficulty.png` })
  await key('k'); assert.deepEqual([(await model()).phase, (await model()).rival.cursor], ['OPPONENT', 7])
  await key('k'); assert.deepEqual([(await model()).phase, (await model()).locked], ['GRID', undefined])
  check('對手 → 難度（← → 切換）；K 逐層返回：難度→對手→解除 1P 鎖定')
  await key('f'); await key('Numpad1'); assert.deepEqual([(await model()).phase, (await model()).rival, (await model()).p2], ['GRID', undefined, true])
  await key('Backspace'); assert.deepEqual([(await model()).phase, (await model()).rival?.cursor], ['OPPONENT', 6])
  check('2P 中途 NUM 1 加入捨棄 CPU 選擇；2P 退出回到選對手')
  await key('f'); await key('f'); await waitState('P2'); assert.equal(await sub(), 'DEFAULT')
  assert.equal(await s((s) => s.flow.opponent?.characterId), 'preset-b'); await page.screenshot({ path: `${out}/04-stage.png` })
  await key('Escape'); await waitState('P1'); assert.equal((await model()).phase, 'GRID')
  check('確認 NORMAL 後 ALL READY 直接到 P2 選場景（無對手頁）；P2 BACK 回 P1')

  // 3 選 RIVEN／HARD 進戰鬥
  await key('f'); await key('d'); await key('f'); await key('d'); await key('f'); await waitState('P2')
  assert.equal(await s((s) => s.enemyName()), 'RIVEN')
  await s((s) => s.confirmStage()); await waitState('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').loadingReady === true, null, { timeout: 15000 })
  assert.ok((await texts()).includes('RIVEN'))
  await key('Enter'); await waitState('P4')
  assert.equal(await s((s) => s.flow.match.ai.profile.id), 'HARD')
  await waitAnnounce('ROUND 1'); const frozen = await s((s) => s.flow.match.getSnapshot().remainingTicks); await page.screenshot({ path: `${out}/05-round.png` })
  await waitAnnounce('READY?'); await waitAnnounce('FIGHT!')
  const t = await s((s) => s.flow.match.getSnapshot()); assert.equal(t.matchState, 'FIGHTING'); assert.ok(t.remainingTicks >= frozen - 3)
  await page.screenshot({ path: `${out}/06-fight.png` })
  check('P3 顯示 RIVEN；P4 Announcer 依序 ROUND 1→READY?→FIGHT!，期間時間不減；HARD AI 已套用')
  await key('Escape'); await key('ArrowDown'); await key('Enter')
  assert.equal(await s(s => s.ui.navigation.isExitConfirmationOpen()), true)
  assert.equal(await s(s => s.ui.focus.current()), 'overlay-CANCEL')
  assert.ok((await texts()).includes('將回到首頁，本局成績不列入排行榜'))
  await key('ArrowDown'); await key('Enter')
  assert.equal(await s(s => s.ui.focus.current()), 'overlay-CANCEL')
  assert.match(await state(), /^P4/)
  await page.waitForTimeout(450); await key('Enter')
  assert.equal(await s(s => s.ui.navigation.isOverlayOpen()), false)
  check('離開確認預設 CANCEL，顯示後果且 0.4 秒內忽略快速輸入')

  // 4 命中與防禦特效（AI 固定不動，以便確定性）
  const fx = (k) => page.waitForFunction((k) => window.__game.scene.getScene('AppScene').stage.world.list.some((o) => o.texture?.key === k), k, { timeout: 3000 }).then(() => s((s, k) => s.stage.world.list.filter((o) => o.texture?.key === k).map((o) => ({ scale: o.scaleX, flip: o.flipX, x: o.x })), k))
  const noFx = (k) => page.waitForFunction((k) => !window.__game.scene.getScene('AppScene').stage.world.list.some((o) => o.texture?.key === k), k, { timeout: 3000 })
  await s((s) => { s.flow.match.ai.getIntent = () => ({ moveX: 0, jumpPressed: false, attackPressed: false }) })
  await world((w) => { w.fighters.PLAYER.x = 1300; w.fighters.ENEMY.x = 1520 })
  await key('u'); const heavy = await fx('fx-hit'); await page.screenshot({ path: `${out}/07-hit-heavy.png` })
  assert.equal(heavy[0].scale, 1.5); assert.equal(heavy[0].flip, false); assert.ok(heavy[0].x > 1300 && heavy[0].x < 1520)
  await noFx('fx-hit'); await page.waitForTimeout(500)
  await world((w) => { w.fighters.PLAYER.x = 1300; w.fighters.ENEMY.x = 1520 })
  await key('g'); const light = await fx('fx-hit'); assert.equal(light[0].scale, 0.9)
  check('重拳命中：接觸點出現完整尺寸爆炸並自毀；輕腳命中縮小播放')
  await noFx('fx-hit'); await page.waitForTimeout(500)
  await s((s) => { s.flow.match.ai.getIntent = () => ({ moveX: 1, jumpPressed: false, attackPressed: false }) })
  await world((w) => { w.fighters.PLAYER.x = 1300; w.fighters.ENEMY.x = 1520 }); const hp = await world((w) => w.getFighter('ENEMY').currentHP)
  await key('f'); const guard = await fx('fx-guard'); await page.screenshot({ path: `${out}/08-guard.png` })
  assert.equal(guard[0].flip, true); assert.equal(await s((s) => s.stage.world.list.some((o) => o.texture?.key === 'fx-hit')), false); assert.equal(await world((w) => w.getFighter('ENEMY').currentHP), hp)
  check('面向左的敵方防禦：波紋弧面朝左（朝攻擊者），沒有爆炸、不扣血')

  // 5 回合 K.O. 停留 → 結果 → ROUND 2
  await world((w) => { w.fighters.ENEMY.currentHP = 0 })
  await waitAnnounce('K.O.'); const held = await s((s) => s.flow.match.getSnapshot())
  await page.waitForTimeout(700); const later = await s((s) => s.flow.match.getSnapshot()); await page.screenshot({ path: `${out}/09-ko.png` })
  assert.equal(later.matchState, 'ROUND_END'); assert.equal(later.remainingTicks, held.remainingTicks)
  await waitAnnounce('YOU WIN'); assert.equal(await s((s) => s.battleView.announcer.sub.text), 'ROUND 1'); await page.screenshot({ path: `${out}/10-round-win.png` })
  await waitAnnounce('ROUND 2'); await waitAnnounce('FIGHT!')
  check('回合 K.O.：停留約 1.5 秒（時間不減）→ YOU WIN · ROUND 1 → ROUND 2 → FIGHT!')

  // 6 最後一回合直接 P5，同一 Announcer 顯示 K.O. 與 YOU WIN
  await world((w) => { w.fighters.ENEMY.currentHP = 0 }); await waitState('P5')
  await page.waitForTimeout(500); const p5 = await texts(); assert.ok(p5.includes('K.O.') && p5.includes('YOU WIN'), p5.join('|'))
  await page.screenshot({ path: `${out}/11-p5.png` })
  check('第 2 勝不停留直接 P5，Announcer 顯示 K.O. 與 YOU WIN')

  // 7 Replay 沿用對手直接到選場景
  await key('Enter'); await waitState('P6'); await key('Enter'); await waitState('P7'); await key('Enter'); await waitState('P2')
  assert.equal(await sub(), 'DEFAULT'); assert.deepEqual(await s((s) => s.flow.opponent), { characterId: 'preset-c', difficulty: 'HARD' })
  check('Replay 直接到 P2 選場景，沿用 RIVEN／HARD')
  assert.deepEqual(errors, [], errors.join('\n'))
} finally { await browser.close() }
