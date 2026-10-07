# ROG Future Gamer 2026 - Experience 2 Web 2D Fighting Game

Browser-based 2D fighting game framework built with **Vite + TypeScript + Phaser**.

The current goal is not to finish the final game art or content. The project is building a stable framework so formal UI, character sprites, VFX, audio, backend data, ranking, and ComfyUI-generated assets can be integrated later without rewriting the core application flow.

## Current Status

Current repository baseline:

- D1 framework foundation: implemented
- D2 UI framework scaffolding: implemented, but still requires hardening / acceptance closure
- D3 production input + 24Hz game clock: not started
- Combat core: not started
- FastAPI / SQLite: not started
- ComfyUI result integration: not started

### Implemented now

- Vite + TypeScript application shell
- Phaser 3 renderer
- 1920x1080 logical game resolution
- `AppStateMachine`
- Explicit P0-P7 experience states
- Replay / Finish state contracts
- Placeholder rendering
- `ScreenSubState`
- `FocusManager`
- `NavigationManager`
- typed `UIEventBus`
- placeholder UI components:
  - Button
  - Modal
  - Progress
  - RankingRow
- DEV-only keyboard / screen-state verification harness
- Vitest coverage for the top-level `AppStateMachine`

## Experience Flow

```text
P0_IDLE
  ↓
P1_READY
  ↓
P2_SETUP
  ↓
P3_LOADING
  ↓
P4_BATTLE
  ↓
P5_PRESENTATION
  ↓
P6_RESULT
  ↓
P7_END
  ├─ Replay → P2_SETUP
  └─ Finish → P0_IDLE
```

P0-P7 are **application states**, not one-Phaser-Scene-per-page lifecycle states.

`AppStateMachine` is the top-level source of truth.

## Architecture

```text
Browser
│
├─ Vite + TypeScript
│
├─ Phaser
│   ├─ BootScene
│   └─ AppScene
│
├─ Application State
│   ├─ AppState
│   ├─ AppStateMachine
│   └─ appStateTransitions
│
└─ UI Framework
    ├─ ScreenSubState
    ├─ FocusManager
    ├─ NavigationManager
    ├─ UIEventBus
    └─ Components
        ├─ Button
        ├─ Modal
        ├─ Progress
        └─ RankingRow
```

Current startup composition:

```text
main.ts
  ↓
AppStateMachine
  +
UIFramework
  ↓
Phaser GameConfig
  ↓
BootScene
  ↓
AppScene
```

The intended architecture rule is:

```text
Domain / App State
        ↓
UI / View State
        ↓
Phaser Rendering
```

Phaser should render the state, not become the owner of business/application flow.

## Application States

| State | Meaning |
| --- | --- |
| `P0_IDLE` | Idle / initial screen |
| `P1_READY` | Ready / processing entry |
| `P2_SETUP` | Player/game setup |
| `P3_LOADING` | Loading |
| `P4_BATTLE` | Battle |
| `P5_PRESENTATION` | Post-battle presentation |
| `P6_RESULT` | Result |
| `P7_END` | End / Replay / Finish |

## Current Screen Sub-States

### P0

```text
EMPTY
RECORDS_1_TO_4
RECORDS_5_PLUS
```

### P1

```text
READY
PROCESSING
FALLBACK
```

### P4

```text
NORMAL
COMBO
DANGER
LAST_10_SECONDS
```

These are currently UI-state contracts only. Combat does not drive them yet.

### P6

```text
RANK_1_TO_6
RANK_7_TO_19
RANK_20
NOT_RANKED
```

Ranking data is mock/display-only at the current stage.

## Development Environment

### Requirements

Because the project currently uses Vite 8, use:

```text
Node.js 20.19+
or
Node.js 22.12+
```

Use npm as the package manager.

### Install

```bash
npm install
```

### Start development server

```bash
npm run dev
```

### Type check

```bash
npm run typecheck
```

### Run tests

```bash
npm test
```

### Production build

```bash
npm run build
```

`npm run build` currently runs TypeScript type checking before the Vite production build.

## Technology Stack

