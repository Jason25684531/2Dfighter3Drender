import { describe, expect, it } from 'vitest'
import { resolveMatchResult } from './ResultResolver'

describe('ResultResolver', () => {
  it('uses the documented title priority and score formula', () => {
    expect(resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 75, maxPlayerCombo: 3 })).toMatchObject({ score: 1875, title: 'UNTOUCHABLE' })
    expect(resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 74, maxPlayerCombo: 3 })).toMatchObject({ score: 1874, title: 'COMBO CONTENDER' })
    expect(resolveMatchResult({ winner: 'ENEMY', finishReason: 'KO', playerRoundWins: 0, enemyRoundWins: 2, remainingPlayerHP: 0, maxPlayerCombo: 0 })).toMatchObject({ score: 0, title: 'CHALLENGER' })
    expect(resolveMatchResult({ winner: null, finishReason: 'DRAW', playerRoundWins: 1, enemyRoundWins: 1, remainingPlayerHP: 100, maxPlayerCombo: 0 })).toMatchObject({ score: 850, title: 'EVEN MATCH' })
    expect(resolveMatchResult({ winner: 'PLAYER', finishReason: 'TIME_UP', playerRoundWins: 2, enemyRoundWins: 1, remainingPlayerHP: 60, maxPlayerCombo: 3 }).title).toBe('COMBO CONTENDER')
    expect(resolveMatchResult({ winner: 'ENEMY', finishReason: 'KO', playerRoundWins: 0, enemyRoundWins: 2, remainingPlayerHP: 0, maxPlayerCombo: 0 }).title).toBe('CHALLENGER')
    expect(resolveMatchResult({ winner: null, finishReason: 'DRAW', playerRoundWins: 1, enemyRoundWins: 1, remainingPlayerHP: 100, maxPlayerCombo: 0 }).title).toBe('EVEN MATCH')
  })
})
