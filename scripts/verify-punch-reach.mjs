// 量每位角色站姿輕／重拳「最遠能打中的距離」（兩人中心相距，world），用真實的像素命中判定；對手固定 GO。
// 先啟動 Vite（http://127.0.0.1:5189）。用法：node scripts/verify-punch-reach.mjs [--before]；--before 暫時拿掉客製角色的外推與前衝，對照調整前。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.APP_URL ?? 'http://127.0.0.1:5189/', before = process.argv.includes('--before')
// s2am＝Body 02（跳過拍照），模板 02 生成的玩家共用它的調整值。
const roster = { go: 5, se7en: 6, yg: 8, tony: 9, chris: 10, s1aw: 1, s2am: 2, s3ww: 4, hw: 11, hsi: 12, jf: 13, grace: 14, ak: 15 }
const custom = ['s1aw', 's2am', 's3ww', 'hw', 'hsi', 'jf', 'grace', 'ak']
// --before：還原成調整前的值（Body 02 原本四招都是 40、沒有前衝）。
const original = { s2am: { LIGHT_PUNCH: 40, HEAVY_PUNCH: 40, LIGHT_KICK: 40, HEAVY_KICK: 40 } }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const results = {}
for (const [id, slot] of Object.entries(roster)) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.route('**/api/v1/**', (route) => route.abort())
  await page.route('**/src/main.ts*', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('new Phaser.Game(', 'window.__game = new Phaser.Game(') }) })
  const scene = (fn, arg) => page.evaluate(({ code, arg }) => new Function('s', 'arg', `return (${code})(s,arg)`)(window.__game.scene.getScene('AppScene'), arg), { code: fn.toString(), arg })
  const state = (prefix) => page.waitForFunction((prefix) => { const s = window.__game?.scene.getScene('AppScene'); return s?.appStateMachine.getCurrentState().startsWith(prefix) && s.screen?.alpha >= 0.99 }, prefix, { timeout: 60000 })
  const key = async (name) => { await page.keyboard.press(name); await scene((s) => new Promise((resolve) => s.events.once('postupdate', resolve))) }
  await page.goto(base); await state('P0')
  await key('Enter'); await state('P1')
  await scene((s, slot) => { s.p1Model.focus('P1', slot); s.p1View.sync() }, slot)
  await key('f')
  await scene((s) => { if (s.p1Model.phase !== 'NAME') return; s.p1Model.setNickname('P1', 'REACH'); s.p1Input('P1', 'CONFIRM'); s.p1Model.skipCustomize(); s.syncP1() })
  await scene((s) => { s.p1Model.rival.cursor = s.p1Model.player('P1').locked === 5 ? 6 : 5; s.p1View.sync() }); await key('f'); await key('f'); await state('P2')
  await key('Enter'); await state('P3')
  await page.waitForFunction(() => window.__game.scene.getScene('AppScene').current?.ready, null, { timeout: 60000 })
  results[id] = await scene(async (s, { before, custom, id, original }) => {
    // 熱更新後模組網址帶 ?t=；要改到遊戲正在用的那一份，得 import 同一個網址。
    const loaded = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/src/game/config/hitTuning.ts')).at(-1)
    const { HIT_TUNING } = await import(loaded ?? '/src/game/config/hitTuning.ts')
    if (before && custom.includes(id)) { if (original[id]) HIT_TUNING.reach[id] = original[id]; else delete HIT_TUNING.reach[id]; delete HIT_TUNING.lunge[id] }
    s.clock.stop(); s.current.update = () => s.current.view.renderAt(1)
    s.current.view.syncLunges()
    const world = s.current.practice.world, neutral = { moveX: 0, jumpPressed: false, attackPressed: false }
    const lands = (attack, gap) => {
      world.reset(); world.fighters.PLAYER.x = 800; world.fighters.ENEMY.x = 800 + gap
      for (let i = 0; i < 4; i++) { world.tick(neutral, neutral); s.current.view.update(s.current.practice.getSnapshot(), [], {}, undefined, {}) }
      let hit = false
      const off = world.subscribe((e) => { if (e.type === 'HIT' && e.attacker === 'PLAYER') hit = true })
      for (let i = 0; i < 20 && !hit; i++) { world.tick(i === 0 ? { ...neutral, attack, attackPressed: true } : neutral, neutral); s.current.view.update(s.current.practice.getSnapshot(), [], {}, undefined, {}) }
      off(); return hit
    }
    const reach = (attack) => { let best = 0; for (let gap = 120; gap <= 800; gap += 10) if (lands(attack, gap)) best = gap; return best }
    return { LIGHT_PUNCH: reach('LIGHT_PUNCH'), HEAVY_PUNCH: reach('HEAVY_PUNCH') }
  }, { before, custom, id, original })
  console.log(`${id.padEnd(6)} light ${String(results[id].LIGHT_PUNCH).padStart(4)}  heavy ${String(results[id].HEAVY_PUNCH).padStart(4)}`)
  await page.close()
}
await browser.close()
if (!before) {
  const officers = Math.min(...['se7en', 'chris'].map((id) => results[id].LIGHT_PUNCH))
  for (const id of custom) assert.ok(results[id].LIGHT_PUNCH >= officers * 0.75, `${id} 輕拳距離 ${results[id].LIGHT_PUNCH} 應接近長官（${officers}）`)
  console.log('PASS 客製角色輕拳距離接近長官')
}
