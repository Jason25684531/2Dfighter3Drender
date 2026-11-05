import type { CombatEvent, FighterId } from '../combat/CombatWorld'
import type { Announce, CompletedMatch, MatchSnapshot, RoundSummary } from '../match/MatchController'
import type { UIAction } from '../ui/NavigationManager'
import type { CueId } from './AudioManifest'

export type AudioCue = { id: CueId; detune?: number; delayMs?: number }
const voice = (id: CueId, fighter: FighterId): AudioCue => ({ id, ...(fighter === 'ENEMY' ? { detune: -200 } : {}) })
const heavy = (attack: string): boolean => attack.startsWith('HEAVY')

export function combatCues(events: readonly CombatEvent[]): AudioCue[] {
  const cues: AudioCue[] = []
  for (const event of events) {
    if (event.type === 'JUMP') cues.push({ id: 'mov-jump' })
    if (event.type === 'ATTACK_STARTED') {
      const h = heavy(event.attack)
      cues.push({ id: h ? 'mov-miss-heavy' : 'mov-miss-light' }, voice(h ? 'vo-attack-heavy' : 'vo-attack-light', event.attacker))
    }
    if (event.type === 'HIT') {
      const blocked = events.some(other => other.type === 'BLOCK' && other.attacker === event.attacker && other.attackId === event.attackId)
      const h = heavy(event.attack)
      cues.push({ id: blocked ? 'hit-block' : h ? 'hit-heavy' : 'hit-light' })
      if (!blocked && h) cues.push({ id: 'hit-heavy-fx' })
      if (!blocked) cues.push(voice(h ? 'vo-hit-heavy' : 'vo-hit-light', event.defender))
    }
    // KO 也會先發 KNOCKDOWN，倒地聲只由它播一次。
    if (event.type === 'KNOCKDOWN') cues.push({ id: 'hit-prone' })
    if (event.type === 'HP_CHANGED' && event.currentHP === 0 && event.previousHP > 0) cues.push(voice('vo-ko', event.fighter))
  }
  return cues
}

export function announceCue(previous: Announce | undefined, snapshot: MatchSnapshot, lastRound?: RoundSummary, twoPlayer = false, maxHp = 100): AudioCue[] {
  const current = snapshot.announce
  if (!current || current === previous) return []
  if (current === 'ROUND') return [{ id: snapshot.roundNumber >= 3 ? 'ann-final-round' : snapshot.roundNumber === 2 ? 'ann-round-2' : 'ann-round-1' }]
  if (current === 'FIGHT') return [{ id: 'ann-fight' }]
  if (current === 'KO') return [{ id: lastRound?.winner === null ? 'ann-double-kill' : 'ann-ko' }]
  if (current === 'TIME_UP') return [{ id: 'ann-times-up' }]
  if (current !== 'OUTCOME' || !lastRound) return []
  const outcome: CueId = lastRound.winner === null ? 'ann-draw' : twoPlayer ? lastRound.winner === 'PLAYER' ? 'ann-p1-wins' : 'ann-p2-wins' : lastRound.winner === 'PLAYER' ? 'ann-win' : 'ann-lose'
  return [{ id: outcome }, ...(lastRound.winner === 'PLAYER' && lastRound.playerHP === maxHp ? [{ id: 'ann-perfect' as const, delayMs: 800 }] : [])]
}

export function finishCues(result: CompletedMatch, twoPlayer = false, maxHp = 100, lastRound?: RoundSummary): AudioCue[] {
  const reason = result.finishReason === 'DRAW' ? lastRound?.finishReason : result.finishReason
  const finish: CueId = reason === 'KO' ? result.winner === null ? 'ann-double-kill' : 'ann-ko' : 'ann-times-up'
  const outcome: CueId = result.winner === null ? 'ann-draw' : twoPlayer ? result.winner === 'PLAYER' ? 'ann-p1-wins' : 'ann-p2-wins' : result.winner === 'PLAYER' ? 'ann-win' : 'ann-lose'
  return [{ id: finish }, { id: outcome, delayMs: 800 }, ...(result.winner === 'PLAYER' && result.remainingPlayerHP === maxHp ? [{ id: 'ann-perfect' as const, delayMs: 1600 }] : [])]
}

export function uiCue(action: UIAction): CueId | undefined {
  if (action.startsWith('NAV_')) return 'ui-cursor'
  if (action === 'CONFIRM') return 'ui-confirm'
  if (action === 'BACK') return 'ui-cancel'
  if (action === 'OPEN_MENU') return 'ui-pause'
}
