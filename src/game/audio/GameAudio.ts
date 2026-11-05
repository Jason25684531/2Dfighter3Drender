import type Phaser from 'phaser'
import type { UIEventBus } from '../ui/UIEventBus'
import type { UIAction } from '../ui/NavigationManager'
import { AUDIO_MANIFEST, type CueId } from './AudioManifest'
import { uiCue, type AudioCue } from './AudioCues'

export class GameAudio {
  private loopSound?: Phaser.Sound.BaseSound
  private readonly timers: Phaser.Time.TimerEvent[] = []
  private readonly unsubscribe: Array<() => void> = []
  private readonly params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

  static load(scene: Phaser.Scene): void {
    for (const [id, cue] of Object.entries(AUDIO_MANIFEST)) scene.load.audio(id, cue.url)
  }

  constructor(private readonly scene: Phaser.Scene, events?: UIEventBus) {
    if (events) {
      this.unsubscribe.push(events.on('FOCUS_CHANGED', ({ previous, next }) => { if (previous && next && previous !== next) this.play({ id: 'ui-cursor' }) }))
      this.unsubscribe.push(events.on('UI_ACTION', ({ action, handled }) => { if (handled && !action.startsWith('NAV_')) this.ui(action) }))
    }
  }

  ui(action: UIAction): void { const id = uiCue(action); if (id) this.play({ id }) }
  play(cue: AudioCue): void {
    if (cue.delayMs) { this.timers.push(this.scene.time.delayedCall(cue.delayMs, () => this.play({ ...cue, delayMs: undefined }))); return }
    if (this.params.get('audioDebug') === '1') console.info('[audio]', cue.id)
    if (this.params.get('mute') === '1' || !this.scene.cache.audio.exists(cue.id)) return
    const item = AUDIO_MANIFEST[cue.id]
    try { this.scene.sound.play(cue.id, { volume: item.volume, detune: cue.detune ?? 0, rate: item.kind === 'sfx' ? 0.95 + Math.random() * 0.1 : 1 }) } catch { /* Missing or unsupported audio is silent. */ }
  }
  playSequence(cues: readonly AudioCue[]): void { cues.forEach(cue => this.play(cue)) }
  loop(id: CueId): void {
    this.stopLoop()
    if (this.params.get('audioDebug') === '1') console.info('[audio]', id)
    if (this.params.get('mute') === '1' || !this.scene.cache.audio.exists(id)) return
    try { this.loopSound = this.scene.sound.add(id, { loop: true, volume: AUDIO_MANIFEST[id].volume }); this.loopSound.play() } catch { this.loopSound = undefined }
  }
  stopLoop(): void { this.loopSound?.stop(); this.loopSound?.destroy(); this.loopSound = undefined }
  pauseLoop(): void { this.loopSound?.pause() }
  resumeLoop(): void { this.loopSound?.resume() }
  destroy(): void { this.stopLoop(); this.timers.forEach(timer => timer.remove()); this.unsubscribe.forEach(unsubscribe => unsubscribe()) }
}
