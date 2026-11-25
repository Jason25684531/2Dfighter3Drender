// Record the attract-mode clips from a running Vite game: 2P on one keyboard, the left fighter (1P) wins 2–0.
// Requires local Chrome, Playwright, and ffmpeg. Pass clip names to re-record only those.
// Clip names must match ATTRACT_CLIPS in src/game/scenes/AppScene.ts.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const out = 'outputs/attract-recording'
const slots = { go: 5, se7en: 6, joneey: 7, yg: 8, tony: 9, chris: 10 }
const clips = [['joneey', 'go'], ['yg', 'se7en'], ['tony', 'go'], ['chris', 'se7en']].map(([p1, p2], i) => ({ name: `0${i + 1}-${p1}-vs-${p2}`, p1, p2 }))
const selected = process.argv.slice(2)
const audience = 'public/test-assets/audio/AMB-01_audience cheer.mp3'
const viewport = { width: 1920, height: 1080 }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })

async function play({ p1, p2 }) {
  const context = await browser.newContext({ viewport, recordVideo: { dir: out, size: viewport } })
  const opened = Date.now(), page = await context.newPage(), video = page.video()
  let report
  try {
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
    const frame = () => scene(s => new Promise(resolve => s.events.once('postupdate', resolve)))
    const key = async name => { await page.keyboard.press(name); await frame() }
    await page.goto(base)
    await state('P0'); await key('Enter'); await state('P1')
    await key('Numpad1')
    await scene((s, [a, b]) => { s.p1Model.focus('P1', a); s.p1Model.focus('P2', b); s.p1View.sync() }, [slots[p1], slots[p2]])
    await key('f'); await key('Numpad1'); await state('P2')
    assert.deepEqual(await scene(s => [s.playerSpriteId(), s.enemySpriteId(), s.selectedStageId]), [p1, p2, 'laboratory'])
    await key('Enter'); await state('P3')
    await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.ready, null, { timeout: 60000 })
    await key('Enter'); await state('P4')
    const battleStart = Date.now()
    await scene(s => {
      s.recording = { hits: 0, heavyLunges: 0, knockouts: 0, playerKnockedOut: 0 }
      s.appStateMachine.subscribe(({ nextState }) => { if (nextState.startsWith('P5')) s.recording.endedAt = Date.now() })
      const world = s.flow.match.world
      world.subscribe(event => {
        if (event.type === 'DAMAGE') {
          s.recording.hits++
          if (world.getFighter(event.defender).currentHP === 0) { s.recording.knockouts++; if (event.defender === 'PLAYER') s.recording.playerKnockedOut++ }
        }
      })
    })

    for (const round of [1, 2]) {
      await page.waitForFunction(round => {
        const snap = window.__game.scene.getScene('AppScene').flow.match.getSnapshot()
        return snap.matchState === 'FIGHTING' && snap.roundNumber === round
      }, round, { timeout: 12000 })
      for (let at = 0; at < 16; at++) {
        const attacker = at === 1 || at === 4 ? 'ENEMY' : 'PLAYER'
        const defender = attacker === 'PLAYER' ? 'ENEMY' : 'PLAYER'
        const attackKey = attacker === 'ENEMY' ? 'Numpad2' : 'u'
        await page.waitForFunction(({ attacker, defender }) => {
          const snap = window.__game.scene.getScene('AppScene').flow.match.getSnapshot()
          const a = snap.world.fighters[attacker], d = snap.world.fighters[defender]
          return snap.matchState !== 'FIGHTING' || (a.attackPhase === 'NONE' && !a.hitStunTicks && !a.knockdownTicks && !d.invulnerableTicks && !d.knockdownTicks)
        }, { attacker, defender }, { timeout: 9000 })
        const snap = await scene(s => s.flow.match.getSnapshot())
        if (snap.matchState !== 'FIGHTING') break
        const { [attacker]: a, [defender]: d } = snap.world.fighters
        const priorGap = Math.abs(a.x - d.x)
        const contact = await scene(s => s.flow.match.world.contactWidth ?? 220)
        if (priorGap > contact + 85) {
          const movement = attacker === 'PLAYER' ? a.x < d.x ? 'd' : 'a' : a.x < d.x ? 'ArrowRight' : 'ArrowLeft'
          await page.keyboard.down(movement)
          await page.waitForFunction(contact => {
            const { PLAYER, ENEMY } = window.__game.scene.getScene('AppScene').flow.match.world.getSnapshot().fighters
            return Math.abs(PLAYER.x - ENEMY.x) <= contact + 85
          }, contact, { timeout: 6000 })
          await page.keyboard.up(movement)
        }
        const before = await scene((s, attacker) => s.flow.match.world.getFighter(attacker), attacker)
        await key(attackKey)
        await page.waitForFunction(({ attacker, attackId }) => window.__game.scene.getScene('AppScene').flow.match.world.getFighter(attacker).attackId !== attackId, { attacker, attackId: before.attackId }, { timeout: 3000 })
        const after = await scene((s, attacker) => s.flow.match.world.getFighter(attacker), attacker)
        if (after.attack === 'HEAVY_PUNCH' && after.lungeProgress !== undefined && Math.abs(after.x - before.x) > 0) {
          await scene(s => { s.recording.heavyLunges++ })
        }
      }
    }
    await state('P5')
    const { endedAt, ...counts } = await scene(s => s.recording)
    // Leave a short margin at the transition so the clip ends before the results controls appear.
    const recording = { ...counts, start: (battleStart - opened) / 1000, end: (endedAt - opened) / 1000 - 0.35 }
    assert(recording.knockouts === 2 && recording.playerKnockedOut === 0, `1P must win 2–0: ${JSON.stringify(recording)}`)
    report = recording
  } finally {
    await context.close()
    if (!report) await unlink(await video.path()).catch(() => {})
  }
  return { ...report, video: await video.path() }
}

try {
  for (const clip of clips.filter(({ name }) => !selected.length || selected.includes(name))) {
    const target = `public/test-assets/attract/${clip.name}.mp4`
    for (let attempt = 1; attempt <= 3; attempt++) {
      let take
      try {
        take = await play(clip)
        const duration = take.end - take.start
        assert(duration >= 20 && duration <= 60, `Battle footage duration: ${duration.toFixed(1)} s`)
        const rendered = `${out}/${clip.name}.mp4`
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', take.start.toFixed(3), '-i', take.video, '-stream_loop', '-1', '-i', audience, '-t', duration.toFixed(3), '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=1280:720,fps=30', '-af', 'volume=0.35', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', rendered], { stdio: 'inherit', windowsHide: true })
        await copyFile(rendered, target)
        const { video, ...recording } = take
        await writeFile(`${out}/${clip.name}.json`, JSON.stringify({ ...recording, duration, attempt }, null, 2))
        console.log(`Recorded ${clip.name} in Lab (${duration.toFixed(1)} s, ${take.knockouts} K.O.s, ${take.heavyLunges} advancing heavy punches)`)
        break
      } catch (error) {
        console.error(`${clip.name} take ${attempt}: ${error.message}`)
        if (attempt === 3) throw error
      } finally {
        if (take?.video) await unlink(take.video)
      }
    }
  }
} finally {
  await browser.close()
}
