# ROG Future Gamer 2026 — Experience 2

瀏覽器 2D 格鬥遊戲框架，技術棧為 Vite、TypeScript、Phaser 3、FastAPI 與 SQLite。邏輯解析度是 1920×1080，目標是展場（kiosk）單機遊玩。

## 現況

| 範圍 | 狀態 |
|---|---|
| P0–P7 流程、Replay、Finish、焦點導覽 | 已完成 |
| 鍵盤／手把語意輸入、24Hz 固定步時鐘、戰鬥、回合、敵方 AI、本地結算 | 已完成 |
| FastAPI／SQLite：玩家、session、排隊、對戰、回合、計分、排行榜 | 已完成 |
| Concept A Cyber Arena 視覺（P0–P7 與 ESC 選單），含 OFL 字型、Canvas 後備、減少動態 | 已完成 |
| 命中／防禦特效（暫用素材）、Announcer 播報、回合結束 K.O.／TIME UP | 已完成 |
| 正式美術與特效、音效、ComfyUI 生成角色串接、P3 真實載入 | 尚未開始（D9） |

已上線的玩法細節：

- P0 有【排行榜】按鈕，開啟 Top 10 覆蓋面板，離線時顯示提示。
- P1 角色格分成三區：CUSTOMIZE（01–04）、OFFICERS（05–10）、ROSTER（11–40）。
- 1P 模式在 P1 選角頁一次完成：鎖定角色 → 紫色 CPU 游標選對手 → ← → 選難度（EASY／NORMAL／HARD）→ 確認。P2 一律只選場景。選對手時 2P 按 ENTER 加入，會捨棄 CPU 選擇改為雙人選角。
- 戰鬥是單一水平軸（已移除 2.5D 縱深）：W 跳、S 蹲。四種攻擊（F／U／G／I）傷害相同，輕重只影響動畫與特效大小。
- 命中時在接觸點播放爆炸特效（重拳重腳較大），防禦成功播放藍色波紋，弧面朝向攻擊者。
- 播報統一由 Announcer 顯示：ROUND n → READY?（只第 1 回合）→ FIGHT!；回合結束先停約 1.5 秒顯示 K.O.／TIME UP，再顯示上一回合 YOU WIN／YOU LOSE／DRAW；最後一回合直接進 P5，用同一元件顯示結束方式與勝負。
- AI 難度參數集中在 `src/game/config/aiProfiles.ts`，敵方會輪替四種攻擊。

## 系統架構

### 分層圖

