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
 browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
 page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
 page.setDefaultTimeout(30000)
 page.on('pageerror', error => report.errors.push(error.message))
 await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
 await page.route('http://localhost:8000/**', async route => { const response = await route.fetch({ url: route.request().url().replace('http://localhost:8000', api) }); await route.fulfill({ response }) })
 const scene = async (fn, arg) => page.evaluate(({ code, arg }) => { const s = window.__game.scene.getScene('AppScene'); return new Function('s', 'arg', `return (${code})(s, arg)`)(s, arg) }, { code: fn.toString(), arg })
 const waitState = state => page.waitForFunction(state => { const s = window.__game.scene.getScene('AppScene'); return s.appStateMachine.getCurrentState().startsWith(state) && s.screen?.alpha >= .99 }, state)
 const waitPhase = phase => page.waitForFunction(phase => window.__game.scene.getScene('AppScene').p1Model?.phase === phase, phase)
 const key = async name => { await page.keyboard.down(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))); await page.keyboard.up(name); await scene(s => new Promise(resolve => s.events.once('postupdate', resolve))) }
 const check = text => { report.checks.push(text); console.log('PASS ' + text) }
 const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }) }
 const settle = () => scene(async s => { await s.persistence.sessionPromise; await s.persistence.chain })
 const start = async () => { await key('Enter'); await waitState('P1'); await settle(); await waitPhase('GRID') }
 const home = async () => { await scene(s => { if (s.appStateMachine.getCurrentState() === 'P2_SETUP') s.ui.navigation.dispatch('BACK'); s.ui.navigation.dispatch('BACK') }); await settle(); await waitState('P0') }
 const capture = async (owner, name) => {
   await waitPhase('CUSTOMIZE'); assert.equal(await scene(s => s.p1Model.owner), owner)
   await page.locator('input').fill(name); await page.keyboard.press('Enter')
   await key(owner === 'P1' ? 'j' : 'Enter'); await waitPhase('REVIEW')
   await key(owner === 'P1' ? 'j' : 'Enter')
   await page.waitForFunction(owner => { const s = window.__game.scene.getScene('AppScene'); return s.p1Model.isReady(owner) }, owner)
 }
 await page.goto(base); await page.waitForFunction(() => window.__game?.scene.getScene('AppScene')?.persistence.lastLeaderboardOk === true)
 await start(); await shot('grid-1920')
 await scene(s => {
   const slot=s.p1Model.slot(7), view=s.p1View.slotViews[6]
   for(const status of ['PROCESSING','READY','FAILED','AVAILABLE']) {
     slot.status=status; s.p1View.sync()
     if(view.scan.visible!==(status==='PROCESSING') || view.statusLabel.text!==({PROCESSING:'…',READY:'NEW',FAILED:'!',AVAILABLE:''}[status])) throw new Error('Slot status view mismatch: '+status)
   }
   const body=s.p1Model.slot(1), original=body.entry, hero=s.p1View.heroes.P1
   s.p1Model.focus('P1',1); s.p1View.sync(); body.entry={...original,heroTextureKey:'kael-idle-1'}; s.p1View.sync()
   if(s.p1View.heroes.P1!==hero || hero.figure.texture.key!=='kael-idle-1' || hero.figure.alpha!==1) throw new Error('Hero source was not replaced in place')
   body.entry=original; s.p1Model.focus('P1',5); s.p1View.sync()
 })
 check('Slot status visuals and replacing a Body hero source without rebuilding its layout')
 await scene(s => { s.__screen = s.screen; s.__hero = s.p1View.heroes.P1 })
 await key('ArrowDown'); assert.equal(await scene(s => s.p1Model.player('P2').joined), false)
 await key('Enter'); await key('d'); await key('ArrowDown')
 assert.deepEqual(await scene(s => [s.p1Model.player('P1').cursor, s.p1Model.player('P2').cursor]), [6, 16])
 await key('Enter'); assert.equal(await scene(s => s.p1Model.player('P2').locked), undefined)
 await key('Backspace'); assert.equal(await scene(s => s.p1Model.player('P2').joined), false)
 assert(await scene(s => s.screen === s.__screen && s.p1View.heroes.P1 === s.__hero))
 check('Join/leave, independent owners, EMPTY rejection, persistent grid and heroes')
 await key('j'); await waitPhase('ALL_READY'); await key('k'); await waitPhase('GRID')
 await key('j'); await waitState('P2'); check('CASE A and ALL READY cancellation')
 await home(); await start(); await key('a'); await key('j'); await waitPhase('CUSTOMIZE')
 await page.locator('input').fill('WASDJK Kevin'); await page.keyboard.press('Enter')
 assert.equal(await scene(s => s.p1Model.player('P1').cursor), 4)
 await key('j'); await waitPhase('REVIEW'); await key('k'); await waitPhase('CUSTOMIZE')
 assert.equal(await page.locator('input').inputValue(), 'WASDJK Kevin')
 await capture('P1', 'Kevin'); await waitState('P2'); check('CASE B, typing isolation and RETAKE retains name')
 for (const custom of ['P1', 'P2']) {
   await home(); await start(); await key('Enter')
   if (custom === 'P1') await key('a'); else { await key('ArrowLeft'); await key('ArrowLeft') }
   await key('j'); await key('Enter'); await capture(custom, custom === 'P1' ? 'Kevin' : 'CPU Kevin'); await waitState('P2')
   assert.equal(await scene(s => Object.keys(s.players).length), 2)
   check(custom === 'P1' ? 'CASE C' : 'CASE D')
 }
 await home(); await start(); await key('Enter'); await key('a'); await key('ArrowLeft'); await key('ArrowLeft'); await key('j'); await key('Enter')
 await capture('P1', 'Kevin'); await waitPhase('CUSTOMIZE'); await page.locator('input').focus(); await page.keyboard.press('Escape'); await key('Backspace'); await waitPhase('GRID')
 assert(await scene(s => s.p1Model.isReady('P1') && !s.p1Model.isReady('P2')))
 await key('Enter'); await capture('P2', 'Rival'); await waitState('P2'); check('CASE E with second-owner Back preserving first READY')
 await scene(s => { s.__screen = s.screen; s.__cards = [...s.buttons.values()] })
 await page.mouse.click(1370, 520); await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').selectedStageId==='company-building'); assert(await scene(s => s.screen === s.__screen && s.__cards.every(c => c.active)))
 assert.equal(await scene(s => s.selectedStageId), 'company-building'); check('P2 selection updates existing objects and backdrop')
 await key('Enter'); await waitState('P3'); await shot('p3-cpu')
 assert.deepEqual(await scene(s => [s.playerName(), s.enemyName(), s.enemySpriteId()]), ['Kevin', 'Rival', 'aria'])
 await key('Enter'); await waitState('P4'); await settle()
 await key('Escape'); assert(await scene(s => s.clock.isPaused())); const tick = await scene(s => s.clock.getTick())
 await page.waitForTimeout(250); assert.equal(await scene(s => s.clock.getTick()), tick)
 await shot('pause'); await key('Escape'); assert.equal(await scene(s => s.clock.isPaused()), false)
 // Advance the real simulation clock to finish rounds; no result injection or combat edits.
 const finish = async () => { await scene(s => { for (let i = 0; i < 1600 && s.appStateMachine.getCurrentState() === 'P4_BATTLE'; i++) s.clock.advance(250) }); await waitState('P5'); await settle() }
 await finish(); await shot('p5'); await key('Enter'); await waitState('P6'); await shot('p6')
 assert.equal(await scene(s => s.persistence.context.snapshot.persistence), 'SAVED')
 await key('Enter'); await waitState('P7'); await shot('p7'); await key('Enter'); await waitState('P2')
 await key('Enter'); await key('Enter'); await waitState('P3'); await key('Enter'); await waitState('P4'); await settle(); await finish()
 await key('Enter'); await waitState('P6'); await key('Enter'); await waitState('P7'); await key('ArrowDown'); await key('Enter'); await waitState('P0'); await settle()
 check('P3/P4 CPU appearance and names, real P4–P7, pause, Replay and Finish')
 await start(); await key('Enter'); await key('ArrowLeft'); await shot('same-character')
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
 await start(); await key('a'); await key('j'); await waitPhase('CUSTOMIZE'); await page.keyboard.press('Escape'); await key('Escape')
 assert(await scene(s => s.p1View.exitOpen)); await key('Escape'); assert.equal(await scene(s => s.p1View.exitOpen), false)
 await key('Escape'); await key('ArrowRight'); await key('Enter'); await waitPhase('GRID')
 await key('j'); await waitPhase('CUSTOMIZE'); await scene(s => { s.lastActivity = s.time.now - 91000 }); await waitPhase('GRID')
 assert.equal(await page.locator('input').count(),0); check('Idle countdown, 60s/90s timeouts, Esc confirmation and DOM cleanup')
 // Exercise the failure contract without adding a production failure shortcut.
 await key('j'); await captureFailure()
 async function captureFailure() {
   await waitPhase('CUSTOMIZE'); await page.locator('input').fill('Kevin'); await page.keyboard.press('Enter'); await key('j'); await key('j'); await waitPhase('PROCESSING')
   await scene(s => { s.p1Model.setGenerationState('FAILED'); s.syncP1() }); await waitPhase('FAILED'); await shot('failed')
   await key('j'); await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').p1Model.isReady('P1')); await waitState('P2')
 }
 check('FAILED retry completes; leaving a phase cancels its previous timer')
 await key('Enter'); await key('Enter'); await waitState('P3')
 await page.evaluate(()=>{ window.__pads=[{connected:true,buttons:[{pressed:false},{pressed:false},{pressed:true}],axes:[]}]; navigator.getGamepads=()=>window.__pads })
 await page.waitForFunction(()=>window.__game.scene.getScene('AppScene').promptDevice==='gamepad')
 await page.evaluate(()=>{window.__pads=[]}); await key('Enter'); await waitState('P4'); await settle(); await finish(); await key('Enter'); await waitState('P6'); await key('Enter'); await waitState('P7')
 await scene(s=>{s.lastActivity=s.time.now-31000}); await waitState('P0'); await settle()
 check('Existing gamepad prompt switches in P3; P7 30s timeout finishes session')
 await page.emulateMedia({reducedMotion:'reduce'}); await page.reload(); await page.waitForFunction(()=>window.__game?.scene.getScene('AppScene')?.screen)
 await start(); await key('Enter'); await scene(s=>new Promise(r=>s.events.once('postupdate',r)))
 assert.equal(await scene(s=>s.tweens.getTweens().filter(t=>t.isPlaying()).length),0)
 await shot('reduced-motion'); check('Reduced motion leaves no running P1 animation tweens')
 await home()
 await page.unroute('http://localhost:8000/**'); await page.route('http://localhost:8000/**',route=>route.abort())
 await page.reload(); await page.waitForFunction(()=>window.__game?.scene.getScene('AppScene')?.persistence.lastLeaderboardOk===false)
 await key('Enter'); await waitState('P1'); await shot('offline')
 await key('j'); await waitState('P2'); check('Offline indicator and nonblocking progression')
 assert.deepEqual(report.errors, [])
} catch (error) {
 report.failure = error.message
 if (page) { await page.screenshot({path:`${out}/failure.png`}).catch(()=>{}); report.state = await page.evaluate(()=>{const s=window.__game?.scene.getScene('AppScene');return {state:s?.appStateMachine.getCurrentState(),phase:s?.p1Model?.phase,owner:s?.p1Model?.owner,exit:s?.p1View?.exitOpen,active:document.activeElement?.tagName}}).catch(()=>null) }
 throw error
} finally {
 await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); server.kill()
}
