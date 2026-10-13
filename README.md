# ROG Future Gamer 2026 — Experience 2

Browser-based 2D fighting game framework using Vite, TypeScript, Phaser 3, FastAPI, and SQLite. The logical display is 1920×1080.

## Current status

- P0–P7 application flow, replay, finish, focus/navigation, and DEV showcase are implemented.
- Semantic keyboard/gamepad input, a 24Hz fixed-step clock, combat, rounds, enemy AI, and local result resolution are implemented.
- FastAPI/SQLite player, session, queue, match, round, score, and leaderboard paths are implemented.
- Current UI uses supplied stage media, sample WebM, and temporary fighter sprites. Final art, VFX, audio, and ComfyUI result integration remain future work.
- The current OpenSpec change `fix-match-persistence-lifecycle` hardens one-match-per-attempt persistence and save failure reporting.

## System ownership

```text
Keyboard / gamepad → InputManager → semantic actions
                                  ↓
AppStateMachine → P0–P7 flow   GameClock (24Hz) → MatchController → CombatWorld
       ↓                                                     ↓
UIFramework (substate, focus, navigation)          snapshots / result
       └───────────────────────┬─────────────────────────────┘
                               ↓
                        AppScene / Phaser
                               ↓
                    ExperiencePersistence → ApiClient → FastAPI / SQLite
```

`AppStateMachine` is the top-level flow authority. Combat and match rules live outside Phaser. `AppScene` renders state, routes input, and initiates persistence calls; it does not own backend rank or scoring rules. Persistence state (`IDLE`, `SAVING`, `SAVED`, `ERROR`) is separate from P0–P7.

The normal flow is P0 Idle → P1 Ready → P2 Setup → P3 Loading → P4 Battle → P5 Presentation → P6 Result → P7 End. Replay returns to P2; Finish returns to P0. P1 establishes a session; each P4 play attempt creates its own match. Backend writes are ordered and use stable request IDs for retry.

## Development

Use Node.js 20.19+ or 22.12+ and npm. Python backend dependencies are listed in `backend/requirements.txt`.

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run test:system
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests -q
```

`npm run test:system` starts a local backend and runs the integration path. In this workspace, the backend virtual environment is at `venv/Scripts/python.exe`.

## Project layout

- `src/game/state`, `input`, `time`, `combat`, `match`: application and gameplay authorities.
- `src/game/app`, `api`: client context, persistence, and HTTP boundary.
- `src/game/ui`, `scenes`: presentation models, components, assets, and Phaser screens.
- `backend/app`: FastAPI routes, services, SQLite schema, and scoring.
- `openspec/specs`: accepted requirements; `openspec/changes`: active and archived changes.
- `sample_UIUX`: visual references, not runtime UI.

## Roadmap

D1–D8 cover framework, navigation, input/clock, combat, mock game, and backend integration. Current work is integration hardening and visual review. D9 ComfyUI result/asset readiness and final production media remain deferred.
