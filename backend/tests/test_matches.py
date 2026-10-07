import pytest

def player(client, key='player'):
    return client.post('/api/v1/players', json={'nickname': key, 'language': 'zh-TW', 'client_request_id': key}).json()


def session(client, player_id, key='session'):
    return client.post('/api/v1/sessions', json={'player_id': player_id, 'client_request_id': key})


def active_session(client, key='match-player'):
    current_player = player(client, key)
    created = session(client, current_player['id'], f'{key}:session')
    active = client.post('/api/v1/queue/activate-next', json={'client_request_id': f'{key}:activate'})
    assert active.status_code == 200
    return active.json()['id']


def finish_payload(request_id='finish:1', score=1880, title='UNTOUCHABLE', remaining_hp=80, max_combo=3):
    return {
        'outcome': 'WIN', 'finish_reason': 'KO', 'player_round_wins': 2, 'enemy_round_wins': 0,
        'remaining_hp': remaining_hp, 'max_combo': max_combo, 'client_score': score, 'client_title': title,
        'finish_request_id': request_id,
    }


def test_match_round_finish_and_idempotency(client):
    session_id = active_session(client)
    created = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'attempt:1:create'})
    assert created.status_code == 201
    match = created.json()
    assert match['match_number'] == 1 and match['status'] == 'IN_PROGRESS'
    assert client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'attempt:1:create'}).status_code == 200
    assert client.post('/api/v1/matches', json={'session_id': session_id + 1, 'client_request_id': 'attempt:1:create'}).json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'

    round_payload = {'round_index': 1, 'round_number': 1, 'winner': 'PLAYER', 'finish_reason': 'KO', 'player_hp': 80, 'enemy_hp': 0, 'max_combo': 3, 'duration_ticks': 12, 'client_request_id': 'attempt:1:round:1'}
    assert client.post(f"/api/v1/matches/{match['id']}/rounds", json=round_payload).status_code == 201
    assert client.post(f"/api/v1/matches/{match['id']}/rounds", json=round_payload).status_code == 200
    conflict = {**round_payload, 'duration_ticks': 13}
    assert client.post(f"/api/v1/matches/{match['id']}/rounds", json=conflict).json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'

    finished = client.post(f"/api/v1/matches/{match['id']}/finish", json=finish_payload()).json()
    assert finished['status'] == 'FINISHED' and finished['score'] == 1880 and finished['rank'] == 1
    assert client.post(f"/api/v1/matches/{match['id']}/finish", json=finish_payload()).status_code == 200
    assert client.post(f"/api/v1/matches/{match['id']}/finish", json=finish_payload(score=0, title='CHAMPION')).json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
    assert client.post(f"/api/v1/matches/{match['id']}/rounds", json={**round_payload, 'client_request_id': 'attempt:1:round:2', 'round_index': 2}).json()['error']['code'] == 'INVALID_MATCH_STATE'


def test_replay_keeps_old_match_and_only_best_session_entry(client):
    session_id = active_session(client, 'replay-player')
    first = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'replay:1:create'}).json()
    client.post(f"/api/v1/matches/{first['id']}/finish", json=finish_payload('replay:1:finish', 1850, 'COMBO CONTENDER', 50))
    second = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'replay:2:create'}).json()
    assert second['match_number'] == 2
    client.post(f"/api/v1/matches/{second['id']}/finish", json=finish_payload('replay:2:finish', 1880, 'UNTOUCHABLE'))
    rows = client.get('/api/v1/leaderboard').json()
    assert len(rows) == 1 and rows[0]['match_id'] == second['id'] and rows[0]['session_id'] == session_id
    assert client.get(f"/api/v1/matches/{first['id']}").json()['status'] == 'FINISHED'


def test_finish_rolls_back_when_rank_refresh_fails(client, monkeypatch):
    session_id = active_session(client, 'rollback-player')
    match = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'rollback:create'}).json()
    from app.services import matches
    monkeypatch.setattr(matches.leaderboard, 'refresh_ranks', lambda _: (_ for _ in ()).throw(RuntimeError('rank failed')))
    with pytest.raises(RuntimeError):
        client.post(f"/api/v1/matches/{match['id']}/finish", json=finish_payload('rollback:finish'))
    assert client.get(f"/api/v1/matches/{match['id']}").json()['status'] == 'IN_PROGRESS'


def test_session_finish_abandons_in_progress_match(client):
    session_id = active_session(client, 'abandon-player')
    match = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': 'abandon:create'}).json()
    assert client.post(f'/api/v1/sessions/{session_id}/finish', json={'client_request_id': 'abandon:session-finish'}).status_code == 200
    assert client.get(f"/api/v1/matches/{match['id']}").json()['status'] == 'ABANDONED'


def test_leaderboard_top_twenty_and_deterministic_tie_break(client):
    for index in range(25):
        session_id = active_session(client, f'top-{index}')
        match = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': f'top:{index}:match'}).json()
        hp = 50 + index
        score = 1500 + hp
        title = 'CHAMPION' if hp < 75 else 'UNTOUCHABLE'
        response = client.post(f"/api/v1/matches/{match['id']}/finish", json=finish_payload(f'top:{index}:finish', score, title, hp, 0))
        assert response.status_code == 200
        assert client.post(f'/api/v1/sessions/{session_id}/finish', json={'client_request_id': f'top:{index}:session-finish'}).status_code == 200
    rows = client.get('/api/v1/leaderboard').json()
    assert len(rows) == 20 and [row['rank'] for row in rows] == list(range(1, 21))

    ids = []
    for index in range(3):
        session_id = active_session(client, f'tie-{index}')
        match = client.post('/api/v1/matches', json={'session_id': session_id, 'client_request_id': f'tie:{index}:match'}).json()
        payload = finish_payload(f'tie:{index}:finish', 1880, 'UNTOUCHABLE')
        assert client.post(f"/api/v1/matches/{match['id']}/finish", json=payload).status_code == 200
        ids.append(match['id'])
        client.post(f'/api/v1/sessions/{session_id}/finish', json={'client_request_id': f'tie:{index}:session-finish'})
    from app.services.leaderboard import refresh_ranks
    with client.app.state.connect() as connection:
        for match_id, hp, combo, finished_at in zip(ids, (80, 80, 70), (1, 0, 5), ('2020-01-01T00:00:02+00:00', '2020-01-01T00:00:01+00:00', '2020-01-01T00:00:00+00:00')):
            connection.execute('UPDATE matches SET score=2000, remaining_hp=?, max_combo=?, finished_at=? WHERE id=?', (hp, combo, finished_at, match_id))
        refresh_ranks(connection)
    ordered = [row['match_id'] for row in client.get('/api/v1/leaderboard?limit=100').json() if row['match_id'] in ids]
    assert ordered == [ids[0], ids[1], ids[2]]
