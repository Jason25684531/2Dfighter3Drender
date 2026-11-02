# ROG Future Gamer 2026 — Experience 2

瀏覽器 2D 格鬥遊戲框架，技術棧為 Vite、TypeScript、Phaser 3、FastAPI 與 SQLite。邏輯解析度是 1920×1080，目標是展場（kiosk）單機遊玩。

## 現況

| 範圍 | 狀態 |
|---|---|
| P0–P7 流程、Replay、Finish、焦點導覽 | 已完成 |
| 鍵盤／手把語意輸入、24Hz 固定步時鐘、戰鬥、回合、敵方 AI、本地結算 | 已完成 |
| FastAPI／SQLite：玩家、session、排隊、對戰、回合、計分、排行榜 | 已完成 |
| Concept A Cyber Arena 視覺（P0–P7 與 ESC 選單），含 OFL 字型、Canvas 後備、減少動態 | 已完成 |
| 正式美術、VFX、音效、ComfyUI 生成角色串接、P3 真實載入 | 尚未開始（D9） |

已上線的玩法細節：

- P0 有【排行榜】按鈕，開啟 Top 10 覆蓋面板，離線時顯示提示。
- P1 角色格分成三區：CUSTOMIZE（01–04）、OFFICERS（05–10）、ROSTER（11–40）。
- 1P 模式在 P2 先選對手與難度（EASY／NORMAL／HARD），再選場景。2P 模式直接選場景。
- 每回合起手為 ROUND → READY? → FIGHT!，期間戰鬥凍結。第 2 回合起會先顯示上一回合結果（ROUND n WIN／LOSE／DRAW）。
- AI 難度參數集中在 `src/game/config/aiProfiles.ts`。

## 系統架構

### 分層圖

```text
┌─────────────────────────── 輸入層 ───────────────────────────┐
│ 鍵盤 / 手把 ──▶ InputManager ──▶ 語意動作（UI 動作、戰鬥動作）│
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────── 呈現層（Phaser，只畫不決定）──────────────┐
│ BootScene（預載素材） ──▶ AppScene（P0–P7 畫面、HUD、面板）    │
└──────────────┬──────────────────────────────▲────────────────┘
       UI 動作 │                     狀態變化 │ snapshot
               ▼                              │
┌──────────────────── 流程層（純 TypeScript）───────────────────┐
│ UIFramework：子狀態 / 焦點 / 導覽 / 事件                       │
│ AppStateMachine：P0–P7 唯一真相                                │
│ ExperienceFlow：轉移副作用與對戰推進的唯一實作                 │
└──────────────┬──────────────────────────────┬────────────────┘
               ▼                              ▼
┌──────── 玩法層（純 TypeScript）────────┐ ┌──── 資料層 ─────────────────────┐
│ GameClock（24Hz）                      │ │ ExperiencePersistence           │
│  └▶ MatchController（回合、起手序列）  │ │  （有序佇列、冪等請求 ID、重送）│
│      ├▶ CombatWorld（AABB、決定性）    │ │  └▶ ApiClient                   │
│      └▶ EnemyAI（難度 profile）        │ │      └▶ FastAPI ──▶ SQLite      │
└────────────────────────────────────────┘ └─────────────────────────────────┘
```

### 模組職責

| 層 | 模組 | 職責 | 不負責 |
|---|---|---|---|
| 輸入 | `input/InputManager` | 實體鍵與手把轉成語意動作，P1／P2 鍵位分離 | 判斷目前在哪個畫面 |
| 輸入 | `input/ControlProfile` | 戰鬥鍵位設定與儲存（P0 按 C 開啟） | 選單鍵位 |
| 流程 | `state/AppStateMachine` | P0–P7 狀態與合法轉移，唯一真相 | 任何副作用 |
| 流程 | `ui/UIFramework` | 畫面子狀態、焦點群組、導覽、UI 事件 | 畫面繪製 |
| 流程 | `app/ExperienceFlow` | 轉移時建立／結束 session、開始／重置對戰、寫入後端、結算 | 畫面繪製、輸入 |
| 玩法 | `time/GameClock` | 24Hz 固定步，可暫停 | 畫面幀率 |
| 玩法 | `match/MatchController` | 回合、三戰兩勝、平局重打、起手序列 | 呈現 |
| 玩法 | `combat/CombatWorld` | 移動、跳躍、攻擊判定、傷害，tick 決定性 | 動畫 |
| 玩法 | `match/EnemyAI` | 依難度 profile 產生敵方意圖 | 數值平衡以外的事 |
| 資料 | `app/ExperiencePersistence` | 依序寫入、冪等重送、失敗寫入在結算前重送 | 計分與排名（由後端決定） |
| 資料 | `api/ApiClient` | HTTP 邊界 | 重試策略 |
| 呈現 | `scenes/AppScene` | 依狀態繪製 P0–P7、HUD、橫幅、面板、開頭影片 | 流程規則、後端規則 |
| 呈現 | `ui/*` | 元件、view model、tokens、P1 選角畫面、舞台視差 | 狀態轉移 |

設計原則：

- Phaser 只是呈現殼。流程、戰鬥與資料規則都在純 TS，可以不開瀏覽器測試。
- 同一條規則只寫一次。轉移副作用只在 `ExperienceFlow`，測試驅動的也是同一份。
- 戰鬥刻意不用 Arcade Physics，以維持 24Hz tick 決定性。

