import { describe, expect, it, vi } from 'vitest'
import { CombatWorld, type CombatEvent } from '../combat/CombatWorld'
import { MatchController, type RoundSummary } from '../match/MatchController'
import { AUDIO_MANIFEST } from './AudioManifest'
import { announceCue, combatCues, finishCues, uiCue } from './AudioCues'
import { GameAudio } from './GameAudio'
import { UIEventBus } from '../ui/UIEventBus'

describe('audio cues', () => {
  it('maps all 32 supplied files to the intended category and URL', () => {
    expect(Object.keys(AUDIO_MANIFEST)).toHaveLength(32)
    expect(new Set(Object.values(AUDIO_MANIFEST).map(cue => cue.url)).size).toBe(32)
    expect(AUDIO_MANIFEST['hit-block'].url).toContain('HIT-03_block.wav')
    expect(AUDIO_MANIFEST['amb-cheer'].loop).toBe(true)
  })
  it('distinguishes heavy hits, blocks, KO and enemy voice', () => {
    const hit: CombatEvent = { type: 'HIT', attacker: 'PLAYER', defender: 'ENEMY', attackId: 1, attack: 'HEAVY_PUNCH', at: { x: 0, y: 0 } }
    expect(combatCues([hit])).toEqual([{ id: 'hit-heavy' }, { id: 'hit-heavy-fx' }, { id: 'vo-hit-heavy', detune: -200 }])
    expect(combatCues([hit, { type: 'BLOCK', attacker: 'PLAYER', defender: 'ENEMY', attackId: 1 }])).toEqual([{ id: 'hit-block' }])
    expect(combatCues([{ type: 'KNOCKDOWN', fighter: 'ENEMY' }, { type: 'HP_CHANGED', fighter: 'ENEMY', previousHP: 10, currentHP: 0 }])).toEqual([{ id: 'hit-prone' }, { id: 'vo-ko', detune: -200 }])
  })
  it('emits each announcement once and handles final round, double KO and perfect', () => {
    const snapshot = new MatchController().getSnapshot(), round: RoundSummary = { roundIndex: 1, roundNumber: 1, winner: null, finishReason: 'KO', playerHP: 0, enemyHP: 0, maxCombo: 0, durationTicks: 1 }
    expect(announceCue(undefined, { ...snapshot, announce: 'ROUND' })).toEqual([{ id: 'ann-round-1' }])
    expect(announceCue('ROUND', { ...snapshot, announce: 'ROUND' })).toEqual([])
    expect(announceCue(undefined, { ...snapshot, announce: 'ROUND', roundNumber: 3 })).toEqual([{ id: 'ann-final-round' }])
    expect(announceCue(undefined, { ...snapshot, announce: 'KO' }, round)).toEqual([{ id: 'ann-double-kill' }])
    expect(announceCue(undefined, { ...snapshot, announce: 'OUTCOME' }, { ...round, winner: 'PLAYER', playerHP: 100 }, true)).toEqual([{ id: 'ann-p1-wins' }, { id: 'ann-perfect', delayMs: 800 }])
    expect(finishCues({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 100, maxPlayerCombo: 2 })).toEqual([{ id: 'ann-ko' }, { id: 'ann-win', delayMs: 800 }, { id: 'ann-perfect', delayMs: 1600 }])
    expect(finishCues({ winner: null, finishReason: 'DRAW', playerRoundWins: 0, enemyRoundWins: 0, remainingPlayerHP: 0, maxPlayerCombo: 0 }, false, 100, round)[0]).toEqual({ id: 'ann-double-kill' })
    expect(uiCue('CONFIRM')).toBe('ui-confirm'); expect(uiCue('BACK')).toBe('ui-cancel')
    expect(new CombatWorld().getSnapshot().tick).toBe(0)
  })
  it('does not play cursor audio for initial focus', () => {
    const events = new UIEventBus(), audio = new GameAudio({} as never, events), play = vi.spyOn(audio, 'play').mockImplementation(() => {})
    events.emit('FOCUS_CHANGED', { group: 'menu', next: 'first' })
    expect(play).not.toHaveBeenCalled()
    events.emit('FOCUS_CHANGED', { group: 'menu', previous: 'first', next: 'second' })
    expect(play).toHaveBeenCalledWith({ id: 'ui-cursor' })
    audio.destroy()
  })
  it('silently skips audio that was not loaded', () => {
    const scene = { cache: { audio: { exists: () => false } }, sound: { play: vi.fn() } }
    const audio = new GameAudio(scene as never)
    expect(() => audio.play({ id: 'hit-light' })).not.toThrow()
    expect(scene.sound.play).not.toHaveBeenCalled()
    audio.destroy()
  })
  it('uses the configured volume for each sound category', () => {
    const scene = { cache: { audio: { exists: () => true } }, sound: { play: vi.fn() } }
    const audio = new GameAudio(scene as never)
    for (const [id, volume] of [['ui-confirm', 0.6], ['hit-light', 0.8], ['vo-ko', 0.7], ['ann-ko', 1], ['amb-claps', 0.25]] as const) {
      audio.play({ id })
      expect(scene.sound.play).toHaveBeenLastCalledWith(id, expect.objectContaining({ volume }))
    }
    audio.destroy()
  })
})
