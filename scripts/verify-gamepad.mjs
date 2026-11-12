// Mock Gamepad 瀏覽器整合驗證（覆寫 navigator.getGamepads 注入假手把）：單台 P0→P7＋Replay、雙台各自操作、熱插拔、LS／RS、長按、鍵盤備援、手把改鍵保存、R1 返回、L3 開 CONTROLS 並以搖桿改鍵。
// 只證明軟體路徑，不代表 Qanba Drone 2 實機已驗證（見 docs/qanba-drone2-hardware-test.md）。先啟動 Vite（預設 http://127.0.0.1:5189）。
// 結束碼：0 全部通過、1 失敗、2 SKIPPED（找不到 Playwright 或 Chrome）。
import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
const NOTE = 'Mock Gamepad，尚未完成實機驗證'
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromium
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')); await access(executablePath) } catch (error) {
  console.log(`SKIPPED（${NOTE}）：找不到 Playwright 或 Chrome，未執行任何檢查。${error.message}`)
  process.exit(2)
}
const out = 'outputs/gamepad-verification', errors = []
await mkdir(out, { recursive: true })
const check = (message) => console.log(`PASS [Mock] ${message}`)
// standard mapping 位置＝機台 PS 標示（✕ ⭘ ▢ 🛆 L1 R1 L2 R2 SHARE OPTIONS L3 R3，十字鍵 12–15）。
const CROSS = 0, CIRCLE = 1, SQUARE = 2, TRIANGLE = 3, L1 = 4, R1 = 5, R2 = 7, SHARE = 8, OPTIONS = 9, L3 = 10, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15
const browser = await chromium.launch({ headless: true, executablePath })

