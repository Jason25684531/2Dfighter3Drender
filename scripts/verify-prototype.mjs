// 隔離原型的瀏覽器實測；先啟動 Vite（預設 http://127.0.0.1:5189）。沿用 verify-kevin 的 Playwright／Chrome。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:5189'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const out = 'outputs/prototype-verification', report = { checks: [], errors: [], api: [] }
await mkdir(out, { recursive: true })
const check = message => { report.checks.push(message); console.log('PASS ' + message) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function open(options = {}, setup) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...options })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('request', request => { if (/\/api\//.test(request.url())) report.api.push(request.url()) })
  await setup?.(page)
  await page.goto(`${base}/prototype.html`)
  await page.waitForFunction(() => window.prototypeScene?.view)
  const s = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.prototypeScene, arg), { code: fn.toString(), arg })
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const key = async name => { await page.keyboard.press(name); await frame() }
  const texts = () => s(s => s.children.list.filter(o => o.type === 'Text').map(t => t.text).join('\n'))
  return { context, page, s, key, frame, texts }
}

try {
  const { page, s, key, texts } = await open()
  const player = id => s((s, id) => ({ ...s.model.player(id), ready: s.model.isReady(id) }), id)

  // 雙 Body：1P 鎖 01、2P 鎖 02 → 1P 先拍照，名稱輸入 WASDJK 只當文字。
  await key('Enter'); assert.equal((await player('P2')).joined, true)
  for (let i = 0; i < 4; i++) await key('a')
  await key('j'); assert.equal((await player('P1')).locked, 1)
  assert.equal(await s(s => s.model.phase), 'GRID', '2P 未鎖定前不可搶走控制')
  for (let i = 0; i < 4; i++) await key('ArrowLeft')
  await key('Enter')
  assert.deepEqual(await s(s => [s.model.phase, s.model.owner]), ['CUSTOMIZE', 'P1'])
  await page.keyboard.type('wasdjk'); await key('Enter')
  assert.equal((await player('P1')).nickname, 'wasdjk'); assert.equal((await player('P2')).cursor, 2)
  check('雙 Body 依 1P 優先排隊；名稱輸入 WASDJK 保持文字，未移動游標')
  await page.screenshot({ path: `${out}/01-capture-1p.png` })
  await key('j'); assert.equal(await s(s => s.model.phase), 'REVIEW')
  await key('Enter'); assert.equal(await s(s => s.model.phase), 'REVIEW', '非 owner 不能確認')
  await key('k'); assert.equal(await s(s => s.model.phase), 'CUSTOMIZE'); assert.equal((await player('P1')).nickname, 'wasdjk')
  await key('Enter'); await key('j'); await key('j')
  assert.equal(await s(s => s.model.phase), 'PROCESSING')
  await page.screenshot({ path: `${out}/02-processing-1p.png` })
  await page.waitForFunction(() => window.prototypeScene.model.owner === 'P2', null, { timeout: 6000 })
  assert.equal((await player('P1')).ready, true)
  check('Capture → Review → Retake 保留名稱 → Confirm → Mock Processing → 1P READY，再輪到 2P')
  await page.keyboard.type('Bob'); await key('Enter')
  await key('Backspace'); assert.equal(await s(s => s.view.exitOpen), true)
  await key('ArrowRight'); await key('Enter')
  assert.equal((await player('P2')).locked, undefined); assert.equal((await player('P1')).ready, true)
  check('2P 在 Capture 返回只解鎖 2P，1P 的 READY 保留')
  await key('Enter'); await key('Enter'); await key('Enter'); await key('Enter')
  await page.waitForFunction(() => window.prototypeScene.page === 'P2', null, { timeout: 8000 })
  assert.match(await texts(), /wasdjk/); assert.match(await texts(), /Bob/); assert.match(await texts(), /CPU/)
  check('雙方 Custom 完成後進 P2，左右顯示名稱、BODY 與 CPU 標記')

  // P2：focus ≠ selected、返回解除 1P 鎖定，一般角色不進拍照。
  await key('d')
  assert.deepEqual(await s(s => [s.focusedStage, s.selectedStage]), [1, 0])
  await page.screenshot({ path: `${out}/03-stage-focus.png` })
  await key('j'); assert.deepEqual(await s(s => [s.focusedStage, s.selectedStage]), [1, 1])
  check('P2 focus 與 selected 分離，Confirm 選取')
  await key('k')
  assert.equal(await s(s => s.page), 'P1'); assert.equal((await player('P1')).locked, undefined); assert.equal((await player('P2')).ready, true)
  for (let i = 0; i < 4; i++) await key('d')
  await key('j')
  await page.waitForFunction(() => window.prototypeScene.page === 'P2', null, { timeout: 5000 })
  assert.equal(await s(s => s.model.result().P1.characterId.startsWith('body')), false)
  check('P2 Back 回 P1 只解除 1P；改選一般角色後直接 ALL READY，不進拍照')
  await key('a'); await key('j'); assert.deepEqual(await s(s => [s.focusedStage, s.selectedStage]), [0, 0])
  await key('j'); assert.equal(await s(s => s.page), 'CONTROLS')
  assert.match(await texts(), /Space 跳躍/)
  await page.screenshot({ path: `${out}/04-controls.png` })
  await key('j'); assert.equal(await s(s => s.page), 'BATTLE')

  // 戰鬥：影片、HUD、24Hz、鏡頭與固定 HUD。
  await page.waitForFunction(() => window.prototypeScene.stage?.video?.isPlaying(), null, { timeout: 8000 })
  assert.equal(await s(s => s.stage.video.isMuted?.() ?? s.stage.video.video.muted), true)
  assert.equal(await s(s => s.hud.timer.text), '60')
  check('實驗室影片靜音循環播放，Timer 顯示真實 60 秒')
  await page.screenshot({ path: `${out}/05-battle-start.png` })
  const hp = values => s((s, values) => {
    const snapshot = s.match.getSnapshot(), [PLAYER, ENEMY] = [snapshot.world.fighters.PLAYER, snapshot.world.fighters.ENEMY]
    s.hud.sync({ ...snapshot, world: { ...snapshot.world, fighters: { PLAYER: { ...PLAYER, currentHP: values[0] }, ENEMY: { ...ENEMY, currentHP: values[1] } } } })
    return [s.hud.bars[0].scaleX, s.hud.lag[0].scaleX, s.hud.percentages[0].text]
  }, values)
  await s(s => s.clock.pause())
  await hp([70, 100]); await wait(100)
  const mid = await hp([40, 100])
  assert.equal(mid[0], 0.4); assert.ok(mid[1] > 0.4, '延遲條仍在追趕')
  await wait(750)
  assert.ok(Math.abs((await s(s => s.hud.lag[0].scaleX)) - 0.4) < 1e-6)
  assert.deepEqual(await hp([100, 100]), [1, 1, '100%'])
  await s(s => s.clock.resume())
  check('血條 100→70→40：主條立即、延遲條 600ms 追至 40；回血兩條同步 100')
  const hudBefore = await s(s => [s.hud.x, s.hud.y, s.hud.timer.x, s.hud.timer.y])
  const tick0 = await s(s => s.match.getSnapshot().world.tick)
  await page.keyboard.down('a'); await wait(3500); await page.keyboard.up('a')
  const cam = await s(s => {
    const zoom = s.world.scaleX, screen = a => s.world.x + a.x * zoom
    const edges = o => [o.x - o.displayWidth / 2, o.x + o.displayWidth / 2]
    return { scroll: s.scroll, actors: s.actors.map(screen), bg: edges(s.stage.background), fg: s.stage.foreground ? edges(s.stage.foreground) : null, hud: [s.hud.x, s.hud.y, s.hud.timer.x, s.hud.timer.y], tick: s.match.getSnapshot().world.tick, player: s.match.getSnapshot().world.fighters.PLAYER.position }
  })
  assert.ok(cam.scroll < -20 && cam.scroll >= -534, `scroll ${cam.scroll}`)
  assert.ok(cam.actors.every(x => x > 0 && x < 1920), `actors ${cam.actors}`)
  assert.ok(cam.bg[0] <= 0 && cam.bg[1] >= 1920 && (!cam.fg || (cam.fg[0] <= 0 && cam.fg[1] >= 1920)), 'Stage 不露邊')
  assert.deepEqual(cam.hud, hudBefore)
  const ticks = cam.tick - tick0
  assert.ok(ticks >= 70 && ticks <= 100, `3.5s 約 84 tick，實得 ${ticks}`)
  check(`左邊界鏡頭 scroll=${cam.scroll.toFixed(1)}（±533 內），雙角色可見、背景前景無露邊、HUD 固定、${ticks} tick／3.5s≈24Hz`)
  await page.screenshot({ path: `${out}/06-battle-camera-left.png` })

  await key('Escape')
  const paused = await s(s => [s.paused, s.dialog.open, s.stage.video.isPaused(), s.match.getSnapshot().world.tick])
  await wait(500)
  assert.deepEqual([paused[0], paused[1], paused[2]], [true, true, true])
  assert.equal(await s(s => s.match.getSnapshot().world.tick), paused[3])
  await page.screenshot({ path: `${out}/07-pause.png` })
  await key('j'); assert.equal(await s(s => s.model.player('P1').locked !== undefined && !s.paused), true)
  await wait(300); assert.ok((await s(s => s.match.getSnapshot().world.tick)) > paused[3])
  check('Pause 優先：時鐘、影片停止，J 只恢復不穿透；恢復後繼續計時')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  assert.equal(await s(s => s.paused && s.held.size === 0), true); await key('Escape')
  check('失焦自動暫停並清空 held 按鍵')
  await page.click('#static-stage')
  assert.deepEqual(await s(s => [s.stage.video.visible, s.stage.video.isPaused()]), [false, true])
  await page.click('#static-stage')
  await page.waitForFunction(() => window.prototypeScene.stage.video.isPlaying())
  check('靜態背景切換停／恢復影片')

  for (let i = 0; i < 3; i++) await page.click('#battle')
  await page.focus('body')
  const counts = await s(s => [s.children.list.flatMap(o => o.list ?? [o]).filter(o => o.type === 'Video').length, s.match.getSnapshot().world.tick])
  await wait(1000)
  const perSecond = (await s(s => s.match.getSnapshot().world.tick)) - counts[1]
  assert.equal(counts[0], 1); assert.ok(perSecond >= 18 && perSecond <= 30, `${perSecond} tick/s`)
  check(`重開戰鬥 3 次：僅 1 個 Video、${perSecond} tick/s（無重複訂閱）`)

  // 操作展示：新鍵位只產生語意，不推進 Combat。
  await page.click('#input-demo'); await page.focus('body')
  const frozen = await s(s => s.match.getSnapshot().world.tick)
  const label = i => s((s, i) => s.demoLabels[i].text, i)
  const hold = async (keys, expect) => {
    for (const k of keys) await page.keyboard.down(k)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    const values = [await label(0), await label(1)]
    for (const k of keys.reverse()) await page.keyboard.up(k)
    assert.ok(values.some(v => v.endsWith(expect)), `${keys} → ${values}`)
  }
  await hold(['f'], 'PUNCH_LIGHT'); await hold(['Numpad2'], 'PUNCH_HEAVY'); await hold(['w', 'f'], 'PUNCH_AIR')
  await hold(['s', 'u'], 'PUNCH_CROUCH'); await hold(['w', 'i'], 'KICK_AIR'); await hold(['s', 'g'], 'KICK_CROUCH')
  await hold(['a'], 'BLOCK'); await hold(['ArrowRight'], 'BLOCK'); await hold(['d'], 'MOVE'); await hold(['Numpad5'], 'KICK_HEAVY')
  await page.selectOption('#semantic', 'VICTORY')
  assert.equal(await label(0), 'P1  VICTORY')
  await page.screenshot({ path: `${out}/08-input-demo.png` })
  await page.selectOption('#semantic', '')
  assert.equal(await s(s => s.match.getSnapshot().world.tick), frozen)
  check('操作展示：F/Numpad2/空中/蹲姿/背向 BLOCK 各產生正確語意，Combat tick 不變')
  assert.deepEqual(report.api, []); check('原型全程沒有 /api 請求')
  await page.close()

  // 影片失敗 fallback。
  const failed = await open({}, page => page.route('**/bg.mp4', route => route.abort()))
  await failed.s(s => s.show('BATTLE')); await wait(1500)
  const fallback = await failed.s(s => [s.stage.background.texture.key, s.stage.background.visible, s.stage.video.visible, s.hud.timer.text])
  assert.deepEqual(fallback.slice(0, 3), ['lab-poster', true, false]); assert.match(fallback[3], /^(59|60)$/)
  await failed.page.screenshot({ path: `${out}/09-video-fallback.png` })
  check('mp4 讀取失敗：poster 靜態背景，HUD 正常')
  await failed.context.close()

  // 減少動態。
  const calm = await open({ reducedMotion: 'reduce' })
  await calm.s(s => s.show('BATTLE')); await wait(300)
  await calm.page.keyboard.down('a'); await wait(1500); await calm.page.keyboard.up('a')
  const reduced = await calm.s(s => {
    const snapshot = s.match.getSnapshot()
    s.hud.sync({ ...snapshot, world: { ...snapshot.world, fighters: { ...snapshot.world.fighters, PLAYER: { ...snapshot.world.fighters.PLAYER, currentHP: 40 } } } })
    return [s.reduced, s.scroll, s.stage.video.isPlaying(), s.hud.lag[0].scaleX]
  })
  assert.deepEqual([reduced[0], reduced[2], reduced[3]], [true, false, 0.4]); assert.ok(Math.abs(reduced[1]) <= 533.4) // 減少動態：鏡頭直接到位（無平滑），不停用
  check('Reduced motion：影片停止、鏡頭無平滑直接到位，延遲血條直接更新')
  await calm.context.close()

  // 尺寸。
  for (const [w, h] of [[1920, 1080], [1366, 768], [844, 390], [390, 844]]) {
    const view = await open({ viewport: { width: w, height: h } })
    const box = await view.page.evaluate(() => { const r = document.querySelector('#prototype-app canvas').getBoundingClientRect(); return [r.left, r.right, r.width / r.height, getComputedStyle(document.querySelector('.mobile-note')).display, document.documentElement.scrollWidth] })
    assert.ok(box[0] >= 0 && box[1] <= w + 0.5 && Math.abs(box[2] - 16 / 9) < 0.02 && box[4] <= w, `${w}x${h} ${box}`)
    assert.equal(box[3] !== 'none', w <= 900)
    await view.page.screenshot({ path: `${out}/10-viewport-${w}x${h}.png`, fullPage: true })
    await view.context.close()
  }
  check('1920／1366／844×390／390×844：Canvas 16:9 FIT 不溢出，手機顯示限制提示')

  // 正式入口不載入原型。
  const formal = await browser.newPage()
  formal.on('pageerror', error => report.errors.push(error.message))
  await formal.route('http://localhost:8000/**', route => route.abort())
  const loaded = []; formal.on('request', r => loaded.push(r.url()))
  await formal.goto(`${base}/`); await wait(2500)
  assert.equal(await formal.evaluate(() => 'prototypeScene' in window), false)
  assert.equal(loaded.some(u => /prototype/.test(u)), false)
  await formal.screenshot({ path: `${out}/11-formal-p0.png` })
  check('正式首頁未載入任何原型模組或衍生素材')
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
