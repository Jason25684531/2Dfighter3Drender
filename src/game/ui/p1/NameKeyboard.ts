import type { OwnedUiAction } from '../../input/InputManager'

// 機台沒有實體鍵盤：拍照頁用搖桿在這張表上選字輸入名稱。
export const NAME_KEYS: readonly (readonly string[])[] = [
  [...'ABCDEFGHIJ'], [...'KLMNOPQRST'], [...'UVWXYZ0123'], [...'456789'], ['SPACE', 'DEL', 'OK'],
]

export class NameKeyboard {
  row = 0
  col = 0
  get key(): string { return NAME_KEYS[this.row][this.col] }

  /** 方向鍵移動游標（上下左右都循環）；回傳 true 表示已處理。 */
  move(action: OwnedUiAction): boolean {
    const dRow = action === 'NAV_DOWN' ? 1 : action === 'NAV_UP' ? -1 : 0, dCol = action === 'NAV_RIGHT' ? 1 : action === 'NAV_LEFT' ? -1 : 0
    if (!dRow && !dCol) return false
    if (dRow) { this.row = (this.row + dRow + NAME_KEYS.length) % NAME_KEYS.length; this.col = Math.min(this.col, NAME_KEYS[this.row].length - 1) }
    else this.col = (this.col + dCol + NAME_KEYS[this.row].length) % NAME_KEYS[this.row].length
    return true
  }

  /** 按下目前的鍵：回傳新名稱；OK 回傳 undefined 交給原本的確認（拍照）。 */
  type(name: string, max: number): string | undefined {
    if (this.key === 'OK') return undefined
    if (this.key === 'DEL') return name.slice(0, -1)
    return (name + (this.key === 'SPACE' ? ' ' : this.key)).slice(0, max)
  }
}
