from app.scoring import score_and_title


def test_shared_score_vectors():
    assert score_and_title('WIN', 2, 75, 3) == (1875, 'UNTOUCHABLE')
    assert score_and_title('WIN', 2, 74, 3) == (1874, 'COMBO CONTENDER')
    assert score_and_title('LOSE', 0, 0, 0) == (0, 'CHALLENGER')
    assert score_and_title('DRAW', 1, 100, 0) == (850, 'EVEN MATCH')
