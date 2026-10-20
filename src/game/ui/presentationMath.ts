import type { MatchSnapshot } from '../match/MatchController'

export const healthRatio = (value: number): number => Math.max(0, Math.min(1, value))
export const panelPoints = (width: number, height: number, slant: number, shape: 'slant' | 'chamfer' = 'slant'): number[] => {
  const cut = Math.max(0, Math.min(slant, width / 2, height / 2)), x = width / 2, y = height / 2
  return shape === 'slant' ? [-x + cut, -y, x, -y, x - cut, y, -x, y] : [-x + cut, -y, x, -y, x, y - cut, x - cut, y, -x, y, -x, -y + cut]
}
export type BannerStep = { text: string; ticks: number }
export const roundBannerSequence = (previous: MatchSnapshot | undefined, next: MatchSnapshot): BannerStep[] | undefined => {
  if (!previous) return [{ text: 'ROUND 1', ticks: 18 }, { text: 'FIGHT!', ticks: 12 }]
  if (next.matchState === 'MATCH_END') return []
  const outcome = next.playerRoundWins > previous.playerRoundWins ? 'WIN' : next.enemyRoundWins > previous.enemyRoundWins ? 'LOSE' : next.drawRetries > previous.drawRetries ? 'DRAW' : undefined
  if (!outcome) return undefined
  return [{ text: `ROUND ${next.roundNumber} ${outcome}`, ticks: 36 }, { text: `ROUND ${next.roundNumber + (outcome === 'DRAW' ? 0 : 1)}`, ticks: 18 }, { text: 'FIGHT!', ticks: 12 }]
}
export const bannerTextAt = (steps: readonly BannerStep[], elapsed: number): string => {
  for (const step of steps) { if (elapsed < step.ticks) return step.text; elapsed -= step.ticks }
  return ''
}
