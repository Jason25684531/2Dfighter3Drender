// Run against Vite: PLAYWRIGHT_MODULE may point to an existing Playwright install.
// Uses a disposable database and real backend; never touches the exhibit database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.P1_URL ?? 'http://127.0.0.1:5189/'
const out = 'outputs/p1-verification', port = 18769, api = `http://127.0.0.1:${port}`
await mkdir(out, { recursive: true })
const report = { checks: [], errors: [], performance: null }
const server = spawn('venv/Scripts/python.exe', ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(port)], { windowsHide: true, stdio: 'ignore', env: { ...process.env, EXP2_DB_PATH: resolve(`${out}/test-${Date.now()}.sqlite`), EXP2_CORS_ORIGINS: new URL(base).origin } })
let browser, page
try {
 for (let i = 0; i < 50; i++) { try { if ((await fetch(`${api}/api/v1/health`)).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
 assert((await fetch(`${api}/api/v1/health`)).ok)
 browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
 page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] })
 page.setDefaultTimeout(30000)
 page.on('pageerror', error => report.errors.push(error.message))
 await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
 await page.route('http://localhost:8765/**', async route => { const response = await route.fetch({ url: route.request().url().replace('http://localhost:8765', api) }); await route.fulfill({ response }) })
 let roster = []
 const cors = { 'access-control-allow-origin': '*' }
 await page.route('**/api/v1/generation/assets', route => route.fulfill({ headers: cors, json: roster }))
 await page.route('**/api/v1/generation/assets/ui-*/thumb.png', async route => {
   const response = await route.fetch({ url: new URL('/test-assets/ui/select/body-card-1.png', base).href })
   await route.fulfill({ response, headers: { ...response.headers(), ...cors } })
 })
 const scene = async (fn, arg) => page.evaluate(({ code, arg }) => { const s = window.__game.scene.getScene('AppScene'); return new Function('s', 'arg', `return (${code})(s, arg)`)(s, arg) }, { code: fn.toString(), arg })
 const waitState = state => page.waitForFunction(state => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(state) && s.screen?.alpha >= .99 }, state)
 const waitPhase = phase => page.waitForFunction(phase => window.__game.scene.getScene('AppScene').p1Model?.phase === phase, phase)
 const review = async id => {
   await page.waitForFunction(id => window.__game.scene.getScene('AppScene').ui.focus.current() === id, id)
   await key('Enter')
 }
 const key = async name => { await page.keyboard.down(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))); await page.keyboard.up(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
 const check = text => { report.checks.push(text); console.log('PASS ' + text) }
 const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }) }
 const settle = () => scene(async s => { await s.persistence.sessionPromise; await s.persistence.chain })
 const start = async () => { await key('Enter'); await waitState('P1'); await settle(); await waitPhase('GRID') }
 const home = async () => {
   if (await scene(s => s.appStateMachine.getCurrentState() === 'P2_SETUP')) { await key('Enter'); await waitState('P3') }
   await key('Escape'); await waitState('P0'); await settle()
 }
 const namePlayer = async (owner, name) => {
   await waitPhase('NAME'); assert.equal(await scene(s => s.p1Model.owner), owner)
   await page.locator('input').fill(name); await page.keyboard.press('Enter')
   await waitPhase('CUSTOMIZE')
 }
 const skipPhoto = async owner => {
   await key(owner === 'P1' ? 'g' : 'Numpad4')
   await page.waitForFunction(owner => { const s = window.__game.scene.getScene('AppScene'); return s.p1Model.isReady(owner) }, owner)
 }
 await page.goto(base); await page.waitForFunction(() => window.__game?.scene.getScene('AppScene')?.persistence.lastLeaderboardOk === true)
 await start(); await shot('grid-1920')
 assert.deepEqual(await scene(s => s.p1View.slotViews.slice(0, 4).map(slot => slot.list.find(item => item.texture?.key.startsWith('body-card-'))?.texture.key)),
   ['body-card-1', 'body-card-2', 'body-card-3', 'body-card-4'])
 assert.match(await scene(s => s.p1View.keysP1.text), /確認/)
 assert.match(await scene(s => s.p1View.keysP2.text), /加入/)
 assert(await scene(s => s.p1View.heroes.P2.silhouette.visible && !s.p1View.cursors.P2.visible))
 await scene(s => {
   const slot=s.p1Model.slot(7), view=s.p1View.slotViews[6]
   for(const status of ['PROCESSING','READY','FAILED','AVAILABLE']) {
     slot.status=status; s.p1View.sync()
     if(view.scan.visible!==(status==='PROCESSING') || view.statusLabel.text!==({PROCESSING:'…',READY:'NEW',FAILED:'!',AVAILABLE:''}[status])) throw new Error('Slot status view mismatch: '+status)
   }
   const hero=s.p1View.heroes.P1
   s.p1Model.focus('P1',1); s.p1View.sync(); s.p1Model.focus('P1',5); s.p1View.sync()
   if(s.p1View.heroes.P1!==hero || !/^(hd-)?go-idle$/.test(hero.figure?.texture.key) || hero.figure.alpha!==1) throw new Error('Hero source was not replaced in place')
 })
 check('Slot status visuals and replacing the hero preview without rebuilding its layout')
 await scene(s => { s.__screen = s.screen; s.__hero = s.p1View.heroes.P1 })
 await key('ArrowDown'); assert.equal(await scene(s => s.p1Model.player('P2').joined), false)
 await key('Numpad1'); await shot('grid-joined')
 assert(await scene(s => !s.p1View.heroes.P2.silhouette.visible && s.p1View.cursors.P2.visible))
 await key('d'); await key('ArrowDown')
 assert.deepEqual(await scene(s => [s.p1Model.player('P1').cursor, s.p1Model.player('P2').cursor]), [6, 16])
 await key('Numpad1'); assert.equal(await scene(s => s.p1Model.player('P2').locked), undefined)
 await key('Backspace'); assert.equal(await scene(s => s.p1Model.player('P2').joined), false)
 assert(await scene(s => s.screen === s.__screen && s.p1View.heroes.P1 === s.__hero))
 check('Join/leave, independent owners, EMPTY rejection, persistent grid and heroes')
 // 單人：鎖定後在同頁選對手（OPPONENT）→ 難度（DIFFICULTY）→ ALL READY；返回逐層退回。
 await key('f'); await waitPhase('OPPONENT'); await key('f'); await waitPhase('DIFFICULTY'); await key('f'); await waitPhase('ALL_READY')
 await key('k'); await waitPhase('DIFFICULTY'); await key('k'); await waitPhase('OPPONENT'); await key('k'); await waitPhase('GRID')
 await key('f'); await key('f'); await key('f'); await waitState('P2'); check('CASE A：選角→對手→難度同頁完成，ALL READY 可逐層取消')
 await home(); await start(); await key('a'); await key('f'); await namePlayer('P1', 'WASDJK Kevin')
 assert.equal(await scene(s => s.p1Model.player('P1').cursor), 4)
 await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
 await key('f'); await waitPhase('REVIEW'); await key('k'); await waitPhase('CUSTOMIZE')
 await key('k'); await waitPhase('NAME')
 assert.equal(await page.locator('input').inputValue(), 'WASDJK Kevin')
 await namePlayer('P1', 'Kevin'); await skipPhoto('P1')
 await waitPhase('OPPONENT'); await key('f'); await key('f'); await waitState('P2'); check('CASE B, typing isolation and RETAKE retains name')
 for (const custom of ['P1', 'P2']) {
   await home(); await start(); await key('Numpad1')
   if (custom === 'P1') await key('a'); else { await key('ArrowLeft'); await key('ArrowLeft') }
   await key('f'); await key('Numpad1'); await namePlayer(custom, custom === 'P1' ? 'Kevin' : 'Rival'); await skipPhoto(custom); await waitState('P2')
   assert.equal(await scene(s => Object.keys(s.flow.players).length), 2)
   check(custom === 'P1' ? 'CASE C' : 'CASE D')
 }
 await home(); await start(); await key('Numpad1'); await key('a'); await key('ArrowLeft'); await key('ArrowLeft'); await key('f'); await key('Numpad1')
 await namePlayer('P1', 'Kevin'); await skipPhoto('P1'); await waitPhase('NAME')
 await page.keyboard.press('Escape'); await key('Backspace'); await waitPhase('GRID')
 assert(await scene(s => s.p1Model.isReady('P1') && !s.p1Model.isReady('P2')))
 await key('Numpad1'); await namePlayer('P2', 'Rival'); await skipPhoto('P2'); await waitState('P2'); check('CASE E with second-owner Back preserving first READY')
 await scene(s => { s.__screen = s.screen; s.__cards = [...s.buttons.values()] })
 await page.mouse.click(1370, 520); await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').selectedStageId==='company-building'); assert(await scene(s => s.screen === s.__screen && s.__cards.every(c => c.active)))
 assert.equal(await scene(s => s.selectedStageId), 'company-building'); check('P2 selection updates existing objects and backdrop')
 const ready = () => page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.ready === true)
 await key('Enter'); await waitState('P3'); await ready(); await shot('p3-2p')
 assert.deepEqual(await scene(s => [s.playerName(), s.enemyName(), s.enemySpriteId()]), ['Kevin', 'Rival', 's3ww'])
 await key('Enter'); await waitState('P4'); await settle()
 assert(await scene(s => !s.current.view.hud.list.some(item => item.texture?.key.startsWith('head-'))))
 await key('Escape'); assert(await scene(s => s.clock.isPaused())); const tick = await scene(s => s.clock.getTick())
 await page.waitForTimeout(250); assert.equal(await scene(s => s.clock.getTick()), tick)
 await shot('pause'); await key('Escape'); assert.equal(await scene(s => s.clock.isPaused()), false)
 // Advance the real simulation clock to finish rounds; no result injection or combat edits.
 const finish = async () => { await scene(s => { for (let i = 0; i < 1600 && s.appStateMachine.getCurrentState() === 'P4_BATTLE'; i++) s.clock.advance(250) }); await waitState('P5'); await settle() }
 await finish(); await shot('p5'); await review('presentation-next'); await waitState('P6'); await shot('p6')
 assert.equal(await scene(s => s.persistence.context.snapshot.persistence), 'SAVED')
 await review('result-next'); await waitState('P7'); await shot('p7'); await key('Enter'); await waitState('P1')
 assert.deepEqual(await scene(s => [s.p1Model.player('P1').nickname, s.p1Model.player('P2').nickname]), ['Kevin', 'Rival'])
 await key('f'); await key('Numpad1')
 await namePlayer('P1', 'Kevin'); await skipPhoto('P1')
 await namePlayer('P2', 'Rival'); await skipPhoto('P2'); await waitState('P2')
 await key('Enter'); await waitState('P3'); await ready(); await key('Enter'); await waitState('P4'); await settle(); await finish()
 await review('presentation-next'); await waitState('P6'); await review('result-next'); await waitState('P7'); await key('ArrowDown'); await key('Enter'); await waitState('P0'); await settle()
 check('P3/P4 2P appearance and names, real P4–P7, pause, Replay and Finish')
 await start(); await key('Numpad1'); await key('ArrowLeft'); await shot('same-character')
 await page.mouse.move(1111, 552); await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').p1Model.player('P1').cursor===7)
 await page.mouse.click(1111, 552); await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').p1Model.player('P1').locked===7)
 check('Pointer hover and click belong to P1')
 for (const [width, height] of [[1366, 768], [844, 390], [390, 844]]) {
   await page.setViewportSize({ width, height }); await shot(`fit-${width}`)
   const bounds = await page.locator('canvas').boundingBox(); assert(bounds.width <= width + 1 && bounds.height <= height + 1)
 }
 check('1366×768 and mobile FIT bounds (mobile redesign remains out of scope)')
 await page.setViewportSize({width:1920,height:1080})
 report.performance = await scene(s => new Promise(resolve => {
   const durations = [], start = performance.now(); let previous = start
   const sample = () => { const now = performance.now(); durations.push(now - previous); previous = now; if (now - start >= 3000) { s.events.off('postupdate', sample); durations.sort((a,b)=>a-b); const gl = s.game.renderer.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info'); resolve({frames:durations.length,elapsedMs:now-start,medianMs:durations[Math.floor(durations.length/2)],p95Ms:durations[Math.floor(durations.length*.95)],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):s.game.renderer.type}) } }
   s.events.on('postupdate',sample)
 }))
 check('Measured two-hero frame times; headless observation, not kiosk acceptance')
 await home(); await start(); await scene(s => { s.lastActivity = s.time.now - 51000 }); await scene(s => new Promise(r=>s.events.once('postupdate',r)))
 assert.match(await scene(s => s.idleLabel.text), /倒數/); await scene(s => { s.lastActivity = s.time.now - 61000 }); await waitState('P0'); await settle()
 await start(); await key('a'); await key('f'); await waitPhase('NAME'); await page.keyboard.press('Escape'); await key('Escape')
 assert(await scene(s => s.p1View.exitOpen)); await key('Escape'); assert.equal(await scene(s => s.p1View.exitOpen), false)
 await key('Escape'); await key('ArrowRight'); await key('Enter'); await waitPhase('GRID')
 await key('f'); await waitPhase('NAME'); await scene(s => { s.lastActivity = s.time.now - 91000 }); await waitPhase('GRID')
 assert.equal(await page.locator('input').count(),0); check('Idle countdown, 60s/90s timeouts, Esc confirmation and DOM cleanup')
 // Generation failure and navigation lock are covered by verify-render-lock-pages.mjs.
 await key('f'); await namePlayer('P1', 'Kevin'); await skipPhoto('P1')
 await key('f'); await key('f'); await waitState('P2')
 await key('Enter'); await waitState('P3'); await ready()
 await page.evaluate(()=>{ window.__pads=[{connected:true,buttons:[{pressed:false},{pressed:false},{pressed:true}],axes:[]}]; navigator.getGamepads=()=>window.__pads })
 await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').current?.promptDevice==='gamepad')
 await page.evaluate(()=>{window.__pads=[]}); await key('Enter'); await waitState('P4'); await settle(); await finish(); await review('presentation-next'); await waitState('P6'); await review('result-next'); await waitState('P7')
 await scene(s=>{s.lastActivity=s.time.now-61000}); await settle(); assert.match(await scene(s=>s.appStateMachine.getCurrentState()), /^P7/)
 check('Existing gamepad prompt switches in P3; P7 has no idle timeout')
 await page.emulateMedia({reducedMotion:'reduce'}); await page.reload(); await page.waitForFunction(()=>window.__game?.scene.getScene('AppScene')?.screen)
 await start(); await key('Numpad1'); await scene(s=>new Promise(r=>s.events.once('postupdate',r)))
 assert.equal(await scene(s=>s.tweens.getTweens().filter(t=>t.isPlaying()).length),0)
 await shot('reduced-motion'); check('Reduced motion leaves no running P1 animation tweens')
 await home()
 roster = Array.from({ length: 11 }, (_, i) => ({ id: `ui-${i + 1}`, displayName: `Guest ${i + 1}`, actions: { '02_Idle': { filename: '02_custom_idle.png', frames: 8, cellSize: 1024 } } }))
 await scene(s => s.jobs.refreshEntries())
 await start()
 assert(await scene(s => s.screen.list.some(panel => panel.list?.some(text => text.text?.includes('11 / 20')))))
 await page.waitForFunction(() => window.__game.textures.exists('head-generated-ui-11'))
 await shot('grid-roster')
 check('Roster displays its actual 11 / 20 count and the same stage background')
 let releaseDelete
 const deletePending = new Promise(resolve => { releaseDelete = resolve })
 await page.route('**/api/v1/generation/assets/ui-11', async route => {
   await deletePending
   await route.fulfill({ status: 204, headers: cors })
 })
 await scene(s => { s.deleteProbe = s.deleteCharacter(s.p1Model.slots.find(slot => slot.entry?.generationId === 'ui-11').index) })
 await home()
 releaseDelete()
 await scene(s => s.deleteProbe)
 assert.equal(await scene(s => s.p1Model), undefined)
 assert.match(await scene(s => s.appStateMachine.getCurrentState()), /^P0/)
 check('Deleting a roster asset and leaving P1 does not redraw the selection screen')
 await home()
 await page.unroute('http://localhost:8765/**'); await page.route('http://localhost:8765/**',route=>route.abort())
 await page.reload(); await page.waitForFunction(()=>window.__game?.scene.getScene('AppScene')?.persistence.lastLeaderboardOk===false)
 await key('Enter'); await waitState('P1'); await shot('offline')
 await key('f'); await key('f'); await key('f'); await waitState('P2'); check('Offline indicator and nonblocking progression')
 assert.deepEqual(report.errors, [])
} catch (error) {
 report.failure = error.message
 if (page) { await page.screenshot({path:`${out}/failure.png`}).catch(()=>{}); report.state = await page.evaluate(()=>{const s=window.__game?.scene.getScene('AppScene');return {state:s?.appStateMachine.getCurrentState(),phase:s?.p1Model?.phase,owner:s?.p1Model?.owner,exit:s?.p1View?.exitOpen,active:document.activeElement?.tagName}}).catch(()=>null) }
 throw error
} finally {
 await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); server.kill()
}
