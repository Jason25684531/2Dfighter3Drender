import { ARENA_WIDTH, MAX_SCROLL, STAGE_TUNING } from '../../config/stageTuning'

export { MAX_SCROLL }
export const WORLD_ZOOM = STAGE_TUNING.worldZoom
const ARENA_CENTER = ARENA_WIDTH / 2
// scroll = 鏡頭中心相對場地中央的位移（world），範圍 ±MAX_SCROLL。
export const worldX = (scroll: number): number => 960 - (ARENA_CENTER + scroll) * WORLD_ZOOM
const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n))

/** 鏡頭追兩人中點，碰到場地邊界停住；時間無關的指數平滑。兩人一定在畫面內由 Combat 的 maxSeparation 保證。 */
export function stageCamera(scroll: number, left: number, right: number, seconds: number): number {
  const target = clamp((left + right) / 2 - ARENA_CENTER, -MAX_SCROLL, MAX_SCROLL)
  return scroll + (target - scroll) * (1 - Math.exp(-6 * Math.max(0, seconds)))
}
