export const FIXED_STEP_MS = 1000 / 24
export const MAX_FRAME_DELTA_MS = 250
export const MAX_CATCH_UP_TICKS = 6

export type TickListener = (tick: number) => void

export class GameClock {
  private accumulator = 0
  private running = false
  private paused = false
  private tickNumber = 0
  private readonly listeners = new Set<TickListener>()

  start(): void { this.running = true; this.paused = false }
  stop(): void { this.running = false }
  pause(): void { this.paused = true }
  resume(): void { if (this.running) this.paused = false }
  reset(): void { this.accumulator = 0; this.tickNumber = 0 }
  isPaused(): boolean { return this.paused }
  isRunning(): boolean { return this.running }
  getTick(): number { return this.tickNumber }
  getRemainderMs(): number { return this.accumulator }
  subscribe(listener: TickListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  advance(deltaMs: number): number {
    if (!this.running || this.paused || !Number.isFinite(deltaMs) || deltaMs <= 0) return 0
    this.accumulator += Math.min(deltaMs, MAX_FRAME_DELTA_MS)
    let emitted = 0
    while (this.accumulator + 1e-9 >= FIXED_STEP_MS && emitted < MAX_CATCH_UP_TICKS) {
      this.accumulator -= FIXED_STEP_MS; emitted += 1; this.tickNumber += 1; this.listeners.forEach((listener) => listener(this.tickNumber))
    }
    if (emitted === MAX_CATCH_UP_TICKS && this.accumulator >= FIXED_STEP_MS) this.accumulator %= FIXED_STEP_MS
    return emitted
  }
}
