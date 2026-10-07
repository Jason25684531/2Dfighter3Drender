def player(client, key='player'):
    return client.post('/api/v1/players', json={'nickname': key, 'language': 'zh-TW', 'client_request_id': key}).json()


def session(client, player_id, key='session'):
    return client.post('/api/v1/sessions', json={'player_id': player_id, 'client_request_id': key})


def test_player_and_session_idempotency(client):
    first = client.post('/api/v1/players', json={'nickname': 'P', 'language': 'en', 'client_request_id': 'p1'})
    assert first.status_code == 201
    assert client.post('/api/v1/players', json={'nickname': 'P', 'language': 'en', 'client_request_id': 'p1'}).status_code == 200
    assert client.post('/api/v1/players', json={'nickname': 'X', 'language': 'en', 'client_request_id': 'p1'}).status_code == 409
    created = session(client, first.json()['id'])
    assert created.status_code == 201 and created.json()['status'] == 'QUEUED'
    assert client.get('/api/v1/players/999').json()['error']['code'] == 'PLAYER_NOT_FOUND'


def test_queue_lifecycle(client):
    a, b = player(client, 'a'), player(client, 'b')
    first, second = session(client, a['id'], 'sa'), session(client, b['id'], 'sb')
    assert [row['id'] for row in client.get('/api/v1/queue').json()] == [first.json()['id'], second.json()['id']]
    active = client.post('/api/v1/queue/activate-next', json={'client_request_id': 'activate'}).json()
    assert active['id'] == first.json()['id'] and active['status'] == 'ACTIVE'
    assert client.post('/api/v1/queue/activate-next', json={'client_request_id': 'activate'}).json()['id'] == active['id']
    assert client.post(f"/api/v1/sessions/{active['id']}/finish", json={'client_request_id': 'finish'}).json()['status'] == 'FINISHED'
    assert client.post('/api/v1/queue/activate-next', json={'client_request_id': 'activate2'}).json()['id'] == second.json()['id']


def test_session_mutation_request_ids_are_replayable_and_conflicts_are_rejected(client):
    created_player = player(client, 'mutation-player')
    created_session = session(client, created_player['id'], 'mutation-session')
    session_id = created_session.json()['id']
    first = client.patch(f'/api/v1/sessions/{session_id}', json={'selected_character': 'A', 'client_request_id': 'mutation:update'})
    assert first.status_code == 200
    assert client.patch(f'/api/v1/sessions/{session_id}', json={'selected_character': 'A', 'client_request_id': 'mutation:update'}).status_code == 200
    conflict = client.patch(f'/api/v1/sessions/{session_id}', json={'selected_character': 'B', 'client_request_id': 'mutation:update'})
    assert conflict.status_code == 409 and conflict.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
