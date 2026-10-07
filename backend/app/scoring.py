def score_and_title(outcome: str, player_round_wins: int, remaining_hp: int, max_combo: int) -> tuple[int, str]:
    score = (1000 if outcome == 'WIN' else 500 if outcome == 'DRAW' else 0) + 250 * player_round_wins + remaining_hp + 100 * max_combo
    if outcome == 'DRAW': return score, 'EVEN MATCH'
    if outcome == 'LOSE': return score, 'CHALLENGER'
    if remaining_hp >= 75: return score, 'UNTOUCHABLE'
    return score, 'COMBO CONTENDER' if max_combo >= 3 else 'CHAMPION'
