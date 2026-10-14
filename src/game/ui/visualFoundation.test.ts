import { describe, expect, it, vi } from 'vitest'
import { aspectCover } from './tokens/layout'
import { battleViewModel, characterChoices, endViewModel, loadingViewModel, mockResultViewModel, p0Variant, presentationViewModel, recordWallViewModel, resultViewModel, stageSelectViewModel } from './ViewModels'
import { animationCategories, sampleCharacterAnimationManifest } from './animation/FighterAnimationManifest'
import { facingScaleX, resolveFighterAnimation, resolvePreviewAnimation } from './animation/FighterAnimationResolver'
import { resolveStageAsset, testCharacterManifest, testStageManifest } from './assets/TestAssetManifest'
import { ExperienceContext } from '../app/ExperienceContext'
import { p6SubStateForRank } from '../match/ResultResolver'
import { sampleWebmValidation } from './assets/sampleWebmValidation'
import { MatchController } from '../match/MatchController'
import { uiTokens } from './tokens/uiTokens'
import { typography } from './tokens/typography'
import { stopOwnedTweens } from './tweens'

describe('visual foundation', () => {
  it('uses uniform centered aspect cover', () => { const result = aspectCover(2752, 1536, 1920, 1080); expect(result.scale).toBeGreaterThan(0); expect(result.width).toBeGreaterThanOrEqual(1920); expect(result.height).toBeGreaterThanOrEqual(1080) })
  it('exposes exactly three presets and one custom choice', () => { expect(characterChoices()).toHaveLength(4); expect(characterChoices().filter((choice) => choice.custom)).toHaveLength(1) })
  it('keeps required mock result local and exact', () => { const result = mockResultViewModel(); expect(result.score).toBe(1541); expect(result.rank).toBe(3); expect(result.ranking).toHaveLength(10) })
  it('projects every DEV rank substate without changing the default mock', () => { expect(mockResultViewModel('RANK_7_TO_19').rank).toBe(12); expect(mockResultViewModel('RANK_20').rank).toBe(20); expect(mockResultViewModel('NOT_RANKED').rank).toBeNull() })
  it('maps movement relative to facing', () => { const base = { vx: -18, vy: 0, grounded: true, facing: 'LEFT' as const, state: 'WALK' as const, attackPhase: 'NONE' as const, attackId: 0 }; expect(resolveFighterAnimation(base, sampleCharacterAnimationManifest).animationKey).toBe('WALK_FORWARD') })
  it('resolves both centralized stage assets and safe fallback', () => { expect(testStageManifest.laboratory.url).toContain('/test-assets/stages/laboratory.png'); expect(testStageManifest['company-building'].url).toContain('/test-assets/stages/company-building.png'); expect(resolveStageAsset('missing').id).toBe('laboratory') })
  it('keeps P0, P2, and P3 view models presentation-only', () => { expect(p0Variant(0)).toBe('EMPTY'); expect(p0Variant(4)).toBe('RECORDS_1_TO_4'); expect(p0Variant(5)).toBe('RECORDS_5_PLUS'); expect(stageSelectViewModel().stages).toHaveLength(2); expect(loadingViewModel().controls).toContain('K / LB = GUARD') })
  it('projects P0, P5, and P7 variants without domain mutation', () => { expect(recordWallViewModel([{ name: 'A', score: 1 }]).variant).toBe('RECORDS_1_TO_4'); expect(presentationViewModel(undefined, 'KO')).toEqual({ headline: 'K.O.', outcome: '' }); expect(presentationViewModel(undefined, 'TIME_UP')).toMatchObject({ headline: 'TIME UP', outcome: 'DRAW', result: 'DRAW' }); expect(presentationViewModel(undefined, 'WIN')).toMatchObject({ headline: 'YOU WIN!', outcome: 'MATCH COMPLETE', result: 'WIN' }); expect(endViewModel('NEXT').nextPlayerLabel).toBe('NEXT  /  NEXT') })
  it('stores setup selections without introducing backend fields', () => { const context = new ExperienceContext(); context.set({ selectedCharacterId: 'custom', selectedStageId: 'company-building' }); expect(context.snapshot.selectedCharacterId).toBe('custom'); expect(context.snapshot.selectedStageId).toBe('company-building') })
  it('keeps backend rank mapping authoritative', () => { expect(p6SubStateForRank(3)).toBe('RANK_1_TO_6'); expect(p6SubStateForRank(12)).toBe('RANK_7_TO_19'); expect(p6SubStateForRank(20)).toBe('RANK_20'); expect(p6SubStateForRank(null)).toBe('NOT_RANKED') })
  it('projects backend leaderboard rows without sorting or recalculating rank', () => { const result = { outcome: 'WIN', title: 'CHAMPION', score: 100, maxPlayerCombo: 2, remainingPlayerHP: 80, playerRoundWins: 1, enemyRoundWins: 0, winner: 'PLAYER', finishReason: 'KO' } as never; const vm = resultViewModel(result, 7, 'RANK_7_TO_19', [{ rank: 7, match_id: 4, session_id: 9, nickname: 'PLAYER', score: 100, title: 'CHAMPION', remaining_hp: 80, max_combo: 2, finished_at: '' }], 9); expect(vm.rank).toBe(7); expect(vm.ranking).toEqual([{ rank: 7, name: 'PLAYER', score: 100, highlighted: true }]) })
  it('records all discovered WebM metadata and alpha metadata', () => { expect(sampleWebmValidation).toHaveLength(19); expect(sampleWebmValidation.find((entry) => entry.filename === 'stA.webm')).toMatchObject({ width: 188, height: 266, durationMs: 250, alphaMode: 1 }) })
  it('groups every animation once for the Lab', () => { const keys = animationCategories.flatMap((category) => category.keys); expect(keys).toHaveLength(19); expect(new Set(keys).size).toBe(19) })
  it('applies Lab facing and loop override before switching media', () => { expect(facingScaleX('LEFT')).toBe(-1); expect(resolvePreviewAnimation('IDLE', sampleCharacterAnimationManifest.IDLE, 'LEFT', false)).toMatchObject({ animationKey: 'IDLE', facing: 'LEFT', loop: false }) })
  it('projects authoritative battle values without mutating the match', () => { const match = new MatchController(); match.start(); const before = match.getSnapshot(); const vm = battleViewModel(before, 'company-building'); expect(vm.timerSeconds).toBe(60); expect(vm.playerHp).toBe(100); expect(match.getSnapshot()).toEqual(before) })
  it('resolves runtime animation states without adding preview moves', () => {
    const base = { vx: 0, vy: 0, grounded: true, facing: 'RIGHT' as const, state: 'IDLE' as const, attackPhase: 'NONE' as const, attackId: 0 }
    expect(resolveFighterAnimation(base, sampleCharacterAnimationManifest).animationKey).toBe('IDLE')
    expect(resolveFighterAnimation({ ...base, vy: -4, grounded: false, state: 'JUMP' }, sampleCharacterAnimationManifest).animationKey).toBe('JUMP')
    expect(resolveFighterAnimation({ ...base, attackPhase: 'ACTIVE', attackId: 4, state: 'ATTACK' }, sampleCharacterAnimationManifest).restartToken).toBe('attack:4')
    expect(resolveFighterAnimation({ ...base, state: 'HIT_STUN' }, sampleCharacterAnimationManifest).animationKey).toBe('HIT_STUN')
    expect(resolveFighterAnimation({ ...base, state: 'GUARD', recentEvent: { type: 'BLOCK', attacker: 'ENEMY', defender: 'PLAYER', attackId: 7 }, recentEventToken: 'BLOCK:7' }, sampleCharacterAnimationManifest)).toMatchObject({ animationKey: 'BLOCK_STUN', loop: false })
    expect(resolveFighterAnimation({ ...base, state: 'GUARD' }, sampleCharacterAnimationManifest).animationKey).toBe('WALK_BACKWARD')
    expect(sampleCharacterAnimationManifest.STANDING_HEAVY_PUNCH.previewOnly).toBe(true)
  })
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
    const vm = loadingViewModel('preset-b', 'COMPANY BUILDING', 0.4)
    expect(vm.character.id).toBe('preset-b')
    expect(vm.stage).toBe('COMPANY BUILDING')
    expect(vm.progress).toBe(0.4)
    expect(vm.controls).toEqual(['MOVE', 'ATTACK', 'JUMP', 'K / LB = GUARD'])
    expect(Object.keys(vm).sort()).toEqual(['character', 'controls', 'enemyName', 'progress', 'stage'])
    expect(loadingViewModel('preset-a', 'LABORATORY', 2).progress).toBe(1)
  })
  it('uses only the available runtime fighter preview and honest silhouette fallbacks', () => {
    expect(testCharacterManifest.presetA.previewUrl).toContain('/idle.webm')
    expect(testCharacterManifest.presetB.previewUrl).toBe('')
    expect(testCharacterManifest.presetC.previewUrl).toBe('')
    expect(testCharacterManifest.custom.previewUrl).toBe('')
  })
  it('keeps P5 and P6 layout projections outcome-aware for WIN, LOSE, and DRAW', () => {
    const outcomes = [
      ['WIN', 'YOU WIN!'], ['LOSE', 'YOU LOSE!'], ['DRAW', 'DRAW!'],
    ] as const
    for (const [outcome, headline] of outcomes) {
      const result = { outcome, title: 'TITLE', score: 80, maxPlayerCombo: 4, remainingPlayerHP: 30, playerRoundWins: 1, enemyRoundWins: 1, winner: null, finishReason: 'KO' } as never
      expect(presentationViewModel(result)).toMatchObject({ outcome: headline, result: outcome })
      expect(resultViewModel(result, 3, 'RANK_1_TO_6')).toMatchObject({ outcome, headline, score: 80, ranking: [] })
      expect(mockResultViewModel('RANK_1_TO_6', outcome)).toMatchObject({ headline, outcome, newRecord: outcome === 'WIN' })
    }
  })
  it('does not invent P0 records or P7 next-player data when the source is empty', () => {
    expect(recordWallViewModel([]).variant).toBe('EMPTY')
    expect(recordWallViewModel([]).rows).toEqual([])
    expect(endViewModel().nextPlayerName).toBeUndefined()
    expect(endViewModel('PLAYER').nextPlayerName).toBe('PLAYER')
  })
})