| Layer | Current / Planned Technology |
| --- | --- |
| Front-end | Vite + TypeScript |
| Renderer / Game Engine | Phaser 3 |
| TypeScript mode | Strict |
| Unit Testing | Vitest |
| Logical Display | 1920x1080 |
| Planned Game Logic | 24Hz fixed step |
| Planned Sprite Animation | 24fps |
| Planned Backend | FastAPI |
| Planned Database | SQLite |
| Planned AI Asset Flow | Completed ComfyUI results consumed externally |

## Current Source Layout

```text
src/
├─ main.ts
├─ style.css
└─ game/
   ├─ config/
   │  └─ gameConfig.ts
   ├─ scenes/
   │  ├─ BootScene.ts
   │  └─ AppScene.ts
   ├─ state/
   │  ├─ AppState.ts
   │  ├─ AppStateMachine.ts
   │  ├─ AppStateMachine.test.ts
   │  └─ appStateTransitions.ts
   └─ ui/
      ├─ UIFramework.ts
      ├─ ScreenSubState.ts
      ├─ FocusManager.ts
      ├─ NavigationManager.ts
      ├─ UIEventBus.ts
      └─ Components.ts
```

## DEV Harness

The current `AppScene` contains development-only controls for framework verification.

Current visible debug behavior includes:

- `Esc`: toggle Home / Pause overlay
- `Arrow Up`: focus previous item
- `Arrow Down`: focus next item
- `1`: set P0 to `RECORDS_1_TO_4`
- `2`: set P0 to `RECORDS_5_PLUS`
- `3`: set P1 to `PROCESSING`
- `4`: set P6 to `RANK_1_TO_6`

These controls are temporary verification tools.

They must **not** become the production `InputManager`.

## D2 Known Gaps Before D3

The repository already contains the D2 module skeletons, but the following should be closed before production input/game timing is added:

1. Add independent unit tests for:
   - `ScreenSubState`
   - `FocusManager`
   - `NavigationManager`
   - `UIEventBus`

2. Harden focus lifecycle:
   - prevent stale focus registrations when screens re-render/change
   - support deterministic cleanup of focus groups
   - verify disabled-item behavior
   - ensure only live controls can receive focus

3. Complete semantic activation:
   - `CONFIRM` should activate the currently focused control through the UI/navigation layer
   - UI controls should not need to bypass the navigation architecture

4. Bind focus state to rendering:
   - visible buttons should reflect focused/unfocused state

5. Preserve state ownership:
   - `NavigationManager` may request transitions
   - `AppStateMachine` remains the transition source of truth

Until these gates pass, D2 should be treated as **scaffolded but not fully accepted**.

## Next Milestones

### Immediate next change: D2 Hardening

Close the UI framework lifecycle and test gaps listed above.

### D3: Production Input + Fixed-Step Clock

After D2 hardening:

```text
Keyboard ──────┐
Gamepad ───────┼→ InputManager → Semantic Actions
Arcade Stick ──┘

requestAnimationFrame
        ↓
Accumulator
        ↓
24Hz GameClock
        ↓
Future Gameplay Tick
```

D3 should establish:

- production `InputManager`
- Keyboard / Gamepad / Arcade Stick abstraction
- semantic UI/game actions
- 24Hz fixed-step clock
- pause/resume contract
- deterministic tick testing

It should **not** implement combat yet.

## Future Roadmap

```text
D1  Framework / AppState
D2  UIUX / SubState / Focus / Navigation
D3  Input / 24Hz GameClock
D4  Combat Core
D5  Complete Mock Game
D6  FastAPI / SQLite
D7  Player / Session / Queue
D8  Match / Score / Ranking
D9  Comfy Result / Asset Ready
D10 End-to-End / Error / Recovery
```

## OpenSpec

Project-level OpenSpec configuration belongs at:

```text
openspec/config.yaml
```

Recommended change workflow:

```text
proposal
  ↓
specs
  ↓
design
  ↓
tasks
  ↓
apply
  ↓
verify
  ↓
archive
```

Before applying a change:

1. inspect the current repository;
2. preserve existing accepted behavior;
3. make scope explicit;
4. run tests/typecheck/build before considering the change complete.

## Current Non-Goals

The current repository should not yet contain production implementations of:

- combat
- hitbox / hurtbox
- HP / combo / round rules
- enemy AI
- FastAPI
- SQLite
- ranking backend
- ComfyUI workflow execution
- final character assets
- final VFX
- final audio
