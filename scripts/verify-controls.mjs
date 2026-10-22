// 操作設定實測：改鍵 UI、衝突 SWAP、重設、重新整理、損壞資料、戰鬥實際出招與 DEV 診斷。先啟動 Vite（預設 http://127.0.0.1:5189）。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const out = 'outputs/controls-verification', report = { checks: [], errors: [] }
await mkdir(out, { recursive: true })
const check = message => { report.checks.push(message); console.log('PASS ' + message) }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('http://localhost:8000/**', route => route.abort())
  await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async name => { await page.keyboard.press(name); await s(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
  const boot = async (query = '') => { await page.goto(base + query); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene') && window.__game.scene.getScene('AppScene').screen?.alpha >= .99) }
  const binding = action => s((s, action) => s.controls.P1[action], action)
  const panel = () => s(s => s.controlsPanel && { state: s.controlsPanel.editor.state, focus: s.controlsPanel.editor.focus, message: s.controlsPanel.editor.message, keys: s.controlsPanel.rows.map(r => r.key.text) })

  await boot()
  await page.evaluate(() => localStorage.removeItem('exp2.controls.v1')); await boot()
  await key('c')
  assert.deepEqual((await panel()).keys.slice(0, 12), ['[ A ]', '[ D ]', '[ W ]', '[ S ]', '[ SPACE ]', '[ X ]', '[ F ]', '[ U ]', '[ G ]', '[ I ]', '[ K ]', '[ ESC ]'])
  await page.screenshot({ path: `${out}/01-panel-defaults.png` })
  check('P0 按 C 開啟操作設定，預設 A D W S / SPACE X / F U G I / K / ESC')

  for (let i = 0; i < 6; i++) await key('ArrowDown')
  await key('Enter'); assert.equal((await panel()).keys[6], 'PRESS A KEY...')
  await page.screenshot({ path: `${out}/02-press-a-key.png` })
  await key('q')
  assert.equal(await binding('LIGHT_PUNCH'), 'KeyQ'); assert.equal((await panel()).keys[6], '[ Q ]')
  check('Light Punch 選取後顯示 PRESS A KEY...，按 Q 改為 [ Q ]')

  await key('Enter'); await key('Shift'); assert.match((await panel()).message, /MODIFIER/); await key('F5'); assert.match((await panel()).message, /RESERVED/)
  await key('Escape'); assert.equal(await binding('LIGHT_PUNCH'), 'KeyQ'); assert.equal((await panel()).state, 'SELECT_BINDING')
  check('Shift／F5 被拒絕，Escape 取消並保留原鍵')

  await s(s => { s.controlsPanel.editor.focus = 11 }); await key('Enter'); await key('Escape')
  assert.equal(await binding('PAUSE'), 'Escape')
  check('改綁 Pause 時 Escape 仍是取消')

  await s(s => { s.controlsPanel.editor.focus = 4 }); await key('Enter'); await key('q')
  assert.deepEqual([(await panel()).state, (await panel()).message], ['CONFLICT', 'Q IS ALREADY ASSIGNED TO LIGHT PUNCH'])
  await page.screenshot({ path: `${out}/03-conflict.png` })
  await key('Enter')
  assert.deepEqual([await binding('JUMP'), await binding('LIGHT_PUNCH')], ['KeyQ', 'Space'])
  check('Jump 改成 Q：顯示衝突 → SWAP 後 Jump=Q、Light Punch=SPACE，沒有空鍵')

  await key('Escape'); assert.equal(await s(s => s.controlsPanel), undefined)
  await boot()
  assert.deepEqual([await binding('JUMP'), await binding('LIGHT_PUNCH')], ['KeyQ', 'Space'])
  check('重新整理後設定仍在（localStorage exp2.controls.v1）')

  await key('c'); await s(s => { s.controlsPanel.editor.focus = 12 }); await key('Enter')
  await page.screenshot({ path: `${out}/04-reset-confirm.png` })
  await key('Enter')
  assert.deepEqual(await s(s => s.controls.P1), { MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', MOVE_UP: 'KeyW', MOVE_DOWN: 'KeyS', JUMP: 'Space', CROUCH: 'KeyX', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', GUARD: 'KeyK', PAUSE: 'Escape' })
  await key('Escape')
  check('RESET TO DEFAULT 確認後回到 A D W S / SPACE X / F U G I / K / ESC')

  await page.evaluate(() => localStorage.setItem('exp2.controls.v1', '{broken')); await boot()
  assert.equal(await binding('LIGHT_PUNCH'), 'KeyF')
  check('損壞的 localStorage 退回預設')

  // 戰鬥：改 Light Punch=Q，實際送出 LIGHT_PUNCH；站立／空中／蹲姿與後退防禦。
  await page.evaluate(() => localStorage.setItem('exp2.controls.v1', JSON.stringify({ version: 1, profiles: { P1: { MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', MOVE_UP: 'KeyW', MOVE_DOWN: 'KeyS', JUMP: 'Space', CROUCH: 'KeyX', LIGHT_PUNCH: 'KeyQ', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', GUARD: 'KeyK', PAUSE: 'Escape' } } })))
  await boot('?inputDebug=1')
  await s(s => { s.selectedCharacterId = 'preset-e'; ['P1_READY', 'P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach(state => s.appStateMachine.transitionTo(state)) })
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').appStateMachine.getCurrentState().startsWith('P4'))
  const enemyFar = () => s(s => { s.match.world.fighters.ENEMY.x = 1700; s.match.world.fighters.PLAYER.x = 400 })
  let lastDebug
  const attackSheet = async (press, hold) => {
    await enemyFar()
    await page.waitForFunction(() => { const s = window.__game.scene.getScene('AppScene'); return s.match.world.getFighter('PLAYER').attackPhase === 'NONE' && s.match.world.getFighter('PLAYER').grounded })
    if (hold) await page.keyboard.down(hold)
    if (hold === 'Space') await page.waitForFunction(() => !window.__game.scene.getScene('AppScene').match.world.getFighter('PLAYER').grounded)
    else await new Promise(r => setTimeout(r, 120))
    await page.keyboard.press(press)
    await page.waitForFunction(() => window.__game.scene.getScene('AppScene').match.world.getFighter('PLAYER').attackPhase !== 'NONE')
    await new Promise(r => setTimeout(r, 60))
    const [texture, action, debug] = await s(s => [s.battlePlayer.image.texture.key, s.inputManager.lastCombatInput.action, s.inputDebug?.text])
    if (hold) await page.keyboard.up(hold)
    lastDebug = debug
    return [texture, action]
  }
  assert.deepEqual(await attackSheet('q'), ['body01-attack', 'LIGHT_PUNCH'])
  await page.screenshot({ path: `${out}/05-battle-light-punch-q.png` })
  assert.deepEqual(await attackSheet('u'), ['body01-punch-heavy', 'HEAVY_PUNCH'])
  assert.deepEqual(await attackSheet('g'), ['body01-kick-light', 'LIGHT_KICK'])
  assert.deepEqual(await attackSheet('i'), ['body01-kick-heavy', 'HEAVY_KICK'])
  assert.deepEqual(await attackSheet('q', 'Space'), ['body01-punch-jump', 'LIGHT_PUNCH'])
  assert.deepEqual(await attackSheet('i', 'Space'), ['body01-kick-jump', 'HEAVY_KICK'])
  assert.deepEqual(await attackSheet('q', 'x'), ['body01-punch-crouch', 'LIGHT_PUNCH'])
  assert.deepEqual(await attackSheet('g', 'x'), ['body01-kick-crouch', 'LIGHT_KICK'])
  await page.screenshot({ path: `${out}/06-battle-crouch-kick.png` })
  check('Q（改綁後的 Light Punch）／U／G／I 站立、空中、蹲姿各播放正確 sheet')

  const debug = lastDebug
  assert.match(debug, /Physical Key: G/); assert.match(debug, /Semantic Action: LIGHT_KICK/); assert.match(debug, /Fighter Context: CROUCHING\nResolved Presentation: KICK_CROUCH\nAnimation: 15_Kick_Crounch/)
  check('DEV ?inputDebug=1 顯示實體鍵→語意→姿態→呈現→圖檔')

  await enemyFar(); const startX = await s(s => s.match.world.getFighter('PLAYER').x)
  await page.keyboard.down('a'); await new Promise(r => setTimeout(r, 300))
  const back = await s(s => [s.match.world.getFighter('PLAYER').state, s.match.world.getFighter('PLAYER').facing, s.match.world.getFighter('PLAYER').x])
  await page.keyboard.up('a')
  assert.deepEqual(back.slice(0, 2), ['WALK', 'RIGHT']); assert.ok(back[2] < startX)
  await page.keyboard.down('k'); await new Promise(r => setTimeout(r, 300))
  const guard = await s(s => [s.match.world.getFighter('PLAYER').state, s.battlePlayer.image.texture.key])
  await page.keyboard.up('k')
  assert.deepEqual(guard, ['GUARD', 'body01-guard'])
  check('A（朝右時往後）只會後退走路；K 才是防禦（BLOCK）')

  // 2.5D：W 往後（畫面上方、縮小），S 往前；推擠讓兩人不重疊；鏡頭跟到場地右緣。
  await enemyFar(); const z0 = await s(s => [s.match.world.getFighter('PLAYER').z, s.battlePlayer.y, s.battlePlayer.scaleY])
  await page.keyboard.down('w'); await new Promise(r => setTimeout(r, 500)); await page.keyboard.up('w')
  const z1 = await s(s => [s.match.world.getFighter('PLAYER').z, s.battlePlayer.y, s.battlePlayer.scaleY])
  assert.ok(z1[0] > z0[0] && z1[1] < z0[1] && z1[2] < z0[2], `${z0} → ${z1}`)
  await page.screenshot({ path: `${out}/08-depth-back.png` })
  await page.keyboard.down('s'); await new Promise(r => setTimeout(r, 1600)); await page.keyboard.up('s')
  assert.equal(await s(s => s.match.world.getFighter('PLAYER').z), await s(s => s.match.world.getConfig().depth.min))
  await page.screenshot({ path: `${out}/08b-depth-front.png` })
  check('W／S 在縱深上下移動（往後抬升並縮小），縱深有上下界')
  await s(s => { s.match.world.fighters.PLAYER.x = 1300; s.match.world.fighters.PLAYER.z = 40; s.match.world.fighters.ENEMY.x = 1500; s.match.world.fighters.ENEMY.z = 40 })
  let closest = Infinity
  await page.keyboard.down('d')
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 100)); const [p, e] = await s(s => [s.match.world.getFighter('PLAYER'), s.match.world.getFighter('ENEMY')]); if (Math.abs(p.z - e.z) < 45) closest = Math.min(closest, Math.abs(e.x - p.x)) }
  await page.keyboard.up('d')
  assert.ok(closest >= 220 - 1e-6, `closest ${closest}`)
  await page.screenshot({ path: `${out}/09-pushbox.png` })
  check(`D 一直往對手走：同縱深最近距離 ${closest.toFixed(0)}（≥ 推擠寬 220），不重疊、不穿過`)
  await s(s => { s.match.world.fighters.PLAYER.x = 2820; s.match.world.fighters.ENEMY.x = 3100 })
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').stageScroll > 520, null, { timeout: 5000 })
  const edge = await s(s => [s.stageScroll, s.battleWorld.x + s.battlePlayer.x * s.battleWorld.scaleX, s.battleWorld.x + s.battleEnemy.x * s.battleWorld.scaleX])
  assert.ok(edge.slice(1).every(x => x > 0 && x < 1920), `${edge}`)
  await page.screenshot({ path: `${out}/10-camera-right-edge.png` })
  check(`角色到場地右緣：鏡頭跟到 ${edge[0].toFixed(0)}（上限 ≈533），兩人都在畫面內`)

  await key('Escape'); assert.equal(await s(s => s.ui.navigation.isOverlayOpen()), true)
  await page.screenshot({ path: `${out}/07-pause.png` })
  await key('Escape'); assert.equal(await s(s => s.ui.navigation.isOverlayOpen()), false)
  check('Escape（PAUSE）開暫停，選單中 Escape（BACK）關閉')

  await boot()
  assert.equal(await s(s => s.inputDebug), undefined)
  await s(s => ['P1_READY', 'P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach(state => s.appStateMachine.transitionTo(state)))
  assert.equal(await s(s => s.inputDebug), undefined)
  check('沒有 ?inputDebug=1 時不顯示診斷面板')
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
