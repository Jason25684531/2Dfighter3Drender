// Verify live fighter frames and run the production CPU through ten matches per lunge fighter.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5189/')
base.searchParams.set('hitbox', '')
const roster = { go: [5, ['LIGHT_PUNCH', 'HEAVY_PUNCH']], joneey: [7, ['LIGHT_PUNCH', 'HEAVY_PUNCH']], yg: [8, ['HEAVY_PUNCH']], tony: [9, ['HEAVY_PUNCH']] }
const out = 'outputs/fighter-lunge-combat'
const selected = process.argv.slice(2)
const report = selected.length ? JSON.parse(await readFile(`${out}/report.json`, 'utf8').catch(() => '{}')) : {}
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  for (const [id, [slot, attacks]] of Object.entries(roster).filter(([id]) => !selected.length || selected.includes(id))) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    try {
      const page = await context.newPage()
      await page.route('http://localhost:8765/**', route => route.abort())
      await page.route('**/src/main.ts*', async route => {
        const response = await route.fetch()
        await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') })
      })
      const scene = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
      const state = prefix => page.waitForFunction(prefix => {
        const s = window.__game?.scene.getScene('AppScene')
        return s?.appStateMachine.getCurrentState().startsWith(prefix) && s.screen?.alpha >= 0.99
      }, prefix, { timeout: 60000 })
      const key = async name => { await page.keyboard.press(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
      await page.goto(base.href); await state('P0')
      await page.waitForFunction(() => window.__game.scene.getScene('AppScene').ui.focus.current() === 'p0-start')
      await key('Enter'); await state('P1')
      await scene((s, slot) => { s.p1Model.focus('P1', slot); s.p1View.sync() }, slot)
      await key('f'); await key('f'); await key('f'); await state('P2')
      await key('Enter'); await state('P3')
      await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.ready, null, { timeout: 60000 })
      await key('Enter'); await state('P4')
      await page.waitForFunction(() => {
        const { matchState, announce } = window.__game.scene.getScene('AppScene').flow.match.getSnapshot()
        return matchState === 'FIGHTING' && !announce
      })
      await scene(s => { s.clock.stop(); s.current.update = () => s.current.view.renderAt(1) })
      const frames = {}
      for (const attack of attacks) {
        const initial = await scene(s => {
          const { world } = s.flow.match
          world.reset(); s.current.tick()
          return world.getFighter('PLAYER').x
        })
        const move = await scene((s, attack) => s.flow.match.world.move(attack), attack)
        const step = (count, press = false) => scene((s, { count, press, attack }) => {
          const { world } = s.flow.match
          const neutral = { moveX: 0, jumpPressed: false, attackPressed: false }
          for (let i = 0; i < count; i++) { world.tick({ ...neutral, attack, attackPressed: press && i === 0 }, neutral); s.current.tick() }
          const fighter = world.getFighter('PLAYER'), renderer = s.current.view.player
          return { x: fighter.x, y: fighter.y, grounded: fighter.grounded, phase: fighter.attackPhase, lift: renderer.currentPosition.lift, pose: renderer.pose(fighter), sprite: renderer.image.texture.key }
        }, { count, press, attack })
        const startup = await step(1, true)
        await page.screenshot({ path: `${out}/${id}-${attack}-startup.png` })
        const peak = await step(Math.floor((move.startupTicks + move.activeTicks - 1) / 2))
        await page.screenshot({ path: `${out}/${id}-${attack}-peak.png` })
        const recovery = await step(move.startupTicks + move.activeTicks - Math.floor((move.startupTicks + move.activeTicks - 1) / 2))
        await page.screenshot({ path: `${out}/${id}-${attack}-recovery.png` })
        const done = await step(move.recoveryTicks)
        assert.equal(startup.phase, 'STARTUP'); assert.equal(recovery.phase, 'RECOVERY'); assert.equal(done.phase, 'NONE')
        assert(peak.lift > 30 && peak.grounded && peak.y === startup.y)
        assert.equal(peak.pose.originY, recovery.pose.originY)
        assert.equal(recovery.lift, 0); assert.equal(done.x, recovery.x)
        assert(Math.abs(done.x - initial - (attack === 'HEAVY_PUNCH' ? 140 : 90)) < 0.01)
        frames[attack] = { initial, startup, peak, recovery, done }
      }
      const cpu = await scene(async (s, id) => {
        const { MatchController } = await import('/src/game/match/MatchController.ts')
        const { lungeFor } = await import('/src/game/config/hitTuning.ts')
        const actions = ['LIGHT_PUNCH', 'HEAVY_PUNCH', 'LIGHT_KICK', 'HEAVY_KICK']
        const distances = Object.fromEntries(Object.entries(lungeFor(id)).map(([attack, lunge]) => [attack, lunge.advance]))
        const matches = []
        for (let game = 0; game < 10; game++) {
          const match = new MatchController(s.flow.match.world.getConfig())
          const enemyLunges = []
          match.world.setLunge({ PLAYER: {}, ENEMY: distances })
          match.world.subscribe(event => {
            if (event.type !== 'ATTACK_STARTED' || event.attacker !== 'ENEMY' || !distances[event.attack]) return
            const { PLAYER, ENEMY } = match.world.getSnapshot().fighters
            enemyLunges.push(Math.abs(PLAYER.x - ENEMY.x))
          })
          match.start()
          for (let tick = 0; tick < 9500 && !match.getCompletedMatch(); tick++) {
            const { PLAYER, ENEMY } = match.world.getSnapshot().fighters
            const distance = Math.abs(ENEMY.x - PLAYER.x)
            const attack = actions[(game + Math.floor(tick / 9)) % actions.length]
            if (game < 2) match.tick()
            else match.tick({ moveX: distance > 340 ? Math.sign(ENEMY.x - PLAYER.x) : 0, jumpPressed: tick % (55 + game) === 1, attackPressed: distance <= 400 && tick % (7 + game) === 0, attack })
          }
          const completed = match.getCompletedMatch()
          if (!completed || !enemyLunges.length) throw new Error(`Incomplete CPU match for ${id}/${game}`)
          matches.push({ winner: completed.winner, enemyLunges: enemyLunges.length, lungeMinGap: Math.min(...enemyLunges), lungeMaxGap: Math.max(...enemyLunges) })
        }
        return matches
      }, id)
      report[id] = { frames, cpu }
      console.log(`PASS ${id}: ${attacks.length} advancing punches, ${cpu.length} CPU matches`)
    } finally {
      await context.close()
    }
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
