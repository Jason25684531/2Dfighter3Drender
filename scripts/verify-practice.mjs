// Run against Vite. --baseline measures the old practice texture behavior.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseline = process.argv.includes('--baseline')
const live = process.argv.includes('--live')
const profile = process.argv.includes('--profile')
const offline = process.argv.includes('--offline-comfy')
const base = process.env.APP_URL ?? 'http://localhost:5173/'
const api = process.env.COMFY_SMOKE_API ?? 'http://127.0.0.1:19885/api/v1'
const out = baseline ? 'outputs/fighter-lunge-baseline' : 'outputs/fighter-lunge-practice'
const report = {}
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })

async function gpuMemory() {
  if (process.platform !== 'win32') return undefined
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
    const pid = processInfo.find(process => process.type.toLowerCase() === 'gpu')?.id
    if (!Number.isInteger(pid)) return undefined
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$rows = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter "Name LIKE 'pid_${pid}_%'"; if ($rows) { [uint64](($rows | Measure-Object -Property DedicatedUsage -Sum).Sum) }`], { windowsHide: true, encoding: 'utf8', timeout: 15000 }).trim()
    return out ? { pid, dedicatedBytes: Number(out) } : undefined
  } finally {
    await cdp.detach()
  }
}

try {
  for (const mode of live ? ['generating'] : offline ? ['offline'] : profile ? ['normal'] : baseline ? ['normal', 'generating'] : ['normal', 'generating', 'missing']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(30000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/src/main.ts*', async route => {
        const response = await route.fetch()
        await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') })
      })
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type' }
      const liveId = live ? JSON.parse(await readFile('outputs/aligned-character-verification/comfy-live-report.json', 'utf8')).assetId : undefined
      let generatedReady = false
      const submissionErrors = []
      await page.route('http://localhost:8000/**', async route => {
        const url = new URL(route.request().url())
        if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
        if (offline && url.pathname.endsWith('/generation')) {
          const response = await route.fetch({ url: `${api}/generation` })
          submissionErrors.push(response.status())
          return route.fulfill({ response, headers: { ...response.headers(), ...headers } })
        }
        if (url.pathname.endsWith('/generation')) return route.fulfill({ headers, json: { job: 'practice-test' } })
        if (url.pathname.endsWith('/generation/practice-test')) {
          if (!generatedReady) return route.fulfill({ headers, json: { status: 'processing' } })
          const asset = await (await fetch(`${api}/generation/assets/${liveId}`)).json()
          return route.fulfill({ headers, json: { ...asset, status: 'ready' } })
        }
        if (liveId && url.pathname.includes(`/generation/assets/${liveId}/sheets/`)) {
          const response = await route.fetch({ url: `${api}/generation/assets/${liveId}/sheets/${url.pathname.split('/').at(-1)}` })
          return route.fulfill({ response, headers: { ...response.headers(), ...headers } })
        }
        return route.abort()
      })
      let waitForAssets = false, failAsset = mode === 'missing', release
      const assetsReleased = new Promise(resolve => { release = resolve })
      await page.route('**/assest/characters/*/*.png', async route => {
        if (waitForAssets) await assetsReleased
        if (failAsset && /03_Move\.png$/.test(route.request().url())) return route.fulfill({ status: 404 })
        return route.continue()
      })
      const scene = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
      const state = prefix => page.waitForFunction(prefix => {
        const s = window.__game?.scene.getScene('AppScene')
        return s?.appStateMachine.getCurrentState().startsWith(prefix) && s.screen?.alpha >= 0.99
      }, prefix, { timeout: 60000 })
      const phase = value => page.waitForFunction(value => window.__game.scene.getScene('AppScene').p1Model?.phase === value, value)
      const key = async value => {
        await page.keyboard.press(value)
        await scene(s => new Promise(resolve => s.events.once('postupdate', resolve)))
      }
      const inspect = () => scene(s => {
        const { view, practice } = s.current, { PLAYER, ENEMY } = practice.world.getSnapshot().fighters
        const texture = renderer => ({ key: renderer.image.texture.key, cell: renderer.image.frame.cutWidth })
        return { player: texture(view.player), enemy: texture(view.enemy), x: PLAYER.x, y: PLAYER.y, hp: [PLAYER.currentHP, ENEMY.currentHP], generating: s.jobs.generating, width: practice.world.contactWidth, sameScreen: s.practiceProbe === s.current }
      })
      const textureFootprint = () => scene(s => {
        // Officers' HD idles stay loaded for sharp select previews; battle action sheets and generated characters must be released.
        const textures = s.textures.getTextureKeys().filter(key => (key.startsWith('hd-') && !key.endsWith('-idle')) || key.startsWith('generated-'))
        const gl = s.game.renderer.gl, info = gl?.getExtension('WEBGL_debug_renderer_info')
        const bytes = textures.reduce((sum, key) => sum + s.textures.get(key).source.reduce((bytes, image) => bytes + image.width * image.height * 4, 0), 0)
        return { adapter: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null, textures: textures.length, estimatedRgbaBytes: bytes }
      })

      await page.goto(base)
      await state('P0')
      const gpuBefore = live ? await gpuMemory().catch(() => undefined) : undefined
      await key('Enter'); await state('P1')
      if (mode === 'generating' || mode === 'offline') {
        await key('a'); await key('f'); await phase('NAME')
        await page.locator('input').fill('Practice probe'); await page.keyboard.press('Enter'); await phase('CUSTOMIZE')
        await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
        await key('f'); await phase('REVIEW'); await key('f'); await phase('OPPONENT')
      } else {
        await key('d'); await key('f')
      }
      await key('f'); await key('f'); await state('P2')
      waitForAssets = true
      await key('Enter'); await state('P3')
      await scene(s => { s.practiceProbe = s.current })
      const initial = await inspect()
      await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d')
      await page.waitForTimeout(80)
      const moved = await inspect()
      assert(moved.x > initial.x + 30, JSON.stringify({ initial, moved }))
      release()
      await page.waitForFunction(mode => window.__game.scene.getScene('AppScene').jobs.assets === (mode === 'missing' ? 'failed' : 'ready'), mode)
      await page.waitForTimeout(250)
      const loaded = await inspect()
      report[mode] = { initial, moved, loaded }
      if (baseline) continue
      assert.equal(loaded.x, moved.x)
      assert.equal(loaded.sameScreen, true)
      assert.deepEqual(loaded.hp, moved.hp)
      if (offline) {
        await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.canSkipGeneration)
        await key('Enter')
        await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.canSkipGeneration)
        assert.deepEqual(submissionErrors, [502, 502])
        await key('ArrowDown'); await key('Enter'); await state('P4')
        assert.equal(await scene(s => s.current.view.player.spriteId), 's3ww')
        report[mode].submissionErrors = submissionErrors
        console.log('PASS ComfyUI connection refused: retry gives 502 and skipping starts a match with the template')
        continue
      }
      if (mode !== 'missing') {
        assert.match(loaded.player.key, /^hd-/)
        assert.match(loaded.enemy.key, /^hd-/)
        assert(loaded.player.cell >= 975 / 2 && loaded.enemy.cell >= 975 / 2)
        if (mode === 'generating') assert.equal(loaded.generating, true)
      } else {
        assert.match(await scene(s => s.current.percent.text), /載入失敗.*重試/)
        await page.keyboard.down('a'); await page.waitForTimeout(200)
        assert.doesNotMatch((await inspect()).player.key, /^hd-/)
        await page.keyboard.up('a')
        failAsset = false
        await key('Enter')
        await page.waitForFunction(() => window.__game.scene.getScene('AppScene').jobs.assets === 'ready')
      }
      if (mode === 'normal') {
        // 長官的原圖待機在開機時載好：P3 一開始就是清晰版，載完動作圖集後站姿寬度不變。
        assert.match(moved.player.key, /^hd-/, 'Officers start P3 on the boot-loaded HD idle')
        assert.equal(loaded.width, moved.width, 'The stance width does not jump when the action sheets finish loading')
        report[mode].firstHitTicks = await scene(s => {
          const screen = s.current, world = screen.practice.world
          world.fighters.ENEMY.x = world.fighters.PLAYER.x + world.contactWidth
          const neutral = { moveX: 0, jumpPressed: false, attackPressed: false }
          const hitTest = world.hitTest
          let poseMs = 0, contactMs = 0
          world.setHitTest((attacker, defender) => {
            const start = performance.now()
            screen.view.player.pose(attacker)
            const posed = performance.now()
            const hit = hitTest(attacker, defender)
            poseMs = posed - start
            contactMs = performance.now() - posed
            return hit
          })
          return Array.from({ length: 9 }, (_, i) => {
            const start = performance.now()
            world.tick({ ...neutral, attackPressed: i === 0, attack: 'HEAVY_PUNCH' }, neutral)
            return { ms: performance.now() - start, enemyHp: world.getFighter('ENEMY').currentHP, poseMs, contactMs }
          })
        })
        assert(report[mode].firstHitTicks.some(tick => tick.enemyHp < 100), 'First attack must hit for the timing sample')
        const resetWidth = await scene(s => {
          const screen = s.current, world = screen.practice.world
          world.reset(); world.setPushWidth(undefined)
          screen.tick()
          return world.contactWidth
        })
        assert.equal(resetWidth, loaded.width)
      }
      if (liveId) {
        generatedReady = true
        await page.waitForFunction(id => window.__game.scene.getScene('AppScene').current?.view?.player?.image?.texture.key === `generated-${id}-idle`, liveId)
        const generated = await inspect()
        assert.equal(generated.x, moved.x)
        assert.equal(generated.sameScreen, true)
        assert.equal(generated.player.key, `generated-${liveId}-idle`)
        report[mode].generated = generated
        report[mode].beforeMatchGpu = gpuBefore
        report[mode].whileThreeLoaded = { ...await textureFootprint(), gpu: await gpuMemory().catch(() => undefined) }
        await page.screenshot({ path: `${out}/live-generated-practice.png` })
        await key('Enter'); await state('P4')
        await page.screenshot({ path: `${out}/live-generated-battle.png` })
        assert.equal(await scene(s => s.current.view.player.spriteId), `generated-${liveId}`)
        await scene(s => s.appStateMachine.transitionTo('P0_IDLE'))
        await state('P0')
        await page.waitForTimeout(700)
        report[mode].afterHome = { ...await textureFootprint(), gpu: await gpuMemory().catch(() => undefined) }
        assert.equal(report[mode].afterHome.textures, 0)
      } else if (mode !== 'generating') {
        await key('Escape'); await state('P0')
        assert.equal((await textureFootprint()).textures, 0)
      }
      assert.deepEqual(errors, [])
      console.log(`PASS practice ${mode}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await writeFile(`${out}/${live ? 'live-' : offline ? 'offline-' : profile ? 'profile-' : ''}texture-report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
