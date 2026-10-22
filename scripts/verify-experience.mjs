// 正式入口實測：P0 精簡＋開頭動畫、CUSTOMIZE BODY 01 webcam、實驗室影片視差。先啟動 Vite（預設 http://127.0.0.1:5189）。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const out = 'outputs/experience-verification', report = { checks: [], errors: [] }
await mkdir(out, { recursive: true })
const check = message => { report.checks.push(message); console.log('PASS ' + message) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const browsers = []

async function open(args = [], permissions = [], setup) {
  const browser = await chromium.launch({ headless: true, executablePath, args }); browsers.push(browser)
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('http://localhost:8000/**', route => route.abort())
  await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  await setup?.(page)
  await page.goto(base)
  await page.waitForFunction(() => window.__game?.scene.isActive('AppScene'))
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const key = async name => { await page.keyboard.press(name); await s(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
  const state = () => s(s => s.appStateMachine.getCurrentState())
  const waitState = (prefix, timeout = 8000) => page.waitForFunction(prefix => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(prefix) && s.screen?.alpha >= .99 }, prefix, { timeout })
  return { page, s, key, state, waitState }
}

try {
  // P0 與開頭動畫。
  const { page, s, key, state, waitState } = await open(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ['camera'])
  await waitState('P0')
  const p0 = await s(s => s.screen.list.filter(o => o.type === 'Text').map(t => t.text).concat(s.screen.list.filter(o => o.label?.text).map(o => o.label.text)))
  assert.ok(p0.some(t => /P 播放開頭動畫/.test(t))); assert.ok(!p0.some(t => /RANK|MAX COMBO|FUTURE GAMER/.test(t)), p0.join('|'))
  assert.equal(await s(s => s.buttons.size), 2)
  await page.screenshot({ path: `${out}/01-p0.png` })
  check('P0 只有背景、START、BOARD 與提示，沒有排行卡片')
  await key('p')
  await page.waitForFunction(() => { const v = window.__game.scene.getScene('AppScene').attract?.node; return v && v.currentTime > 0.3 }, null, { timeout: 8000 })
  await page.screenshot({ path: `${out}/02-attract.png` })
  await key('Enter'); assert.match(await state(), /^P0/)
  await key('k'); assert.equal(await s(s => s.attract), undefined)
  check('P 播放開頭動畫；播放中 Enter 不穿透；K 回主畫面')
  await s(s => { s.lastActivity -= 31000 }); await key('Shift')
  assert.ok(await s(s => Boolean(s.attract)))
  await s(s => s.attract.node.dispatchEvent(new Event('ended'))); assert.equal(await s(s => s.attract), undefined)
  assert.ok(await s(s => s.time.now - s.lastActivity < 1000))
  check('閒置 30 秒自動播放；播完回 P0 並重設閒置計時')

  // P1：CUSTOM01 預設角色與 BODY 01 身形。
  await key('Enter'); await waitState('P1')
  const preset = await s(s => { s.p1Model.focus('P1', 9); s.p1View.sync(); const f = s.p1View.heroes.P1.figure; return [s.p1Model.slot(9).entry.displayName, f.texture.key, f.anims.isPlaying, s.p1Model.slot(1).entry.spriteId] })
  assert.deepEqual(preset, ['CUSTOM01', 'body01-idle', true, 'body01'])
  await page.screenshot({ path: `${out}/03-p1-custom01.png` })
  check('Slot 09 為 CUSTOM01（body01 sprite 播放 idle）；BODY 01 身形改用 body01')

  // Webcam：BODY 01 → 預覽 → 拍照 → Review → Mock Processing → 進戰鬥。
  await s(s => { s.p1Model.focus('P1', 1); s.p1View.sync() })
  await key('j'); await waitState('P1')
  assert.equal(await s(s => s.p1Model.phase), 'CUSTOMIZE')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1View?.media?.node?.videoWidth > 0, null, { timeout: 8000 })
  await page.keyboard.type('Tester'); await page.keyboard.press('Enter')
  await page.screenshot({ path: `${out}/04-webcam-capture.png` })
  await key('j'); await waitState('P1')
  const review = await s(s => [s.p1Model.phase, s.p1Model.player('P1').photo?.slice(0, 15), s.p1View.media?.node?.tagName, JSON.stringify(s.p1Model.result()).includes('data:')])
  assert.deepEqual(review, ['REVIEW', 'data:image/jpeg', 'IMG', false])
  await page.screenshot({ path: `${out}/05-webcam-review.png` })
  check('Webcam 即時預覽 → 拍照得到 JPEG → Review 顯示照片；照片不進選角結果')
  await key('k'); await waitState('P1')
  assert.equal(await s(s => s.p1Model.phase), 'CUSTOMIZE')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').p1View?.media?.node?.videoWidth > 0)
  await page.keyboard.press('Enter'); await key('j'); await waitState('P1'); await key('j')
  assert.equal(await s(s => s.p1Model.phase), 'PROCESSING')
  assert.equal(await s(s => s.p1View.media), undefined, '離開 Capture 後 webcam 已釋放')
  check('Retake 重新開啟相機；Confirm 進 Mock Processing，相機 track 已停止')
  await waitState('P2', 10000)
  await key('Enter'); await key('Enter'); await waitState('P3')
  assert.equal(await s(s => s.playerSpriteId()), 'body01')
  await key('Enter'); await waitState('P4')
  assert.match(await s(s => s.battlePlayer.image.texture.key), /^body01-/)
  check('客製角色未串 ComfyUI，直接以 body01 進入戰鬥')

  // 實驗室影片＋視差＋鏡頭。
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').stage?.video?.isPlaying(), null, { timeout: 8000 })
  const before = await s(s => ({ bg: s.stage.background.x, fg: s.stage.foreground.x, timer: [s.battleTimer.x, s.battleTimer.y] }))
  await page.screenshot({ path: `${out}/06-battle-lab.png` })
  await s(s => { s.match.world.fighters.PLAYER.x = s.match.world.getConfig().wallMargin }); await wait(3500) // 後退現在是防禦，直接把玩家放到左邊界
  const after = await s(s => {
    const edges = o => [o.x - o.displayWidth / 2, o.x + o.displayWidth / 2], screen = a => s.battleWorld.x + a.x * s.battleWorld.scaleX
    return { scroll: s.stageScroll, bg: s.stage.background.x, fg: s.stage.foreground.x, bgEdges: edges(s.stage.background), fgEdges: edges(s.stage.foreground), actors: [screen(s.battlePlayer), screen(s.battleEnemy)], timer: [s.battleTimer.x, s.battleTimer.y] }
  })
  assert.ok(after.scroll < -300 && after.scroll >= -534, `scroll ${after.scroll}`)
  const fgShift = after.fg - before.fg, bgShift = after.bg - before.bg
  assert.ok(fgShift > bgShift && bgShift > 400, `fg ${fgShift} bg ${bgShift}`) // 背景用滿約 480 行程
  assert.ok(after.bgEdges[0] <= 0 && after.bgEdges[1] >= 1920 && after.fgEdges[0] <= 0 && after.fgEdges[1] >= 1920)
  assert.ok(after.actors.every(x => x > 0 && x < 1920)); assert.deepEqual(after.timer, before.timer)
  await page.screenshot({ path: `${out}/07-battle-parallax.png` })
  check(`玩家在左邊界：鏡頭 ${after.scroll.toFixed(0)}px，前景位移 ${fgShift.toFixed(0)} > 背景 ${bgShift.toFixed(0)}（視差），無露邊、雙角色可見、HUD 固定`)
  await key('Escape'); assert.equal(await s(s => s.stage.video.isPaused()), true)
  await key('Escape'); await page.waitForFunction(() => window.__game.scene.getScene('AppScene').stage.video.isPlaying())
  check('暫停選單同步暫停／恢復背景影片')
  await s(s => s.appStateMachine.transitionTo('P0_IDLE')); await waitState('P0')
  assert.equal(await s(s => s.stage), undefined)
  check('離開戰鬥釋放影片圖層')
  await s(s => { s.selectedStageId = 'company-building'; ['P1_READY', 'P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach(state => s.appStateMachine.transitionTo(state)) }); await waitState('P4')
  const company = await s(s => { const b = s.stage.background; return [b.texture.key, b.scaleX === b.scaleY, b.displayWidth >= 2000 && b.displayHeight >= 1080, s.stage.video] })
  assert.deepEqual(company, ['stage-company-building', true, true, undefined])
  await page.screenshot({ path: `${out}/10-battle-company.png` })
  check('Company Building 等比 cover（無非等比拉伸、無影片層）')

  // 相機不可用、影片失敗。
  const fallback = await open([], [], page => page.route('**/stages/laboratory/bg.mp4', route => route.abort()))
  await fallback.key('Enter'); await fallback.waitState('P1')
  await fallback.s(s => { s.p1Model.focus('P1', 1); s.p1View.sync() }); await fallback.key('j'); await fallback.waitState('P1')
  await fallback.page.waitForFunction(() => window.__game.scene.getScene('AppScene').screen.list.some(o => o.text?.includes?.('CAMERA UNAVAILABLE')), null, { timeout: 8000 })
  await fallback.page.keyboard.type('Mock'); await fallback.page.keyboard.press('Enter'); await fallback.key('j'); await fallback.waitState('P1')
  assert.deepEqual(await fallback.s(s => [s.p1Model.phase, s.p1Model.player('P1').photo, s.p1View.media]), ['REVIEW', undefined, undefined])
  await fallback.page.screenshot({ path: `${out}/08-camera-unavailable.png` })
  check('沒有相機：顯示 CAMERA UNAVAILABLE，仍以模擬照片完成 Review')
  await fallback.s(s => ['P1_READY', 'P2_SETUP', 'P3_LOADING', 'P4_BATTLE'].forEach(state => s.appStateMachine.getCurrentState() !== state && s.appStateMachine.transitionTo(state)))
  await fallback.waitState('P4'); await wait(1500)
  assert.deepEqual(await fallback.s(s => [s.stage.background.texture.key, s.stage.video.visible]), ['lab-poster', false])
  await fallback.page.screenshot({ path: `${out}/09-video-fallback.png` })
  check('實驗室影片讀取失敗時以 poster 覆蓋，戰鬥繼續')
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  for (const browser of browsers) await browser.close()
}
