// Run Vite on 5189 and an isolated backend on 19881 before this check.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const out = 'outputs/aligned-character-verification'
await mkdir(out, { recursive: true })
const metadata = JSON.parse(await readFile('src/game/ui/animation/AlignedSpriteData.json', 'utf8'))
const report = { checks: [], errors: [], failedAssets: [] }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
let page
try {
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/test-assets/')) report.failedAssets.push(response.url()) })
  await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.route('http://localhost:8000/**', async route => { const response = await route.fetch({ url: route.request().url().replace('http://localhost:8000', 'http://127.0.0.1:19881') }); await route.fulfill({ response }) })
  const scene = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const state = prefix => page.waitForFunction(prefix => { const s = window.__game?.scene.getScene('AppScene'); return s?.appStateMachine.getCurrentState().startsWith(prefix) && s.screen?.alpha >= .99 }, prefix)
  const key = async name => { await page.keyboard.down(name); await scene(s => new Promise(r => s.events.once('postupdate', r))); await page.keyboard.up(name); await scene(s => new Promise(r => s.events.once('postupdate', r))) }
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png` }) }
  const check = text => { report.checks.push(text); console.log('PASS ' + text) }
  await page.goto('http://127.0.0.1:5189/')
  await state('P0'); await key('Enter'); await state('P1')
  assert.deepEqual(await scene(s => s.p1Model.slots.slice(0, 10).map(slot => slot.entry.spriteId)), ['s1aw', 's2am', 's2lw', 's3ww', 'tony', 'chris', 'go', 'se7en', 'kevin', 'body01'])
  assert.deepEqual(await scene(s => ['aria-idle-1', 'kael-idle-1', 'riven-idle-1'].filter(key => s.textures.exists(key))), [])
  await shot('01-roster')
  for (const [index, id] of ['s1aw', 's2am', 's2lw', 's3ww', 'tony', 'chris', 'go', 'se7en'].entries()) {
    await scene((s, index) => { s.p1Model.focus('P1', index + 1); s.p1View.sync() }, index)
    await shot(`02-preview-${id}`)
  }
  check('Ordered custom/officer roster, all eight previews, no legacy preloads')
  const loaded = await scene((s, metadata) => Object.entries(metadata).flatMap(([id, sprite]) => Object.entries(sprite.actions).map(([number, action]) => {
    const key = ({ '01':'intro-victory','02':'idle','03':'walk','04':'jump','05':'crouch','06':'block','07':'prone','08':'attack','09':'punch-heavy','10':'punch-jump','11':'punch-crouch','12':'kick-light','13':'kick-heavy','14':'kick-jump','15':'kick-crouch' })[number]
    const texture = s.textures.get(`${id}-${key}`), animation = s.anims.get(`${id}-${key}`)
    return { id, key, frames: texture.frameTotal - 1, expected: action.frames, fps: animation.frameRate, expectedFps: sprite.fps, width: texture.get(0).width }
  })), metadata)
  for (const action of loaded) { assert.equal(action.frames, action.expected); assert.equal(action.fps, action.expectedFps); assert.equal(action.width, 256) }
  check('All 120 textures/animations match frame counts, cell dimensions and manifest fps')
  await scene(s => { s.p1Model.focus('P1', 5); s.p1View.sync() })
  await key('f'); await key('f'); await key('f'); await state('P2'); await shot('03-stage')
  await key('Enter'); await state('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').loadingReady)
  await key('Enter'); await state('P4'); await page.waitForTimeout(4500); await shot('04-battle-tony-chris')
  const poses = await scene(async s => {
    const { TemporarySpriteRenderer } = await import('/src/game/ui/animation/TemporarySpriteRenderer.ts')
    s.clock.pause()
    const base = s.flow.match.world.getFighter('PLAYER'), results = []
    const cases = [
      ['idle', { state: 'IDLE', attackPhase: 'NONE' }], ['walk', { state: 'WALK', attackPhase: 'NONE' }], ['jump', { state: 'JUMP', grounded: false, attackPhase: 'NONE' }],
      ['crouch', { state: 'IDLE', attackPhase: 'NONE' }, { crouch: true }], ['block', { state: 'GUARD', attackPhase: 'NONE' }], ['prone', { state: 'KNOCKDOWN', attackPhase: 'NONE' }],
      ['intro-victory', { state: 'IDLE', attackPhase: 'NONE' }, { outcome: 'WIN' }],
      ['attack', { attack: 'LIGHT_PUNCH' }], ['punch-heavy', { attack: 'HEAVY_PUNCH' }], ['kick-light', { attack: 'LIGHT_KICK' }], ['kick-heavy', { attack: 'HEAVY_KICK' }],
      ['punch-jump', { attack: 'LIGHT_PUNCH', grounded: false }], ['kick-jump', { attack: 'LIGHT_KICK', grounded: false }],
      ['punch-crouch', { attack: 'LIGHT_PUNCH' }, { crouch: true }], ['kick-crouch', { attack: 'LIGHT_KICK' }, { crouch: true }],
    ]
    for (const id of ['s1aw','s2am','s2lw','s3ww','tony','chris','go','se7en']) {
      const renderer = new TemporarySpriteRenderer(s, id, base.y)
      for (const [i, [expected, patch, context]] of cases.entries()) {
        const fighter = { ...base, state: 'ATTACK', grounded: true, attackPhase: 'ACTIVE', attackTicks: 1, attackId: i + 100, ...patch }
        for (const tick of [0, 2, 12, 40]) {
          renderer.update(fighter, tick, context)
          const image = renderer.image
          if (image.texture.key !== `${id}-${expected}` || !image.texture.has(image.frame.name)) throw new Error(`Invalid pose: ${id} ${expected} ${image.texture.key}:${image.frame.name}`)
        }
        results.push(`${id}-${expected}`)
      }
      renderer.destroy()
    }
    s.clock.resume()
    return results
  })
  assert.equal(poses.length, 120); check('Actual Phaser renderer resolves all 15 presentations for all eight aligned characters')
  // End rounds quickly through world state; keep the production flow and persistence paths.
  for (let round = 0; round < 2; round++) {
    await scene(s => { s.flow.match.world.fighters.ENEMY.currentHP = 0 })
    if (!round) await page.waitForFunction(() => { const m = window.__game.scene.getScene('AppScene').flow.match.getSnapshot(); return m.matchState === 'FIGHTING' && m.roundNumber === 2 }, null, { timeout: 20000 })
  }
  await state('P5'); await shot('05-result-presentation'); await key('Enter'); await state('P6'); await key('Enter'); await state('P7'); await key('Enter'); await state('P1')
  check('P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → replay P1, preserving existing workspace behavior')
  const live = JSON.parse(await readFile(`${out}/comfy-live-report.json`, 'utf8'))
  assert.equal(live.status, 'ready')
  const generated = await scene(async (s, job) => {
    const { loadGeneratedCharacter } = await import('/src/game/api/CharacterGeneration.ts')
    await loadGeneratedCharacter(s, job, new AbortController().signal, true)
    const slot = s.p1Model.slots.find(slot => slot.entry?.generationId === job)
    if (!slot) throw new Error('Live generated character not listed')
    s.p1Model.focus('P1', slot.index); s.p1View.sync()
    return s.textures.get(`generated-${job}-idle`).frameTotal - 1
  }, live.job)
  assert.equal(generated, live.actions['02_Idle'].frames)
  await shot('06-comfy-live-preview')
  check('Real ComfyUI output appears in roster and decodes as a manifest-sized Phaser texture')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedAssets, [])
} catch (error) {
  report.failure = error.stack
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {})
  throw error
} finally {
  await writeFile(`${out}/browser-report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