async function open() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  await context.addInitScript(() => {
    window.__blankPad = (index) => ({ index, id: 'Mock Gamepad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] })
    window.__pads = [null, null, null, null]
    navigator.getGamepads = () => window.__pads.slice()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost:8000/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const frames = async (n = 2) => { for (let i = 0; i < n; i += 1) await s((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
  const boot = async () => { await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene') && window.__game.scene.getScene('AppScene').screen?.alpha >= 0.99) }
  const plug = async (i) => { await page.evaluate((i) => { window.__pads[i] = window.__blankPad(i) }, i); await frames() }
  const unplug = async (i) => { await page.evaluate((i) => { window.__pads[i] = null }, i); await frames() }
  const hold = (i, buttons = [], axes = [0, 0, 0, 0]) => page.evaluate(([i, buttons, axes]) => { const pad = window.__pads[i]; pad.buttons.forEach((b, n) => { b.pressed = buttons.includes(n); b.value = b.pressed ? 1 : 0 }); pad.axes = [...axes] }, [i, buttons, axes])
  const tap = async (i, button) => { await hold(i, [button]); await frames(); await hold(i); await frames() }
  const stick = async (i, axes) => { await hold(i, [], axes); await frames(); await hold(i); await frames() }
  const key = async (name) => { await page.keyboard.press(name); await frames(1) }
  const state = () => s((s) => s.appStateMachine.getCurrentState())
  const waitState = (prefix, timeout = 10000) => page.waitForFunction((p) => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(p) && s.screen?.alpha >= 0.99 }, prefix, { timeout })
  const owners = () => s((s) => [s.inputManager.padOwner('P1') ?? null, s.inputManager.padOwner('P2') ?? null])
  const fighting = () => page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'FIGHTING', null, { timeout: 15000 })
  const countAttacks = () => s((s) => {
    window.__attacks = { PLAYER: 0, ENEMY: 0 }
    if (window.__attackWorld === s.flow.match.world) return
    window.__attackWorld = s.flow.match.world; s.flow.match.world.subscribe((e) => { if (e.type === 'ATTACK_STARTED') window.__attacks[e.attacker] += 1 })
  })
  const attacks = async () => { await page.waitForTimeout(250); return page.evaluate(() => ({ ...window.__attacks })) }
  const loadingReady = () => page.waitForFunction(() => window.__game.scene.getScene('AppScene').loadingReady === true, null, { timeout: 15000 })
  return { page, s, frames, boot, plug, unplug, hold, tap, stick, key, state, waitState, owners, fighting, countAttacks, attacks, loadingReady }
}

try {
  {
    const t = await open(), page = t.page
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin })
    await page.goto(base + '?gamepadDebug=1'); await page.waitForSelector('text=GAMEPAD DEBUG')
    assert.equal(await page.evaluate(() => Boolean(window.__game)), false)
    await page.waitForSelector('text=請按下搖桿任一按鈕')
    await page.click('#copy'); assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).pads, [])
    await page.evaluate(() => { window.__pads[1] = { ...window.__blankPad(1), mapping: '' }; window.__pads[1].buttons[5] = { pressed: true, touched: true, value: 1 }; window.__pads[1].axes = [0, 0.75, 0, 0] })
    await page.waitForSelector('text=#1 · PLAYER 1'); await page.waitForSelector('text=不是 standard')
    await page.click('#copy')
    const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).pads[0]
    assert.deepEqual([report.index, report.owner, report.buttons[5].pressed, report.axes[1]], [1, 'PLAYER 1', true, 0.75])
    await page.screenshot({ path: `${out}/00-debug-page.png` })
    await page.evaluate(() => { window.__pads[1] = null }); await page.waitForSelector('text=DISCONNECTED')
    check('1.x 診斷頁：?gamepadDebug=1 不啟動遊戲；無手把提示；按鍵即顯示 PLAYER 1、非 standard 警告；JSON 報告含 pressed 與軸值；斷線顯示 DISCONNECTED')
    await page.context().close()
  }
  {
    const t = await open(); await t.boot(); await t.waitState('P0')
    const visited = []
    await t.s((s) => { window.__visited = []; s.appStateMachine.subscribe(({ nextState }) => window.__visited.push(nextState.slice(0, 2))) })
    await t.plug(0); assert.deepEqual(await t.owners(), [null, null])
    await t.tap(0, CROSS); await t.waitState('P1'); assert.deepEqual(await t.owners(), [0, null])
    await t.page.waitForTimeout(600)
    await t.tap(0, CROSS); assert.equal(await t.s((s) => s.p1Model.phase), 'OPPONENT')
    await t.tap(0, CROSS); await t.tap(0, CROSS); await t.waitState('P2')
    // 長按 ✕：選關確認一次進 P3，FIGHT! 就緒後仍按著也不會再確認進 P4。
    await t.hold(0, [CROSS]); await t.waitState('P3'); await t.loadingReady(); await t.frames(10)
    assert.match(await t.state(), /^P3/); await t.hold(0); await t.frames()
    await t.tap(0, CROSS); await t.waitState('P4'); await t.fighting()
    await t.countAttacks(); await t.tap(0, SQUARE); assert.equal((await t.attacks()).PLAYER, 1)
    await t.s((s) => { for (let i = 0; i < 1600 && s.appStateMachine.getCurrentState() === 'P4_BATTLE'; i += 1) s.clock.advance(250) }); await t.waitState('P5')
    await t.tap(0, CROSS); await t.waitState('P6'); await t.tap(0, CROSS); await t.waitState('P7'); await t.tap(0, CROSS); await t.waitState('P2')
    visited.push(...await t.page.evaluate(() => window.__visited))
    assert.deepEqual(visited, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P2'])
    await t.page.screenshot({ path: `${out}/01-single-replay.png` })
    check('6.1 單台手把：✕ 取得 1P 並開始，P0→P1→P2→P3→P4（▢ 出拳）→P5→P6→P7→Replay→P2；長按 ✕ 只確認一次')
    const stageFocus = () => t.s((s) => [s.appStateMachine.getCurrentState(), s.selectedStageId, s.ui.focus.current()].join())
    const atStage = await stageFocus(); await t.tap(0, CIRCLE); await t.frames(4); assert.equal(await stageFocus(), atStage)
    await t.tap(0, R1); await t.waitState('P1')
    check('9.5 P2 選關：⭘（重踢）在選單沒有作用；R1 沿既有返回路線回到 P1')
    await t.page.context().close()
  }

  {
    const t = await open(); await t.boot(); await t.waitState('P0')
    await t.plug(0); await t.plug(1)
    await t.tap(0, SHARE); await t.tap(1, SHARE); assert.deepEqual(await t.owners(), [0, 1])
    const panel = () => t.s((s) => s.controlsPanel ? { device: s.controlsPanel.device, player: s.controlsPanel.player, focus: s.controlsPanel.editor.focus, state: s.controlsPanel.editor.state, message: s.controlsPanel.message.text, light: s.controlsPanel.rows[4].key.text, hint: s.controlsPanel.hint.text } : null)
    await t.tap(1, L3); assert.equal(await panel(), null)
    await t.tap(0, L3); assert.deepEqual(await t.s((s) => [s.appStateMachine.getCurrentState().slice(0, 2), s.controlsPanel?.device]), ['P0', 'GAMEPAD'])
    assert.match((await panel()).hint, /R1/)
    await t.page.screenshot({ path: `${out}/04-controls-by-stick.png` })
    check('9.5 P0：2P 的 L3 不開面板；1P 的 L3 開啟 CONTROLS 並預設 GAMEPAD 分頁，提示顯示搖桿操作')
    for (let i = 0; i < 4; i += 1) await t.tap(0, DOWN)
    await t.tap(1, DOWN); assert.equal((await panel()).focus, 4)
    assert.equal((await panel()).light, '[ ▢ ]')
    await t.tap(0, CROSS); await t.frames(4); assert.deepEqual([(await panel()).state, (await panel()).light], ['LISTENING_FOR_KEY', 'PRESS A BUTTON...'])
    await t.tap(0, L3); assert.deepEqual([(await panel()).state, (await panel()).message], ['LISTENING_FOR_KEY', 'L3 IS RESERVED'])
    await t.tap(0, L1); assert.deepEqual([(await panel()).state, (await panel()).light, (await panel()).message], ['SELECT_BINDING', '[ L1 ]', 'SAVED'])
    assert.equal(await t.s((s) => s.padProfiles.P1.LIGHT_PUNCH), 'B4')
    check('9.5 搖桿改鍵：十字鍵下選 Light Punch（2P 的下無效）、✕ 開始擷取但不被綁定、L3 被拒絕、L1 完成綁定')
    await t.tap(0, CROSS); await t.tap(0, R1); assert.deepEqual([(await panel()).state, (await panel()).light, (await panel()).message], ['SELECT_BINDING', '[ L1 ]', 'CANCELLED'])
    await t.tap(0, RIGHT); assert.equal((await panel()).player, 'P2'); await t.tap(0, LEFT); assert.equal((await panel()).player, 'P1')
    for (let i = 0; i < 5; i += 1) await t.tap(0, DOWN)
    await t.tap(0, CROSS); assert.equal((await panel()).state, 'CONFIRM_RESET'); await t.tap(0, CROSS)
    assert.deepEqual([(await panel()).state, await t.s((s) => s.padProfiles.P1.LIGHT_PUNCH)], ['SELECT_BINDING', 'B2'])
    await t.tap(0, R1); assert.deepEqual(await t.s((s) => [Boolean(s.controlsPanel), s.appStateMachine.getCurrentState().slice(0, 2)]), [false, 'P0'])
    check('9.5 R1 取消擷取（綁定不變）；←→ 切換玩家；✕ 確認 RESET 對話框；列表狀態 R1 關閉面板回到 P0')
    await t.tap(0, CROSS); await t.waitState('P1'); await t.page.waitForTimeout(600)
    await t.tap(1, CROSS); assert.deepEqual(await t.owners(), [0, 1]); assert.equal(await t.s((s) => s.p1Model.player('P2').joined), true)
    await t.tap(1, RIGHT); await t.tap(1, RIGHT)
    assert.deepEqual(await t.s((s) => [s.p1Model.player('P1').cursor, s.p1Model.player('P2').cursor]), [5, 8])
    await t.tap(1, CROSS); await t.tap(0, CROSS); await t.waitState('P2')
    const stage = () => t.s((s) => [s.selectedStageId, s.ui.focus.current()].join())
    const before = await stage(); await t.tap(1, RIGHT); assert.equal(await stage(), before)
    await t.tap(0, RIGHT); assert.notEqual(await stage(), before)
    check('6.2 雙台：2P 手把在 P1 加入、各自移動與鎖定；P2 選關只聽 1P 手把（2P 按右焦點不變）')
    await t.tap(0, CROSS); await t.waitState('P3'); await t.loadingReady(); await t.tap(0, CROSS); await t.waitState('P4'); await t.fighting()
    await t.s((s) => { const w = s.flow.match.world; w.fighters.PLAYER.x = 700; w.fighters.ENEMY.x = 1300 })
    await t.countAttacks(); await t.tap(1, SQUARE); assert.deepEqual(await t.attacks(), { PLAYER: 0, ENEMY: 1 })
    await t.tap(0, TRIANGLE); assert.deepEqual(await t.attacks(), { PLAYER: 1, ENEMY: 1 })
    await t.page.waitForTimeout(500)
    const x0 = await t.s((s) => [s.flow.match.world.getFighter('PLAYER').x, s.flow.match.world.getFighter('ENEMY').x])
    await t.hold(0, [RIGHT]); await t.hold(1, [14]); await t.page.waitForTimeout(300); await t.hold(0); await t.hold(1)
    const x1 = await t.s((s) => [s.flow.match.world.getFighter('PLAYER').x, s.flow.match.world.getFighter('ENEMY').x])
    assert.ok(x1[0] > x0[0] && x1[1] < x0[1], `PLAYER ${x0[0]}→${x1[0]}，ENEMY ${x0[1]}→${x1[1]}`)
    check('6.2 雙人戰鬥：2P 手把 ▢ 只讓 ENEMY 出拳、1P 手把 🛆 只讓 PLAYER 出拳；兩支同時按方向各自移動')
    await t.tap(1, OPTIONS); assert.equal(await t.s((s) => s.ui.navigation.isOverlayOpen()), true)
    await t.tap(1, R1); assert.equal(await t.s((s) => s.ui.navigation.isOverlayOpen()), true)
    const hp = await t.s((s) => s.flow.match.world.getFighter('ENEMY').currentHP)
    await t.countAttacks(); await t.tap(0, CIRCLE); assert.equal(await t.s((s) => s.ui.navigation.isOverlayOpen()), true)
    await t.tap(0, R1); assert.equal(await t.s((s) => s.ui.navigation.isOverlayOpen()), false)
    assert.equal((await t.attacks()).PLAYER, 0); assert.equal(await t.s((s) => s.flow.match.world.getFighter('ENEMY').currentHP), hp)
    check('6.2／9.5 2P 手把 OPTIONS 開暫停；暫停選單只聽 1P（2P 按 R1 無效、1P 按 ⭘ 無作用、1P 按 R1 關閉），選單中的 ⭘ 不會留到戰鬥變成重踢')

    await t.unplug(0)
    assert.deepEqual(await t.s((s) => [s.ui.navigation.isOverlayOpen(), s.clock.isPaused(), s.appStateMachine.getCurrentState().slice(0, 2)]), [true, true, 'P4'])
    assert.deepEqual(await t.owners(), [null, 1])
    await t.page.screenshot({ path: `${out}/02-unplug-pause.png` })
    await t.key('Escape'); assert.equal(await t.s((s) => s.ui.navigation.isOverlayOpen()), false)
    await t.page.waitForTimeout(400); await t.countAttacks(); await t.tap(1, SQUARE); assert.deepEqual(await t.attacks(), { PLAYER: 0, ENEMY: 1 })
    check('6.3 戰鬥中拔掉 1P：自動暫停（時鐘停、仍在 P4）；鍵盤 Esc 可關閉；2P 手把仍只操作 ENEMY')
    await t.plug(0); assert.deepEqual(await t.owners(), [null, 1])
    await t.hold(0, [], [1, 0, 0, 0]); await t.frames(4); await t.hold(0); assert.deepEqual(await t.owners(), [null, 1])
    await t.page.waitForTimeout(400); await t.countAttacks(); await t.tap(0, SQUARE)
    assert.deepEqual(await t.owners(), [0, 1]); assert.equal((await t.attacks()).PLAYER, 1)
    check('6.3 重新插上 1P：推搖桿不取得、按 ▢ 才重新屬於 1P（取得那一下照常出拳）')
    await t.page.context().close()
  }

  {
    const t = await open(); await t.boot(); await t.waitState('P0')
    await t.plug(0); await t.key('Enter'); await t.waitState('P1'); assert.deepEqual(await t.owners(), [null, null])
    check('6.4 鍵盤備援：手把已連線但未取得時，鍵盤 Enter 照常從 P0 進 P1')
    await t.page.waitForTimeout(600); await t.tap(0, SHARE); assert.deepEqual(await t.owners(), [0, null])
    const cursor = () => t.s((s) => s.p1Model.player('P1').cursor)
    const c0 = await cursor(); await t.hold(0, [], [1, 0, 0, 0]); await t.frames(6); await t.hold(0); await t.frames()
    const c1 = await cursor(); assert.equal(c1, c0 + 1)
    await t.stick(0, [0, 0, 0, 1]); assert.notEqual(await cursor(), c1)
    check('6.4 LS 模式長按右只移動一格、RS 模式下方向也能導航 P1 選角')
    await t.s((s) => { s.p1Model.focus('P1', 1); s.syncP1() }); await t.tap(0, CROSS)
    assert.deepEqual(await t.s((s) => [s.p1Model.phase, document.activeElement?.tagName]), ['CUSTOMIZE', 'INPUT'])
    await t.tap(0, R1)
    assert.deepEqual(await t.s((s) => [s.p1Model.phase, s.p1Model.player('P1').locked ?? null]), ['GRID', null])
    check('6.4 手把選 1 號 BODY_TEMPLATE 進入 CUSTOMIZE（暱稱框已 focus）後按 R1 取消回到格子')
    await t.tap(0, CROSS); assert.equal(await t.s((s) => s.p1Model.phase), 'CUSTOMIZE')
    const name = () => t.s((s) => [s.p1Model.player('P1').nickname, document.querySelector('input')?.value])
    await t.tap(0, CROSS); await t.stick(0, [0, 1, 0, 0]); await t.tap(0, CROSS); assert.deepEqual(await name(), ['AK', 'AK'])
    await t.stick(0, [0, -1, 0, 0]); await t.tap(0, CROSS); assert.deepEqual(await name(), ['AKA', 'AKA'])
    await t.stick(0, [0, -1, 0, 0]); await t.stick(0, [1, 0, 0, 0]); await t.tap(0, CROSS); assert.deepEqual(await name(), ['AK', 'AK'])
    assert.equal(await t.s((s) => s.p1Model.phase), 'CUSTOMIZE')
    await t.stick(0, [1, 0, 0, 0]); await t.tap(0, CROSS); assert.equal(await t.s((s) => s.p1Model.phase), 'REVIEW')
    check('10.x 沒有實體鍵盤：搖桿在螢幕鍵盤選字輸入（A、K、A、DEL），選 OK 才拍照進入 REVIEW')
    await t.s((s) => { s.flow.setPlayers({ P1: { characterId: 'preset-e' } }); ['P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach((next) => s.appStateMachine.transitionTo(next)) })
    await t.waitState('P4'); await t.fighting()
    await t.s((s) => { s.flow.match.ai.getIntent = () => ({ moveX: 0, jumpPressed: false, attackPressed: false }); const w = s.flow.match.world; w.fighters.PLAYER.x = 600; w.fighters.ENEMY.x = 1500 })
    await t.stick(0, [0, -1, 0, 0]); await t.page.waitForFunction(() => !window.__game.scene.getScene('AppScene').flow.match.world.getFighter('PLAYER').grounded)
    await t.page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.world.getFighter('PLAYER').grounded, null, { timeout: 5000 })
    await t.hold(0, [], [0, 0, 0, 1]); await t.page.waitForTimeout(200)
    assert.deepEqual(await t.s((s) => [s.flow.match.world.getFighter('PLAYER').state, s.playerContext.crouch]), ['GUARD', true]); await t.hold(0)
    check('6.4 LS 上＝跳、RS 下＝蹲並防禦（GUARD）')

    await t.s((s) => s.appStateMachine.transitionTo('P0_IDLE')); await t.waitState('P0')
    await t.key('c'); assert.equal(await t.s((s) => s.controlsPanel.device), 'GAMEPAD')
    for (let i = 0; i < 4; i += 1) await t.key('ArrowDown')
    const panel = () => t.s((s) => ({ message: s.controlsPanel.message.text, light: s.controlsPanel.rows[4].key.text, heavyKick: s.controlsPanel.rows[7].key.text, state: s.controlsPanel.editor.state }))
    assert.equal((await panel()).light, '[ ▢ ]')
    await t.key('ArrowRight'); await t.key('Enter'); assert.match((await panel()).message, /PLAYER 2 STICK FIRST/); assert.equal((await panel()).state, 'SELECT_BINDING')
    await t.plug(1); await t.tap(1, SHARE); assert.deepEqual(await t.owners(), [0, 1])
    for (let i = 0; i < 7; i += 1) await t.key('ArrowDown')
    await t.key('Enter'); await t.tap(0, 7); assert.deepEqual([(await panel()).state, (await panel()).heavyKick], ['LISTENING_FOR_KEY', 'PRESS A BUTTON...'])
    await t.tap(1, 7); assert.deepEqual([(await panel()).heavyKick, (await panel()).message], ['[ R2 ]', 'SAVED'])
    check('6.4 CONTROLS 的 GAMEPAD 分頁：2P 無手把時提示且不擷取；擷取只收 2P 自己的手把（1P 按鈕被忽略），Heavy Kick 改為 R2；1P 已有手把時鍵盤 C 也預設 GAMEPAD 分頁')
    await t.key('ArrowLeft')
    await t.key('Enter'); await t.tap(0, L1); assert.deepEqual([(await panel()).light, (await panel()).message], ['[ L1 ]', 'SAVED'])
    await t.key('Escape')
    const controlsBefore = await t.page.evaluate(() => localStorage.getItem('exp2.controls.v3'))
    await t.boot(); await t.waitState('P0')
    assert.deepEqual(await t.s((s) => [s.padProfiles.P1.LIGHT_PUNCH, s.padProfiles.P2.HEAVY_KICK]), ['B4', 'B7'])
    assert.equal(await t.page.evaluate(() => localStorage.getItem('exp2.controls.v3')), controlsBefore)
    await t.s((s) => { s.flow.setPlayers({ P1: { characterId: 'preset-e' } }); ['P1_READY', 'P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach((next) => s.appStateMachine.transitionTo(next)) })
    await t.waitState('P4'); await t.fighting()
    await t.s((s) => { s.flow.match.ai.getIntent = () => ({ moveX: 0, jumpPressed: false, attackPressed: false }); const w = s.flow.match.world; w.fighters.PLAYER.x = 600; w.fighters.ENEMY.x = 1500 })
    await t.plug(0); await t.tap(0, SHARE); await t.countAttacks(); await t.tap(0, SQUARE); assert.equal((await t.attacks()).PLAYER, 0)
    await t.tap(0, L1); assert.equal((await t.attacks()).PLAYER, 1)
    await t.page.screenshot({ path: `${out}/03-rebound-lb.png` })
    check('6.4 手把改鍵重新載入後仍生效（L1 出輕拳、▢ 不再出拳），exp2.controls.v3 未被更動')
    await t.plug(1); await t.tap(1, SHARE); assert.deepEqual(await t.owners(), [0, 1])
    await t.unplug(1); assert.deepEqual(await t.s((s) => [s.ui.navigation.isOverlayOpen(), s.clock.isPaused()]), [false, false])
    await t.unplug(0); assert.deepEqual(await t.s((s) => [s.ui.navigation.isOverlayOpen(), s.clock.isPaused()]), [true, true])
    check('6.3 單人戰鬥：拔掉 2P 的手把不暫停（2P 不是操作者），拔掉 1P 的手把才暫停')
    await t.page.context().close()
  }
  assert.deepEqual(errors, [])
  console.log(`ALL PASS（${NOTE}）`)
} catch (error) {
  console.log(`FAIL（${NOTE}）`); throw error
} finally { await browser.close() }
