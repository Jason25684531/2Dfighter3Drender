// Uses an existing Playwright installation; run against the local Vite server.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const out = 'outputs/kevin-verification', report = { checks: [], errors: [] }
await mkdir(out, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('http://localhost:8000/**', route => route.abort())
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') })
  })
  const scene = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async name => { await page.keyboard.press(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
  const waitState = state => page.waitForFunction(state => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(state) && s.screen.alpha >= .99 }, state)
  const check = message => { report.checks.push(message); console.log('PASS ' + message) }
  await page.goto(process.env.P1_URL ?? 'http://127.0.0.1:5189/')
  await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  const animations = await scene(async s => {
    const { sheetAnimations: kevinAnimations } = await import('/src/game/ui/animation/SheetSpriteManifest.ts')
    return kevinAnimations.map(({ key, filename }) => ({ key, filename, frames: s.anims.get(`kevin-${key}`)?.frames.map(frame => Number(frame.textureFrame)), size: s.textures.get(`kevin-${key}`).get(0).width }))
  })
  assert.equal(animations.length, 15)
  for (const clip of animations) { assert.deepEqual(clip.frames, Array.from({ length: 16 }, (_, i) => i)); assert.equal(clip.size, 128) }
  check('All 15 Kevin sheets load as 16 ordered 128px frames')
  await key('Enter'); await waitState('P1')
  await key('d'); await key('d'); await key('d')
  assert.equal(await scene(s => s.p1Model.heroSlot('P1').entry.displayName), 'KEVIN')
  const frames = await scene(s => new Promise(resolve => {
    const image = s.p1View.heroes.P1.figure, seen = []
    const record = (_anim, frame) => { seen.push(Number(frame.textureFrame)); if (seen.length === 17) { image.off('animationupdate', record); resolve(seen) } }
    image.on('animationupdate', record)
  }))
  assert.equal(new Set(frames).size, 16)
  frames.slice(1).forEach((frame, i) => assert.equal(frame, (frames[i] + 1) % 16))
  await page.screenshot({ path: `${out}/select.png` })
  check('Slot 08 selects KEVIN; Hero idle plays every frame in order')
  await key('Enter'); await key('ArrowRight'); await key('ArrowRight'); await key('Enter'); await key('j')
  await waitState('P2'); await key('Enter'); await key('Enter'); await waitState('P3')
  assert.deepEqual(await scene(s => [s.playerSpriteId(), s.enemySpriteId()]), ['kevin', 'kevin'])
  const previews = await scene(s => s.screen.list.filter(child => child.texture?.key === 'kevin-idle').map(image => ({ playing: image.anims.isPlaying, width: image.frame.width, flipped: image.flipX })))
  assert.equal(previews.length, 2); assert(previews.every(p => p.playing && p.width === 128)); assert(previews[1].flipped)
  await page.screenshot({ path: `${out}/loading.png` })
  check('P3 shows both KEVIN selections with a mirrored CPU preview')
  await key('Enter'); await waitState('P4')
  assert.deepEqual(await scene(s => [s.battlePlayer.spriteId, s.battleEnemy.spriteId]), ['kevin', 'kevin'])
  await key('Escape')
  const projections = await scene(s => {
    const renderer = s.battlePlayer, fighter = s.match.world.getFighter('PLAYER'), before = JSON.stringify(s.match.getSnapshot()), results = []
    let tick = 1000
    for (const [state, patch] of [['IDLE', {}], ['WALK', {}], ['JUMP', { grounded: false }], ['GUARD', {}], ['HIT_STUN', {}], ['ATTACK', { attackPhase: 'ACTIVE', attackTicks: 1, attackId: 101 }]]) {
      renderer.update({ ...fighter, state, attackPhase: 'NONE', ...patch }, tick++)
      results.push({ state, key: renderer.image.texture.key, size: renderer.image.frame.width })
    }
    renderer.update({ ...fighter, state: 'WALK', facing: 'LEFT' }, 2000)
    renderer.update({ ...fighter, state: 'WALK', facing: 'LEFT' }, 2005)
    return { results, nextFrame: Number(renderer.image.frame.name), facing: renderer.scaleX, unchanged: before === JSON.stringify(s.match.getSnapshot()) }
  })
  assert.deepEqual(projections.results.map(item => item.key), ['kevin-idle', 'kevin-walk', 'kevin-jump', 'kevin-guard', 'kevin-prone', 'kevin-attack'])
  assert(projections.results.every(item => item.size === 128)); assert.equal(projections.nextFrame, 1); assert.ok(projections.facing < 0) // 縱深縮放使 |scaleX| < 1; assert(projections.unchanged)
  await key('Escape'); await page.keyboard.down('k') // K＝防禦
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').battlePlayer.image.texture.key === 'kevin-guard')
  await page.screenshot({ path: `${out}/battle.png` })
  await page.keyboard.up('k')
  check('P4 maps all six combat states and advances sheet frames; actual guard input works')
  const old = await scene(s => { s.__oldHero = s.battlePlayer; return s.battlePlayer.active })
  assert(old)
  await scene(s => { s.appStateMachine.transitionTo('P0_IDLE') })
  assert(await scene(s => !s.__oldHero.scene))
  check('Leaving battle destroys the renderer')
  const reduced = await browser.newPage({ reducedMotion: 'reduce' })
  await reduced.route('http://localhost:8000/**', route => route.abort())
  await reduced.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await reduced.goto(process.env.P1_URL ?? 'http://127.0.0.1:5189/')
  await reduced.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  await reduced.evaluate(() => { const s = window.__game.scene.getScene('AppScene'); s.appStateMachine.transitionTo('P1_READY'); s.p1Model.focus('P1', 8); s.p1View.sync() })
  assert(await reduced.evaluate(() => { const image = window.__game.scene.getScene('AppScene').p1View.heroes.P1.figure; return !image.anims.isPlaying && image.frame.width === 128 }))
  await reduced.close()
  check('Reduced motion keeps the KEVIN preview static')
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
