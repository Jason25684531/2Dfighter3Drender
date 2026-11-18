import type Phaser from 'phaser'

export const HEAD_SIZE = 512
export const headKey = (spriteId: string): string => `head-${spriteId}`

type Rect = { x: number; y: number; size: number }

/** solid 在 n×n 的縮圖上判斷該點是否不透明。頭肩方框＝從最上緣起算身高的 26%，水平置中在該段的實心範圍；全空則置中。 */
export function headRect(solid: (x: number, y: number) => boolean, n: number): Rect {
  const rows = Array.from({ length: n }, (_, y) => y).filter((y) => Array.from({ length: n }, (_, x) => x).some((x) => solid(x, y)))
  if (!rows.length) return { x: n / 4, y: n / 8, size: n / 2 }
  const top = rows[0], size = Math.max(8, Math.round((rows[rows.length - 1] - top + 1) * 0.26))
  const xs = Array.from({ length: n * Math.ceil(size / 2) }, (_, i) => [i % n, top + Math.floor(i / n)] as const).filter(([x, y]) => y < n && solid(x, y)).map(([x]) => x)
  const center = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : n / 2
  return { x: Math.min(n - size, Math.max(0, center - size / 2)), y: Math.max(0, top - size * 0.1), size }
}

/** 取待機第 0 格（cell×cell）的頭肩，畫成 512×512 貼圖 `head-<spriteId>`；已存在就原地重畫，所有用到它的格子自動更新（精簡版先上，原圖到了再換）。 */
export function paintHead(scene: Phaser.Scene, spriteId: string, image: CanvasImageSource, cell: number): void {
  const n = 64, probe = Object.assign(document.createElement('canvas'), { width: n, height: n }).getContext('2d', { willReadFrequently: true })
  if (!probe) return
  probe.drawImage(image, 0, 0, cell, cell, 0, 0, n, n)
  const alpha = probe.getImageData(0, 0, n, n).data
  const rect = headRect((x, y) => alpha[(y * n + x) * 4 + 3] > 64, n), unit = cell / n
  const key = headKey(spriteId), existing = scene.textures.exists(key)
  const canvas = existing ? scene.textures.get(key).getSourceImage() as HTMLCanvasElement : Object.assign(document.createElement('canvas'), { width: HEAD_SIZE, height: HEAD_SIZE })
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, HEAD_SIZE, HEAD_SIZE)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, rect.x * unit, rect.y * unit, rect.size * unit, rect.size * unit, 0, 0, HEAD_SIZE, HEAD_SIZE)
  if (existing) (scene.textures.get(key) as Phaser.Textures.CanvasTexture).refresh(); else scene.textures.addCanvas(key, canvas)
}
