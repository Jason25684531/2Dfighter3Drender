// DEV 手把診斷頁：只在 `npm run dev` 且網址帶 gamepadDebug 時由 main.ts 動態載入，不啟動遊戲。
// 不內建任何廠牌的索引；PLAYER 欄位與遊戲共用 GamepadProfile 的所有權規則。
import { rememberPads, samplePads, updateSlots, type PadDown, type PadSlots } from '../game/input/GamepadProfile'

type PadReport = { index: number; id: string; mapping: string; connected: boolean; owner: 'PLAYER 1' | 'PLAYER 2' | 'UNOWNED'; buttons: { index: number; pressed: boolean; value: number }[]; axes: number[] }

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const root = document.createElement('main')
root.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:24px 32px;background:#0b0f1a;color:#e8eefc;font:14px/1.5 Consolas,"Noto Sans TC",monospace'
root.innerHTML = `<h1 style="margin:0 0 4px;font-size:22px">GAMEPAD DEBUG · 手把診斷</h1>
<p style="margin:0 0 12px;color:#9fb0d0">瀏覽器要等搖桿按下按鈕後才回報裝置。PLAYER 欄位與遊戲同一套規則：未被擁有的手把按下按鈕即取得空位（先 1P 再 2P），斷線釋放。</p>
<button id="copy" style="font:inherit;padding:6px 14px;cursor:pointer">複製 JSON 報告</button> <span id="status" style="margin-left:8px;color:#ffd166"></span>
<textarea id="fallback" readonly hidden style="display:block;width:100%;height:160px;margin-top:8px;background:#000;color:#cfe;font:12px Consolas,monospace"></textarea>
<div id="pads"></div>
<h2 style="font-size:16px;margin:20px 0 4px">連線事件</h2><ol id="events" style="margin:0;padding-left:20px;color:#9fb0d0"></ol>`
document.body.replaceChildren(root)
document.body.style.overflow = 'auto'
const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!

let down: PadDown = new Map(), slots: PadSlots = { P1: undefined, P2: undefined }, reports: PadReport[] = []
const seen = new Map<number, { id: string; mapping: string }>()

const logEvent = (event: Event): void => {
  const { gamepad } = event as GamepadEvent, item = document.createElement('li')
  item.textContent = `${new Date().toLocaleTimeString()} ${event.type === 'gamepadconnected' ? 'CONNECTED' : 'DISCONNECTED'} #${gamepad.index} ${gamepad.id}`
  $('events').prepend(item)
}
window.addEventListener('gamepadconnected', logEvent)
window.addEventListener('gamepaddisconnected', logEvent)

const renderPad = (pad: PadReport): string => {
  const warning = pad.connected && pad.mapping !== 'standard' ? `<p style="color:#ff6b6b">⚠ mapping 為「${escape(pad.mapping || '(空字串)')}」，不是 standard：按鈕與軸的索引可能和預設不同，D-pad 也可能以 hat 軸出現（目前不支援）。請照下方原始數值填對照表。</p>` : ''
  const buttons = pad.buttons.map((b) => `<tr style="background:${b.pressed ? '#1f6f43' : 'transparent'}"><td>B${b.index}</td><td>${b.pressed ? 'PRESSED' : '-'}</td><td>${b.value.toFixed(3)}</td></tr>`).join('')
  const axes = pad.axes.map((value, a) => `<tr style="background:${Math.abs(value) >= 0.5 ? '#1f4f6f' : 'transparent'}"><td>A${a}</td><td>${value.toFixed(3)}</td></tr>`).join('')
  return `<section style="margin-top:16px;padding:12px 16px;border:1px solid #2a3550;opacity:${pad.connected ? 1 : 0.5}">
<h2 style="margin:0;font-size:16px">#${pad.index} · ${pad.connected ? pad.owner : 'DISCONNECTED（已斷線，不屬於任何玩家）'}</h2>
<div>id: ${escape(pad.id)}</div><div>mapping: ${escape(pad.mapping || '(空字串)')}</div>${warning}
<div style="display:flex;gap:32px;align-items:flex-start"><table><tr><th>button</th><th>pressed</th><th>value</th></tr>${buttons}</table><table><tr><th>axis</th><th>value</th></tr>${axes}</table></div></section>`
}

const frame = (): void => {
  const pads = Array.from(navigator.getGamepads?.() ?? [])
  const now = samplePads(pads, down); slots = updateSlots(slots, now, down); down = rememberPads(down, now)
  reports = pads.flatMap((pad, index): PadReport[] => {
    if (!pad || !pad.connected) return []
    seen.set(index, { id: pad.id, mapping: pad.mapping })
    const owner = slots.P1 === index ? 'PLAYER 1' : slots.P2 === index ? 'PLAYER 2' : 'UNOWNED'
    return [{ index, id: pad.id, mapping: pad.mapping, connected: true, owner, buttons: pad.buttons.map((b, i) => ({ index: i, pressed: b.pressed, value: b.value })), axes: [...pad.axes] }]
  })
  const gone = [...seen].filter(([index]) => !reports.some((r) => r.index === index)).map(([index, { id, mapping }]): PadReport => ({ index, id, mapping, connected: false, owner: 'UNOWNED', buttons: [], axes: [] }))
  $('pads').innerHTML = reports.length || gone.length ? [...reports, ...gone].sort((a, b) => a.index - b.index).map(renderPad).join('') : '<p style="margin-top:16px;color:#ffd166">尚未偵測到手把：請按下搖桿任一按鈕。</p>'
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

$('copy').addEventListener('click', () => {
  const json = JSON.stringify({ capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, pads: reports }, null, 2), fallback = $<HTMLTextAreaElement>('fallback')
  fallback.value = json
  navigator.clipboard.writeText(json).then(() => { $('status').textContent = `已複製 ${reports.length} 支手把的報告`; fallback.hidden = true }, () => { $('status').textContent = '無法寫入剪貼簿，請手動複製下方內容'; fallback.hidden = false; fallback.select() })
})
