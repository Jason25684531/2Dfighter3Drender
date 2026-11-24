// 單人完整流程 P0→P7 截圖，並記錄所有 /test-assets/ 請求與 404。先啟動 Vite（預設 http://127.0.0.1:5189）。
// 用法：node scripts/verify-screens.mjs [輸出資料夾]
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const out = process.argv[2] ?? 'outputs/screens-verification'
await mkdir(out, { recursive: true })
const errors = [], requested = new Set(), missing = new Set()
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const path = decodeURIComponent(new URL(response.url()).pathname)
    if (!path.startsWith('/test-assets/')) return
    requested.add(path)
    if (response.status() === 404) missing.add(path)
  })
  await page.route('http://localhost:8000/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.goto(base); await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'), null, { timeout: 60000 })
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const frame = () => s(s => new Promise(resolve => s.events.once('postupdate', resolve)))
  const key = async (name) => { await page.keyboard.press(name); await frame() }
  const waitState = (prefix, timeout = 15000) => page.waitForFunction((p) => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(p) && (s.screen?.alpha ?? 1) >= 0.99 }, prefix, { timeout })
  const reviewReady = id => page.waitForFunction(id => window.__game.scene.getScene('AppScene').ui.focus.current() === id, id)
  const checkReviewLock = async (state, y) => {
    for (const name of ['Enter', 'f', 'Escape', 'Enter']) await key(name)
    await page.mouse.click(960, y); await frame()
    assert.match(await s(s => s.appStateMachine.getCurrentState()), new RegExp(`^${state}`))
  }
  const texts = () => s((s) => { const found = []; const walk = (o) => { if (o.type === 'Text' && o.visible && o.text) found.push(o.text); (o.list ?? []).forEach(walk) }; s.children.list.forEach(walk); return found })
  const waitText = (pattern, timeout = 20000) => page.waitForFunction((source) => { const re = new RegExp(source), found = []; const walk = (o) => { if (o.type === 'Text' && o.visible) found.push(o.text); (o.list ?? []).forEach(walk) }; window.__game.scene.getScene('AppScene').children.list.forEach(walk); return found.some((t) => re.test(t)) }, pattern.source, { timeout })
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); console.log('SHOT ' + name) }
  const world = (fn) => s((s, code) => new Function('w', `return (${code})(w)`)(s.flow.match.world), fn.toString())

  await waitState('P0'); await shot('p0-home')
  await key('Enter'); await waitState('P1'); await page.waitForTimeout(600); await shot('p1-grid')
  await key('d'); await key('f'); await shot('p1-opponent')
  await key('f'); await shot('p1-difficulty')
  await key('f'); await waitState('P2'); await shot('p2-stage')
  await key('Enter'); await waitState('P3')
  await waitText(/^READY$|就緒/); await shot('p3-loading-ready')
  assert.ok((await texts()).some((t) => /FIGHT!/.test(t)), 'P3 shows the FIGHT! button')
  await key('Enter'); await waitState('P4')
  await waitText(/^FIGHT!$/); await page.waitForTimeout(900); await shot('p4-battle')
  await key('Escape'); await waitText(/^PAUSED$/); await shot('p4-pause')
  await key('Enter'); await page.waitForFunction(() => !window.__game.scene.getScene('AppScene').ui.navigation.isOverlayOpen())
  await world((w) => { w.fighters.ENEMY.currentHP = 0 }); await waitText(/^ROUND 2$/, 15000); await waitText(/^FIGHT!$/)
  await world((w) => { w.fighters.ENEMY.currentHP = 0 }); await waitState('P5'); await checkReviewLock('P5', 990)
  await shot('p5-presentation')
  const p5 = await texts(); assert.ok(p5.includes('K.O.') && p5.includes('YOU WIN'), p5.join('|'))
  await reviewReady('presentation-next'); await key('Enter'); await waitState('P6'); await checkReviewLock('P6', 952); await shot('p6-result')
  await reviewReady('result-next'); await key('Enter'); await waitState('P7'); await shot('p7-end')
  await key('ArrowDown'); await key('Enter'); await waitState('P0')
  console.log('PASS 單人流程 P0→P7→P0 走完')

  await key('Enter'); await waitState('P1')
  await key('Numpad1'); await key('f'); await key('Numpad1'); await waitState('P2')
  await key('Enter'); await waitState('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current.ready)
  await key('Enter'); await waitState('P4')
  await s(s => {
    s.clock.stop()
    s.stepBattle = (ticks = 1) => {
      s.clock.start()
      for (let i = 0; i < ticks; i++) s.clock.advance(1000 / 24)
      s.clock.stop()
    }
    s.stepBattle(100)
  })
  const health = () => s(s => {
    const { hud } = s.current.view
    return ['p1', 'p2'].map(side => {
      const { percent, fill, trail, lives } = hud.sides[side]
      return { percent: percent.text, x: fill._crop.x, width: fill._crop.width, trail: trail.isCropped ? trail._crop.width : trail.width, lives: lives.filter(life => life.visible).length }
    })
  })
  assert.deepEqual((await health()).map(side => [side.percent, side.lives]), [['100%', 2], ['100%', 2]])
  assert.deepEqual(await s(s => s.current.view.hud.list.filter(item => item.texture?.key.startsWith('head-')).map(item => item.texture.key)), ['head-go', 'head-se7en'])
  await shot('hud-full-2p')

  await world(w => { w.fighters.PLAYER.currentHP = 70; w.fighters.ENEMY.currentHP = 40 })
  await s(s => {
    s.stepBattle()
    for (const side of Object.values(s.current.view.hud.sides)) side.chase.pause()
  })
  assert.deepEqual((await health()).map(side => [side.percent, side.x, side.width]), [['70%', 160, 372], ['40%', 0, 213]])
  assert.deepEqual((await health()).map(side => side.trail), [532, 533])
  await page.screenshot({ path: `${out}/hud-70-with-trail.png` })
  await s(s => { for (const side of Object.values(s.current.view.hud.sides)) side.chase.resume() })
  await page.waitForFunction(() => Object.values(window.__game.scene.getScene('AppScene').current.view.hud.sides).every(side => side.fill._crop.width === side.trail._crop.width))
  await shot('hud-70')
  await world(w => { w.fighters.ENEMY.currentHP = 25 }); await s(s => s.stepBattle())
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current.view.hud.sides.p2.fill.alpha < 0.8)
  assert(await s(s => !s.current.view.hud.sides.p1.warning))
  await shot('hud-low-health')
  await s(s => { s.flow.match.remainingTicks = 241; s.stepBattle() })
  assert.deepEqual(await s(s => [s.current.view.hud.timer.text, s.current.view.hud.timer.style.color]), ['10', '#ff2e44'])
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current.view.hud.timer.scaleX > 1)
  await page.screenshot({ path: `${out}/hud-last-ten.png` })
  await s(s => { s.flow.match.remainingTicks = 1440; s.stepBattle() })

  const contact = (leftFacing = false) => s((s, leftFacing) => {
    const w = s.flow.match.world
    w.reset()
    const half = (w.contactWidth ?? w.getConfig().fighterWidth) / 2
    const center = w.getConfig().arenaWidth / 2
    w.fighters.PLAYER.x = center + (leftFacing ? half : -half)
    w.fighters.ENEMY.x = center + (leftFacing ? -half : half)
    s.stepBattle()
  }, leftFacing)
  const step = (ticks = 1) => s((s, n) => s.stepBattle(n), ticks)
  const findImpact = async () => {
    await frame()
    return s(s => {
      const { view } = s.current
      for (let i = 0; i < 12; i++) {
        s.stepBattle()
        const fx = view.world.list.find(o => o.texture?.key.startsWith('fx-'))
        if (fx) {
          fx.anims.pause(fx.anims.currentAnim.frames[2])
          return { key: fx.texture.key, flipX: fx.flipX, pose: view.player.presentation }
        }
      }
      return null
    })
  }
  const captureImpact = async name => {
    await page.screenshot({ path: `${out}/${name}.png` })
    await s(s => s.current.view.world.list.find(o => o.texture?.key.startsWith('fx-')).anims.resume())
    await page.waitForFunction(() => !window.__game.scene.getScene('AppScene').current.view.world.list.some(o => o.texture?.key.startsWith('fx-')))
  }
  for (const [button, attack] of [['f', 'light-punch'], ['u', 'heavy-punch'], ['g', 'light-kick'], ['i', 'heavy-kick']]) {
    for (const pose of ['standing', 'crouch', 'air']) {
      const leftFacing = attack === 'light-kick'
      await contact(leftFacing)
      if (pose === 'crouch') await page.keyboard.down('s')
      if (pose === 'air') {
        await page.keyboard.down('w'); await page.keyboard.down('ArrowUp')
        if (attack !== 'heavy-punch') { await frame(); await step() }
      }
      await page.keyboard.down(button)
      const fx = await findImpact()
      await page.keyboard.up(button)
      if (pose === 'crouch') await page.keyboard.up('s')
      if (pose === 'air') { await page.keyboard.up('w'); await page.keyboard.up('ArrowUp') }
      if (!fx) {
        const details = await s(s => ({ lastInput: s.inputManager.lastCombatInput, match: s.flow.match.getSnapshot(), contactWidth: s.flow.match.world.contactWidth }))
        assert.fail(`${attack} ${pose} missed: ${JSON.stringify(details)}`)
      }
      assert.equal(fx.key, `fx-${attack}`)
      assert.equal(fx.flipX, leftFacing)
      assert.match(fx.pose, pose === 'standing' ? new RegExp(attack.toUpperCase().split('-').reverse().join('_')) : new RegExp(pose.toUpperCase()))
      await captureImpact(`vfx-${attack}-${pose}`)
    }
  }
  await contact()
  await page.keyboard.down('ArrowDown'); await page.keyboard.down('f')
  assert.equal((await findImpact())?.key, 'fx-guard')
  await page.keyboard.up('f'); await page.keyboard.up('ArrowDown')
  await captureImpact('vfx-guard')
  console.log('PASS 四招 × 站、蹲、跳共 12 次命中，並驗證面左翻轉、防禦和特效回收')

  await world(w => { w.fighters.PLAYER.currentHP = 0 })
  await step(100)
  assert.deepEqual((await health()).map(side => [side.percent, side.lives]), [['100%', 1], ['100%', 2]])
  await shot('hud-round-lost')
  await contact()
  await world(w => {
    w.fighters.PLAYER.currentHP = 1
    for (const fighter of Object.values(w.fighters)) { fighter.y -= 120; fighter.grounded = false }
  })
  await page.keyboard.down('Numpad1'); await frame()
  const finalHit = await s(s => {
    s.stepBattle(8)
    return { state: s.appStateMachine.getCurrentState(), shake: s.cameras.main.shakeEffect.isRunning }
  })
  await page.keyboard.up('Numpad1')
  assert.deepEqual(finalHit, { state: 'P5_PRESENTATION', shake: true })
  await s(s => s.clock.start())
  await waitState('P5'); await page.waitForFunction(() => Object.values(window.__game.scene.getScene('AppScene').flow.match.getSnapshot().world.fighters).every(fighter => fighter.grounded))
  await shot('2p-p5')
  await reviewReady('presentation-next'); await key('Enter'); await waitState('P6'); await shot('2p-p6')
  await reviewReady('result-next'); await key('Enter'); await waitState('P7'); await shot('2p-p7')
  await key('ArrowDown'); await key('Enter'); await waitState('P0')
  console.log('PASS 雙人流程 P0→P7→P0 走完，HUD 狀態與頭像皆已驗證')

  await writeFile(`${out}/assets.json`, JSON.stringify({ requested: [...requested].sort(), missing: [...missing].sort() }, null, 2))
  assert.deepEqual([...missing], [], `404: ${[...missing].join(', ')}`)
  console.log(`PASS /test-assets/ 請求 ${requested.size} 個，0 個 404`)
  assert.deepEqual(errors, [], errors.join('\n'))
  console.log('PASS 沒有頁面錯誤')
} finally { await browser.close() }