## 遊戲流程

### 狀態表

| 狀態 | 畫面 | 子狀態 | 主要動作 | 進入時的副作用 |
|---|---|---|---|---|
| P0_IDLE | 標題 | EMPTY 等 | 開始、排行榜、P 開頭影片、C 操作設定 | 結束 session、清除選擇 |
| P1_READY | 選角（1P／2P、自訂身體拍照） | READY／CUSTOMIZE／REVIEW／PROCESSING／FALLBACK | 選角、加入 2P | 建立 session |
| P2_SETUP | 選對手（1P）→ 選場景 | OPPONENT／DEFAULT | 選對手與難度、選場景 | 重置對戰 |
| P3_LOADING | VS 與操作說明 | DEFAULT | 確認 FIGHT! | 無 |
| P4_BATTLE | 戰鬥 | NORMAL／COMBO／DANGER／LAST_10_SECONDS | 戰鬥、ESC 暫停 | 開始對戰、建立後端 match |
| P5_PRESENTATION | KO／TIME UP | DEFAULT | 查看結算 | 結果已送出 |
| P6_RESULT | 結算與排行 | RANK_1_TO_6 等 | 繼續 | 無 |
| P7_END | 再玩一次？ | DEFAULT | Replay、Finish | 無 |

正常流程：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。Replay 回到 P2，Finish 回到 P0。

### 返回與離開

| 目前狀態 | BACK／ESC 的結果 |
|---|---|
| P0 | 無作用 |
| P1 | 自訂中先確認放棄，否則回 P0 |
| P2 | 已選對手先取消；在場景步驟退回選對手；否則回 P1 |
| P3、P5、P6 | 回 P0 並結束 session |
| P4 | 開啟暫停選單；選 EXIT 並確認後回 P0 |
| P7 | 無作用，用 Replay 或 Finish |

閒置逾時：P0 30 秒播開頭影片；P1 選角 60 秒、自訂 90 秒；P7 30 秒回 P0。其他畫面靠 ESC 離開。

## 後端 API

| 資源 | 端點 | 用途 |
|---|---|---|
| 健康檢查 | `GET /health` | 確認服務存活 |
| 玩家 | `POST /players`、`GET /players/{id}` | 建立與查詢玩家 |
| Session | `POST /sessions`、`GET /sessions/current`、`GET /sessions/{id}`、`PATCH /sessions/{id}`、`POST /sessions/{id}/finish`、`POST /sessions/{id}/cancel` | 一位玩家的一次遊玩 |
| 排隊 | `GET /queue`、`POST /queue/activate-next` | 單機排隊 |
| 對戰 | `POST /matches`、`GET /matches/{id}`、`POST /matches/{id}/rounds`、`POST /matches/{id}/finish` | 每次 P4 一筆 match，結算由後端計分排名 |
| 排行榜 | `GET /leaderboard` | 前 N 名 |

所有端點都掛在 `/api/v1` 之下。所有寫入端點都接受 client 請求 ID，重送相同請求不會重複寫入。後端離線時，前端流程照常可玩，只是不記錄成績。

## 專案結構

| 路徑 | 內容 |
|---|---|
| `src/main.ts` | 正式入口：建立狀態機、UIFramework、ExperienceFlow、Phaser |
| `src/prototype.ts`、`prototype.html` | 隔離原型入口，唯一的 DEV 示範介面，不寫入 API |
| `src/game/state`、`input`、`time`、`combat`、`match`、`select` | 流程與玩法規則 |
| `src/game/app`、`api` | 流程編排、持久化、HTTP 邊界 |
| `src/game/ui`、`scenes` | 呈現元件、view model、Phaser 畫面 |
| `src/game/config` | AI 難度、舞台調校 |
| `backend/app` | FastAPI 路由、服務、SQLite schema、計分 |
| `public/test-assets` | 暫用舞台、角色、開頭影片素材 |
| `scripts` | Playwright 實機驗證與素材處理腳本 |
| `docs/architecture` | 系統架構圖、遊戲流程圖與校正說明 |
| `openspec/specs` | 已接受的需求規格 |
| `openspec/changes` | 進行中與已封存的變更 |
| `sample_UIUX` | 視覺參考，不在執行期使用 |

## 開發

需要 Node.js 20.19+ 或 22.12+ 與 npm。後端依賴列在 `backend/requirements.txt`。

```bash
npm install
npm run dev            # 正式入口；原型在 /prototype.html
npm test               # 單元測試
npm run typecheck
npm run build
npm run test:system    # 啟動本機後端並跑整合流程
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests -q
```

本機後端虛擬環境位於 `venv/Scripts/python.exe`。

## Roadmap

| 階段 | 內容 | 狀態 |
|---|---|---|
| D1–D2 | 框架、狀態機、UI 導覽 | 完成 |
| D3–D5 | 輸入、時鐘、戰鬥、模擬對戰 | 完成 |
| D6–D8 | 後端整合 | 完成 |
| 現在 | 整合強化與視覺檢視 | 進行中 |
| D9 | ComfyUI 生成結果串接、P3 真實載入、正式素材 | 延後 |
