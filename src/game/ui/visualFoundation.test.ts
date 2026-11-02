import { describe, expect, it, vi } from 'vitest'
import { aspectCover } from './tokens/layout'
import { battleViewModel, endViewModel, loadingViewModel, presentationViewModel, leaderboardPanelModel, resultViewModel, stageSelectViewModel } from './ViewModels'
import { characterEntries, resolveStageAsset, testCharacterManifest, testStageManifest } from './assets/TestAssetManifest'
import { ExperienceContext } from '../app/ExperienceContext'
import { p6SubStateForRank } from '../match/ResultResolver'
import { MatchController } from '../match/MatchController'
import { uiTokens } from './tokens/uiTokens'
import { typography } from './tokens/typography'
import { stopOwnedTweens } from './tweens'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { UIFramework } from './UIFramework'

describe('visual foundation', () => {
  it('round-trips dual player selections and resets P1 substates on departure', () => {
    const context = new ExperienceContext(), data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
    context.set({ players: { P1: { characterId: 'body-01', nickname: 'Kevin' }, P2: { characterId: 'preset-c' } } }); context.serialize(storage)
    const restored = new ExperienceContext(); restored.restore(storage); expect(restored.snapshot).toEqual(context.snapshot)
    const app = new AppStateMachine(), ui = new UIFramework(app)
    app.transitionTo(AppState.READY); ui.substates.set(AppState.READY, 'PROCESSING'); app.transitionTo(AppState.SETUP)
    expect(ui.substates.get(AppState.READY)).toBe('READY')
  })
  it('uses uniform centered aspect cover', () => { const result = aspectCover(2752, 1536, 1920, 1080); expect(result.scale).toBeGreaterThan(0); expect(result.width).toBeGreaterThanOrEqual(1920); expect(result.height).toBeGreaterThanOrEqual(1080) })
  it('exposes four body templates and five featured characters', () => { expect(characterEntries().filter((entry) => entry.type === 'BODY_TEMPLATE')).toHaveLength(4); expect(characterEntries().filter((entry) => entry.type === 'FEATURED').map((entry) => entry.displayName)).toEqual(['ARIA', 'KAEL', 'RIVEN', 'KEVIN', 'CUSTOM01']) })
  it('resolves both centralized stage assets and safe fallback', () => { expect(testStageManifest.laboratory.url).toContain('/test-assets/stages/laboratory.png'); expect(testStageManifest['company-building'].url).toContain('/test-assets/stages/company-building.png'); expect(resolveStageAsset('missing').id).toBe('laboratory') })
  it('keeps P2 and P3 view models presentation-only', () => { expect(stageSelectViewModel().stages).toHaveLength(2); expect(loadingViewModel().controls).toContain('GUARD') })
  it('stores setup selections without introducing backend fields', () => { const context = new ExperienceContext(); context.set({ players: { P1: { characterId: 'custom' } }, selectedStageId: 'company-building' }); expect(context.snapshot.players?.P1?.characterId).toBe('custom'); expect(context.snapshot.selectedStageId).toBe('company-building') })
  it('keeps backend rank mapping authoritative', () => { expect(p6SubStateForRank(3)).toBe('RANK_1_TO_6'); expect(p6SubStateForRank(12)).toBe('RANK_7_TO_19'); expect(p6SubStateForRank(20)).toBe('RANK_20'); expect(p6SubStateForRank(null)).toBe('NOT_RANKED') })
  it('projects backend leaderboard rows without sorting or recalculating rank', () => { const result = { outcome: 'WIN', title: 'CHAMPION', score: 100, maxPlayerCombo: 2, remainingPlayerHP: 80, playerRoundWins: 1, enemyRoundWins: 0, winner: 'PLAYER', finishReason: 'KO' } as never; const vm = resultViewModel(result, 7, 'RANK_7_TO_19', [{ rank: 7, match_id: 4, session_id: 9, nickname: 'PLAYER', score: 100, title: 'CHAMPION', remaining_hp: 80, max_combo: 2, finished_at: '' }], 9); expect(vm.rank).toBe(7); expect(vm.ranking).toEqual([{ rank: 7, name: 'PLAYER', score: 100, highlighted: true }]) })
  it('projects authoritative battle values without mutating the match', () => { const match = new MatchController(); match.start(); const before = match.getSnapshot(); const vm = battleViewModel(before, 'company-building'); expect(vm.timerSeconds).toBe(60); expect(vm.playerHp).toBe(100); expect(match.getSnapshot()).toEqual(before) })
  it('centralizes the approved focus, panel, depth, and motion anchors', () => {
    expect(uiTokens.chamfer).toBeGreaterThanOrEqual(10)
    expect(uiTokens.chamfer).toBeLessThanOrEqual(16)
    expect(uiTokens.focusScale).toBeGreaterThanOrEqual(1.04)
    expect(uiTokens.focusScale).toBeLessThanOrEqual(1.06)
    expect(uiTokens.stageFocusScale).toBeCloseTo(1.02)
    expect(uiTokens.opacity.inactive).toBeGreaterThanOrEqual(0.72)
    expect(uiTokens.opacity.inactive).toBeLessThanOrEqual(0.82)
    expect(uiTokens.motionMs.focus).toBeGreaterThanOrEqual(100)
    expect(uiTokens.motionMs.focus).toBeLessThanOrEqual(160)
    expect(uiTokens.motionMs.enter).toBeGreaterThanOrEqual(150)
    expect(uiTokens.motionMs.enter).toBeLessThanOrEqual(250)
    expect(uiTokens.glowWidth.focus).toBeGreaterThan(0)
    expect(uiTokens.backdrop.empty).toBeGreaterThanOrEqual(0.45)
    expect(uiTokens.backdrop.empty).toBeLessThanOrEqual(0.6)
    expect(uiTokens.shadowBlur.impact).toBeGreaterThan(uiTokens.shadowBlur.focal)
    expect(uiTokens.textStroke.impact).toBeGreaterThan(uiTokens.textStroke.announcer)
    expect(uiTokens.colors.playerPrimary).not.toBe(uiTokens.colors.systemBlue)
    expect(uiTokens.colors.enemyPrimary).not.toBe(uiTokens.colors.systemBlue)
  })
  it('keeps Traditional Chinese and Latin available in local font fallbacks', () => {
    expect(typography.family).toContain('Arial')
    expect(typography.family).toContain('Microsoft JhengHei')
    expect(typography.heading.fontFamily).not.toContain('http')
  })
  it('stops and releases every owned presentation tween on destroy', () => {
    const first = { stop: vi.fn() }; const second = { stop: vi.fn() }; const owned = [first, second]
    stopOwnedTweens(owned)
    expect(first.stop).toHaveBeenCalledOnce(); expect(second.stop).toHaveBeenCalledOnce(); expect(owned).toEqual([])
  })
  it('projects only supported P3 data and clamps the existing loader progress', () => {
    const vm = loadingViewModel(testCharacterManifest.presetB, 'ROG_SAGA', 'COMPANY BUILDING', 0.4)
    expect(vm.character.id).toBe('preset-b')
    expect(vm.stage).toBe('COMPANY BUILDING')
    expect(vm.progress).toBe(0.4)
    expect(vm.controls).toEqual(['MOVE', 'JUMP', 'PUNCH', 'KICK', 'GUARD'])
    expect(Object.keys(vm).sort()).toEqual(['character', 'controls', 'enemyName', 'playerName', 'progress', 'stage'])
    expect(loadingViewModel(testCharacterManifest.presetA, 'ROG_SAGA', 'LABORATORY', 2).progress).toBe(1)
  })
  it('keeps P5 and P6 layout projections outcome-aware for WIN, LOSE, and DRAW', () => {
    const outcomes = [
      ['WIN', 'YOU WIN!'], ['LOSE', 'YOU LOSE!'], ['DRAW', 'DRAW!'],
    ] as const
    for (const [outcome, headline] of outcomes) {
      const result = { outcome, title: 'TITLE', score: 80, maxPlayerCombo: 4, remainingPlayerHP: 30, playerRoundWins: 1, enemyRoundWins: 1, winner: null, finishReason: 'KO' } as never
      expect(presentationViewModel(result)).toMatchObject({ outcome: headline, result: outcome })
      expect(resultViewModel(result, 3, 'RANK_1_TO_6')).toMatchObject({ outcome, headline, score: 80, ranking: [] })
    }
  })
  it('does not invent P7 next-player data when the source is empty', () => {
    expect(endViewModel().nextPlayerName).toBeUndefined()
    expect(endViewModel('PLAYER').nextPlayerName).toBe('PLAYER')
  })
  it('adds a YOU row when the player is ranked outside the shown leaderboard', () => {
    const result = { outcome: 'WIN', title: '', score: 50, maxPlayerCombo: 1, remainingPlayerHP: 10, playerRoundWins: 1, enemyRoundWins: 0, winner: 'PLAYER', finishReason: 'KO' } as never
    const rows = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, match_id: i, session_id: i, nickname: 'P' + i, score: 100 - i, title: '', remaining_hp: 1, max_combo: 1, finished_at: '' }))
    const vm = resultViewModel(result, 25, 'NOT_RANKED', rows, 99)
    expect(vm.ranking).toHaveLength(20); expect(vm.ranking[19]).toEqual({ rank: 25, name: 'YOU', score: 50, highlighted: true })
    expect(resultViewModel(result, 1, 'RANK_1_TO_6', rows, 0).newRecord).toBe(true)
  })
  it('maps leaderboard data to a panel model with loading, empty, offline and top-10 states', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, match_id: i, session_id: i, nickname: `P${i}`, score: 100 - i, title: 'T', remaining_hp: 1, max_combo: 1, finished_at: '' }))
    expect(leaderboardPanelModel(undefined).status).toBe('LOADING'); expect(leaderboardPanelModel([]).status).toBe('EMPTY'); expect(leaderboardPanelModel(rows, false).status).toBe('OFFLINE')
    const ready = leaderboardPanelModel(rows); expect(ready.status).toBe('READY'); expect(ready.rows).toHaveLength(10); expect(ready.rows[0]).toEqual({ rank: 1, name: 'P0', score: 100, title: 'T' })
  })
})