```text
┌─────────────────────────── 輸入層 ───────────────────────────┐
│ 鍵盤 / 手把 ──▶ InputManager ──▶ 語意動作（UI 動作、戰鬥動作）│
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────── 呈現層（Phaser，只畫不決定）──────────────┐
│ BootScene（預載素材、特效）──▶ AppScene（P0–P7、HUD、Announcer）│
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
| 輸入 | `input/ControlProfile` | 戰鬥鍵位設定與儲存（P0 按 C 開啟，`exp2.controls.v2`） | 選單鍵位 |
| 流程 | `state/AppStateMachine` | P0–P7 狀態與合法轉移，唯一真相 | 任何副作用 |
| 流程 | `ui/UIFramework` | 畫面子狀態、焦點群組、導覽、UI 事件 | 畫面繪製 |
| 流程 | `app/ExperienceFlow` | 轉移時建立／結束 session、開始／重置對戰、寫入後端、結算 | 畫面繪製、輸入 |
| 玩法 | `time/GameClock` | 24Hz 固定步，可暫停 | 畫面幀率 |
| 玩法 | `match/MatchController` | 回合、三戰兩勝、平局重打、起手序列、回合結束播報停留（快照的 `announce`） | 呈現 |
| 玩法 | `combat/CombatWorld` | 水平移動、跳躍、攻擊種類與判定、傷害、命中接觸點，tick 決定性 | 動畫、特效 |
| 玩法 | `match/EnemyAI` | 依難度 profile 產生敵方意圖 | 數值平衡以外的事 |
| 資料 | `app/ExperiencePersistence` | 依序寫入、冪等重送、失敗寫入在結算前重送 | 計分與排名（由後端決定） |
| 資料 | `api/ApiClient` | HTTP 邊界 | 重試策略 |
| 呈現 | `scenes/AppScene` | 依狀態繪製 P0–P7、HUD、橫幅、面板、開頭影片 | 流程規則、後端規則 |
| 流程 | `select/P1SelectionModel` | 1P／2P 選角、自訂拍照、單人的 CPU 對手與難度 | 畫面繪製 |
| 呈現 | `ui/*` | 元件（含 `Announcer`）、view model（含播報訊息表）、tokens、P1 選角畫面、舞台視差 | 狀態轉移 |
| 呈現 | `ui/vfx/ImpactFx` | 命中／防禦特效的素材表、尺寸與方向規則、一次性播放 | 戰鬥判定 |

設計原則：

- Phaser 只是呈現殼。流程、戰鬥與資料規則都在純 TS，可以不開瀏覽器測試。
- 同一條規則只寫一次。轉移副作用只在 `ExperienceFlow`，測試驅動的也是同一份。
- 戰鬥刻意不用 Arcade Physics，以維持 24Hz tick 決定性。

## 遊戲流程

### 狀態表

| 狀態 | 畫面 | 子狀態 | 主要動作 | 進入時的副作用 |
|---|---|---|---|---|
| P0_IDLE | 標題 | EMPTY 等 | 開始、排行榜、P 開頭影片、C 操作設定 | 結束 session、清除選擇 |
| P1_READY | 選角（1P／2P、自訂身體拍照、1P 選 CPU 對手與難度） | READY／CUSTOMIZE／REVIEW／PROCESSING／FALLBACK | 選角、選對手與難度、加入 2P | 建立 session |
| P2_SETUP | 選場景 | DEFAULT | 選場景 | 重置對戰 |
| P3_LOADING | VS 與操作說明 | DEFAULT | 確認 FIGHT! | 無 |
| P4_BATTLE | 戰鬥（含回合 K.O.／TIME UP 停留） | NORMAL／COMBO／DANGER／LAST_10_SECONDS | 戰鬥、ESC 暫停 | 開始對戰、建立後端 match |
| P5_PRESENTATION | K.O.／TIME UP／DRAW 與勝負 | DEFAULT | 查看結算 | 結果已送出 |
| P6_RESULT | 結算與排行 | RANK_1_TO_6 等 | 繼續 | 無 |
| P7_END | 再玩一次？ | DEFAULT | Replay、Finish | 無 |

正常流程：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。Replay 回到 P2（沿用角色、對手與難度，只重選場景），Finish 回到 P0。

### 返回與離開

| 目前狀態 | BACK／ESC 的結果 |
|---|---|
| P0 | 無作用 |
| P1 | 自訂中先確認放棄，否則回 P0。1P 的 K：難度 → 對手 → 解除自己的鎖定 |
| P2 | 回 P1 |
| P3、P5、P6 | 回 P0 並結束 session |
| P4 | 開啟暫停選單；選 EXIT 並確認後回 P0 |
| P7 | 無作用，用 Replay 或 Finish |

閒置逾時：P0 30 秒播開頭影片；P1 選角與選對手 60 秒、自訂 90 秒；P7 30 秒回 P0。其他畫面靠 ESC 離開。

### 操作

| 情境 | 1P | 2P |
|---|---|---|
| 選單／選角 | W A S D 移動 · J 確認 · K 返回 | 方向鍵 · ENTER 加入／確認 · BACKSPACE 返回 |
| 選 CPU 對手（單人） | W A S D 移動 CPU 游標 · J 確認；難度用 A D | 按 ENTER 改為雙人 |
| 戰鬥 | A D 移動 · W 跳 · S 蹲 · F 輕拳 · U 重拳 · G 輕腳 · I 重腳 · K 防禦 · ESC 暫停 | 由 CPU 控制，選角只決定外觀 |
| 手把 | 十字鍵移動 · A 或 ↑ 跳 · ↓ 蹲 · X Y 拳 · LB RB 腳 · RT 防禦 · START 暫停 | — |

戰鬥鍵可在 P0 按 C 重新綁定，存在 `localStorage` 的 `exp2.controls.v2`；舊版 `v1` 存檔會被忽略並使用預設。

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
| `public/test-assets` | 暫用舞台、角色、特效（`vfx/`）、開頭影片素材；不進 git |
| `assest/VFX` | 特效原始產出（`hit-impact-fx`、`guard-impact-fx`），取 `sheet-transparent.png` 複製到 `public/test-assets/vfx/` |
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

### 本機啟動與實機驗證

```bash
# 後端（可省略；離線時流程照常、只是不記成績）
venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --port 8000
# 前端：Playwright 腳本預設連 5189
npx vite --port 5189 --host 127.0.0.1
```

| 網址 | 內容 |
|---|---|
| `http://127.0.0.1:5189/` | 正式流程 P0–P7 |
| `http://127.0.0.1:5189/prototype.html` | 隔離原型，不寫入 API |
| `http://127.0.0.1:5189/?inputDebug=1` | P4 顯示按鍵 → 語意 → 呈現的診斷面板 |

Playwright 腳本在前端啟動後執行，截圖輸出到 `outputs/*-verification/`：

| 腳本 | 驗證範圍 |
|---|---|
| `scripts/verify-opponent-flow.mjs` | 排行榜、1P 選對手與難度、P2 只選場景、Announcer、命中／防禦特效、回合 K.O. 停留、P5、Replay |
| `scripts/verify-controls.mjs` | 改鍵、衝突、重設、存檔 v2、四種攻擊的站立／空中／蹲姿圖、W 跳 S 蹲、推擠、鏡頭 |
| `scripts/verify-p1.mjs` | 選角格、雙人、自訂拍照、單人選對手、閒置逾時、離線 |
| `scripts/verify-experience.mjs` | P0–P4 完整流程、相機、舞台後備 |
| `scripts/verify-kevin.mjs` | Kevin 圖集與呈現投影 |
| `scripts/verify-prototype.mjs` | 原型流程、共用 HUD、暫停、減少動態 |

## Roadmap

| 階段 | 內容 | 狀態 |
|---|---|---|
| D1–D2 | 框架、狀態機、UI 導覽 | 完成 |
| D3–D5 | 輸入、時鐘、戰鬥、模擬對戰 | 完成 |
| D6–D8 | 後端整合 | 完成 |
| 現在 | 整合強化與視覺檢視 | 進行中 |
| D9 | ComfyUI 生成結果串接、P3 真實載入、正式素材 | 延後 |
