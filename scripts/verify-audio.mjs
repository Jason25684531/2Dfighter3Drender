import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
await mkdir('outputs/audio-verification', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), cues = [], errors = []
  page.on('console', message => { if (message.text().startsWith('[audio] ')) cues.push(message.text().slice(8)) })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:8000/**', route => route.abort())
  await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await page.goto((process.env.APP_URL ?? 'http://127.0.0.1:5189/') + '?audioDebug=1&mute=1')
  await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  const manifestFiles = await page.evaluate(async () => Object.values((await import('/src/game/audio/AudioManifest.ts')).AUDIO_MANIFEST).map(cue => decodeURI(cue.url).split('/').at(-1)).sort())
  const sourceFiles = (await readdir('Audio')).filter(file => /\.(mp3|flac|wav|ogg)$/i.test(file)).sort()
  assert.equal(sourceFiles.length, 32); assert.deepEqual(manifestFiles, sourceFiles)
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState() === 'P0_IDLE' && s.buttons.has('p0-board') })
  await page.keyboard.press('ArrowRight')
  const boardPoint = await page.locator('canvas').evaluate(canvas => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width * 1180 / 1920, y: r.top + r.height * 860 / 1080 } })
  await page.mouse.click(boardPoint.x, boardPoint.y)
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').boardPanel)
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').appStateMachine.getCurrentState().startsWith('P1'))
  const confirmsBeforeSelect = cues.filter(id => id === 'ui-confirm').length
  await page.evaluate(() => window.__game.scene.getScene('AppScene').p1Input('P1', 'CONFIRM'))
  assert.equal(cues.filter(id => id === 'ui-confirm').length, confirmsBeforeSelect + 1, 'accepted P1 confirm must play a cue')
  const confirmsAfterSelect = cues.filter(id => id === 'ui-confirm').length
  await page.evaluate(() => { const s = window.__game.scene.getScene('AppScene'); s.p1Model.rival.cursor = s.p1Model.player('P1').locked; s.p1Input('P1', 'CONFIRM') })
  assert.equal(cues.filter(id => id === 'ui-confirm').length, confirmsAfterSelect, 'rejected P1 confirm must stay silent')
  await page.evaluate(() => { const s = window.__game.scene.getScene('AppScene'); s.flow.setPlayers({ P1: { characterId: 'preset-e' } }); ['P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach(state => s.appStateMachine.transitionTo(state)) })
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'FIGHTING', null, { timeout: 15000 })
  await page.evaluate(() => { const s = window.__game.scene.getScene('AppScene'), w = s.flow.match.world; s.flow.match.ai.getIntent = () => ({ moveX: 0, jumpPressed: false, attackPressed: false }); w.fighters.PLAYER.x = 1300; w.fighters.ENEMY.x = 1520; w.fighters.ENEMY.currentHP = 10 })
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').flow.match.getSnapshot().matchState === 'ROUND_END', null, { timeout: 5000 })
  await page.waitForTimeout(200)
  const required = ['ui-cursor', 'ui-confirm', 'ann-round-1', 'ann-fight', 'mov-miss-light', 'hit-light', 'ann-ko']
  assert.ok(cues.filter(id => id === 'ui-confirm').length >= 2, `missing pointer or keyboard confirm: ${cues}`)
  let previous = -1
  for (const id of required) { const index = cues.indexOf(id, previous + 1); assert.ok(index > previous, `missing or out of order: ${id}; ${cues}`); previous = index }
  const decoded = await page.evaluate(async () => {
    const audio = new AudioContext(), results = []
    for (const file of ['HIT-01_hit_light.flac', 'HIT-03_block.wav']) {
      const response = await fetch('/test-assets/audio/' + encodeURIComponent(file))
      const buffer = await audio.decodeAudioData(await response.arrayBuffer())
      results.push(buffer.duration > 0)
    }
    await audio.close(); return results
  })
  assert.deepEqual(decoded, [true, true]); assert.deepEqual(errors, [])
  await page.screenshot({ path: 'outputs/audio-verification/round-end.png' })
  console.log('PASS audio cue order and Chrome FLAC/WAV decoding:', cues.join(', '))
} finally { await browser.close() }
