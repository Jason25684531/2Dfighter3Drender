# ROG Future Gamer 2026 — Experience 2

## ComfyUI 角色生成

本機需啟動 FastAPI、Vite 和 `127.0.0.1:8188` 的 ComfyUI，並保留 `ComfyUI_API/2026_Taskforce_2028_FTG_Final_CAM_261115.json` 及其自訂節點、模型與模板素材。工作流檔可直接放 ComfyUI 存出的 UI 格式，後端送單前自動轉成 API 格式；節點對應見 `docs/Taskforce 2028 FTG_README_交接說明.md`（#1 模板、#2 名稱、#3 照片）。後端可用 `COMFYUI_URL` 和 `COMFYUI_OUTPUT` 環境變數調整服務位址及 ComfyUI output 目錄。前端 API 位址使用 `VITE_API_BASE_URL`；不同來源須設置後端 `EXP2_CORS_ORIGINS`。

選擇身體後，可拍照並確認生成；鍵盤輕踢或手把輕拳可跳過拍照。拍攝照片會上傳至 ComfyUI，並交由工作流使用的外部生成服務處理。照片以相機原生解析度、與預覽相同的鏡像方向上傳。載入畫面等待所有已提交的角色；失敗時可重試或返回。輸出位於 ComfyUI 原生資料夾 `taskforce_2028_ftg/<玩家名稱>_<模板代號>/`（1=S1AW、2=S2AM、3=S1AM、4=S3WW），遊戲讀 `manifest/game_manifest.json` 與 `Sprite_Sheet_reference_aligned/`；同名同模板會覆寫。任務狀態保存在後端程序記憶體，後端重啟後需重新提交；ComfyUI 輸入照片和輸出檔不會自動刪除。

P3 是練習場：生成與素材載入期間，玩家可在舞台上用戰鬥鍵自由練習（生成中先用所選身形，完成後自動換成生成角色；單人時對手是不出招的木樁，雙人時由 2P 操作；不計分，回合結束自動重開）。全部完成後才能按 FIGHT! 進入正式對戰：F、Enter、手把 ✕ 或 START 都可以開戰；完成前按 F 或手把 ✕ 只會出招。拍照時輸入名字後按 Enter 離開名字框，再按 Enter／F／手把 □ 或 START 拍照；照片若幾乎沒有細節（鏡頭被遮住、沒拍到人），確認頁會提醒重拍。

### 展場電腦：關閉 ComfyUI 視窗的「快速編輯模式」

ComfyUI 的 cmd 視窗被滑鼠點到時，Windows 會進入「選取」模式（標題列出現「選取」），ComfyUI 停止輸出、整個卡住，遊戲端會一直顯示生成中。臨時解法：點一下該視窗後按 Esc 或 Enter。永久關閉：

1. 在 ComfyUI 的 cmd 視窗標題列按右鍵 →「內容」（Windows Terminal 則是「設定」→ 預設值 → 進階）。
2. 「選項」分頁取消勾選「快速編輯模式」與「插入模式」→ 確定。
3. 對所有新開的 cmd 視窗一次生效（以 Windows 使用者身分執行一次）：`reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f`，之後重新開啟 `run_nvidia_gpu.bat`。

確認方式：在視窗內點一下，標題列不再出現「選取」。

瀏覽器 2D 格鬥遊戲框架，技術棧為 Vite、TypeScript、Phaser 3、FastAPI 與 SQLite。邏輯解析度是 1920×1080，目標是展場（kiosk）單機遊玩。

## 現況

| 範圍 | 狀態 |
|---|---|
| P0–P7 流程、Replay、Finish、焦點導覽 | 已完成 |
| 鍵盤／手把語意輸入、24Hz 固定步時鐘、戰鬥、回合、敵方 AI、本地結算 | 已完成 |
| FastAPI／SQLite：玩家、session、排隊、對戰、回合、計分、排行榜 | 已完成 |
| Concept A Cyber Arena 視覺（P0–P7 與 ESC 選單），含 OFL 字型、Canvas 後備、減少動態 | 已完成 |
| 命中／防禦特效（暫用素材）、Announcer 播報、回合結束 K.O.／TIME UP | 已完成 |
| 已提供的 UI、戰鬥、播報與環境音效 | 已接入（缺檔時靜默） |
| 正式美術與特效、ComfyUI 生成角色串接、P3 真實載入 | 尚未開始（D9） |

已上線的玩法細節：

- P0 有【排行榜】按鈕，開啟 Top 10 覆蓋面板，離線時顯示提示。
- P1 選角顯示化身鬥士（01–04）、ROG SAGA 英雄（05–06）、特邀鬥士（07–10）及參戰者名錄（11–30，最多顯示最新 20 位已生成角色；更舊的仍留在 ComfyUI 輸出資料夾，可用右鍵／R2 刪除）。安裝 Pillow 後可執行 `python scripts/prepare-ui-vfx-assets.py` 重建遊戲用切片和特效。正式字型可放在 `public/fonts/rog-fonts.woff2` 和 `public/fonts/trade-gothic-bdcn.woff2`。
- 1P 模式在 P1 選角頁一次完成：鎖定角色 → 紫色 CPU 游標選對手 → 選難度（EASY／NORMAL／HARD／EXTRA HARD／地獄模式）→ 確認。P2 一律只選場景。選對手時 2P 按自己的確認鍵（預設 NUM 1）加入，會改為雙人選角。雙人對戰以 1P 的結果計入排行榜。
- 戰鬥是單一水平軸（已移除 2.5D 縱深）：W 跳、S 蹲。四種攻擊（F／U／G／I）傷害相同，輕重只影響動畫與特效大小。
- 命中時在接觸點播放爆炸特效（重拳重腳較大），防禦成功播放藍色波紋，弧面朝向攻擊者。
- 播報統一由 Announcer 顯示：ROUND n → READY?（只第 1 回合）→ FIGHT!；回合結束先停約 1.5 秒顯示 K.O.／TIME UP，再顯示上一回合 YOU WIN／YOU LOSE／DRAW；最後一回合直接進 P5，用同一元件顯示結束方式與勝負。
- AI 難度參數集中在 `src/game/config/aiProfiles.ts`，敵方會輪替四種攻擊。
- EASY、NORMAL、HARD 和雙人對戰採用原計分公式。EXTRA HARD 和地獄模式分別乘以 1.2 和 1.4，再無條件捨去小數。
- 在 `src/game/config/hitTuning.ts` 的 `HIT_TUNING.edge` 可調整每招的 Alpha 輪廓外推距離（遊戲座標 px）。輕拳、重拳預設 10，輕踢、重踢預設 7.5。站姿、蹲姿和空中版本共用對應招式設定。

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
| 輸入 | `input/ControlProfile` | 戰鬥鍵位設定與儲存（P0 按 C 開啟，`exp2.controls.v3`），鍵盤與手把共用的改鍵狀態機 | 選單鍵位 |
| 輸入 | `input/GamepadProfile` | 手把所有權（依 `Gamepad.index`）、遲滯取樣、手把鍵位與儲存（`exp2.gamepad.v1`） | 判斷目前在哪個畫面 |
| 流程 | `state/AppStateMachine` | P0–P7 狀態與合法轉移，唯一真相 | 任何副作用 |
| 流程 | `ui/UIFramework` | 畫面子狀態、焦點群組、導覽、UI 事件 | 畫面繪製 |
| 流程 | `app/ExperienceFlow` | 轉移時建立／結束 session、開始／重置對戰、寫入後端、結算 | 畫面繪製、輸入 |
| 玩法 | `time/GameClock` | 24Hz 固定步，可暫停 | 畫面幀率 |
| 玩法 | `match/MatchController` | 回合、三戰兩勝、平局重打、起手序列、回合結束播報停留（快照的 `announce`） | 呈現 |
| 玩法 | `combat/CombatWorld` | 水平移動、跳躍、攻擊種類與判定、傷害、命中接觸點，tick 決定性 | 動畫、特效 |
| 玩法 | `match/EnemyAI` | 依難度 profile 產生敵方意圖 | 數值平衡以外的事 |
| 資料 | `app/ExperiencePersistence` | 依序寫入、冪等重送、失敗寫入在結算前重送 | 計分與排名（由後端決定） |
| 資料 | `api/ApiClient` | HTTP 邊界 | 重試策略 |
| 呈現 | `scenes/AppScene` | 依狀態管理 P0–P7、面板與開頭影片 | 流程規則、後端規則 |
| 呈現 | `ui/stage/BattleStage` | 共用舞台圖層、鏡頭及視差 | 戰鬥規則 |
| 呈現 | `ui/battle/BattleView` | P4 角色、HUD、特效與音效 cue | 對戰狀態 |
| 音效 | `audio/` | cue 對照、事件映射、載入與播放 | 戰鬥判定 |
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
| P3_LOADING | 練習場（生成／載入期間可練習）與操作說明 | DEFAULT | 完成後 Enter／手把 START 確認 FIGHT! | 無 |
| P4_BATTLE | 戰鬥（含回合 K.O.／TIME UP 停留） | NORMAL／COMBO／DANGER／LAST_10_SECONDS | 戰鬥、ESC 暫停 | 開始對戰、建立後端 match |
| P5_PRESENTATION | K.O.／TIME UP／DRAW 與勝負 | DEFAULT | 查看結算 | 結果已送出 |
| P6_RESULT | 結算與排行 | RANK_1_TO_6 等 | 繼續 | 無 |
| P7_END | 再玩一次？ | DEFAULT | Replay、Finish | 無 |

正常流程：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。Replay 回到 P1（重新確認角色、對手與難度，再選場景），Finish 回到 P0。

### 返回與離開

| 目前狀態 | BACK／ESC 的結果 |
|---|---|
| P0 | 無作用 |
| P1 | 自訂中先確認放棄，否則回 P0。1P 的 K：難度 → 對手 → 解除自己的鎖定 |
| P2 | 無作用；重新選角由 Replay 回 P1 |
| P3、P5、P6 | 回 P0 並結束 session |
| P4 | 開啟暫停選單；選 EXIT 並確認後回 P0 |
| P7 | 無作用，用 Replay 或 Finish |

閒置逾時：P0 60 秒播開頭影片，任意鍵盤鍵或手把按鈕返回；P1 選角與選對手 60 秒、自訂 90 秒；P7 沒有閒置逾時。其他畫面靠 ESC 離開。

### 操作

| 情境 | 1P | 2P |
|---|---|---|
| 選單／選角 | W A S D 移動 · F 確認 · K 返回 | 方向鍵 · NUM 1 加入／確認 · BACKSPACE 返回 |
| 選場景（P2） | A D 或 ←→ 切換場景 · J／ENTER 確認 · K／ESC 返回 | — |
| 選 CPU 對手（單人） | W A S D 移動 CPU 游標 · F 確認；難度用 A D | 按 NUM 1 改為雙人 |
| 戰鬥 | A D 移動 · W 跳 · S 蹲 · F 輕拳 · U 重拳 · G 輕腳 · I 重腳 · 按住 S（下）或後方向防禦 · ESC 暫停；S／W＋攻擊＝蹲／空中攻擊 | ← → 移動 · ↑ 跳 · ↓ 蹲 · NUM 1 輕拳 · NUM 2 重拳 · NUM 4 輕腳 · NUM 5 重腳 · 按住 ↓ 或後方向防禦 · ESC 暫停 |
| 搖桿（戰鬥） | 十字鍵／左類比／右類比移動 · 上跳 · 下蹲＝防禦 · □ 輕拳 · △ 重拳 · ✕ 輕腳 · ○ 重腳 · OPTIONS 暫停 | 擁有第 2 支搖桿的玩家，按鍵同 1P |
| 搖桿（選單） | 方向導航 · ✕ 確認 · R1 返回（○ 在選單沒有作用）；P1 選角最上層按 R1 回標題；P0 按 L3 開啟操作設定 | 只在 P1 選角頁有效（加入＝✕）；L3 無效 |

沒有獨立的防禦鍵：按住下（蹲）或後方向即防禦，按住下時按攻擊照常出招。戰鬥鍵可在 P0 按 C 重新綁定（← → 切換 PLAYER 1／PLAYER 2），存在 `localStorage` 的 `exp2.controls.v3`；舊版存檔會被忽略並使用預設，v3 存檔裡已移除的 Guard 欄位載入時丟棄。兩位玩家的選單鍵都跟著自己的戰鬥鍵（跳／蹲／左右＝上下左右、輕拳＝確認）。綁定另一位玩家已用的鍵（含對方返回鍵：1P 的 K、2P 的 Backspace）會被拒絕；兩人可共用暫停鍵。面板下方唯讀列出依目前鍵位推導的組合操作。雙人同時操作時，部分鍵盤多鍵同按會漏鍵（ghosting），屬硬體限制。

### 搖桿（Qanba Drone 2 等 XInput 手把）

- 一人一台。手把第一次按下按鈕時取得空位（先 1P 再 2P），以 `Gamepad.index` 記錄，拔掉 1P 不會讓 2P 變成 1P。推搖桿不算取得。
- 斷線即釋放：該玩家按住的輸入全部放開、不補按下；戰鬥中會自動開啟暫停選單。重新插上後要再按一次按鈕才重新屬於原位置。
- 畫面上的搖桿鍵名使用機台面板的 PS 標示。Windows 把 Qanba Drone 2 認成 Xbox 360（XInput），依 standard mapping 位置對應為 0＝✕、1＝○、2＝□、3＝△、4＝L1、5＝R1、6＝L2、7＝R2、8＝SHARE、9＝OPTIONS、10＝L3、11＝R3、12–15＝十字鍵（推論，待實機確認）。
- 系統鍵固定、不能綁定：R1＝返回（每位玩家自己的搖桿），L3＝在 P0 開啟 CONTROLS（只認 1P）。
- 單人時 2P 擁有的手把不操作 1P。P1 選角頁兩位玩家的手把都有效；其他選單（P0、P2、P3、P5–P7、暫停、排行榜）只聽 1P（鍵盤或手把），2P 手把只能用 OPTIONS 暫停。
- 搖桿的 DP／LS／RS 模式都能用：方向同時接受十字鍵、左類比（軸 0／1）與右類比（軸 2／3）。類比當數位方向時達 0.5 按下、低於 0.35 放開。
- 改鍵（全程可只用 1P 搖桿）：P0 按 L3（或鍵盤 C）開啟 CONTROLS；1P 已擁有搖桿時預設 GAMEPAD 分頁（鍵盤 TAB 可切換）。十字鍵上下選一列、左右切換 PLAYER 1／PLAYER 2，按 ✕ 後再按該玩家自己搖桿上要綁定的按鈕（按 ✕ 的那一下不會被綁定）；擷取中 R1 取消，列表時 R1 關閉面板。同玩家重複會詢問交換（左右選、✕ 確認）；兩位玩家可用相同按鈕；R1、L3 與左右類比不能綁定。存在 `exp2.gamepad.v1`，與鍵盤存檔分開；含 R1／L3 的舊存檔該玩家退回預設。選單的確認跟著輕腳的按鈕。
- 診斷頁：`npm run dev` 後開 `/?gamepadDebug=1`（正式建置不包含）。即時顯示每支手把的 id、index、mapping、每顆按鈕與軸、目前屬於哪位玩家，可複製 JSON 報告。實機驗收步驟與索引對照表在 `docs/qanba-drone2-hardware-test.md`。
- 已知限制：目前只用 Mock Gamepad 驗證（`scripts/verify-gamepad.mjs`），尚未完成雙機實機驗證；`mapping` 不是 `standard` 的手把（例如 D-pad 以 hat 軸回報）不支援；兩台同型號無法區分，設定跟著玩家位置而非裝置；PS4／PS5 模式、震動不處理；搖桿無法切換 KEYBOARD／GAMEPAD 分頁（用鍵盤 TAB）。

戰鬥中任一方連擊 ≥ 2 會在該側顯示 `N HITS` 與 COMBO!／GREAT!／AWESOME! 標語；倒地時畫面震動（減少動態效果時不震動）。

四種攻擊各有招式資料（幀數、傷害、判定框），在 `combat/CombatWorld.ts` 的 `DEFAULT_COMBAT_CONFIG.attack`（輕拳）與 `moves` 調整。

音效檔由 `Audio/` 複製到未納入 git 的 `public/test-assets/audio/`，保留原檔名。缺少的素材包括腳步、落地、下蹲、起身、出場音、勝利 jingle、KO 衝擊、BGM 與 First Attack／Nice Combo／Danger／10 Seconds／New Record 語音；未提供時不播放。`?mute=1` 靜音，`?audioDebug=1` 在 console 記錄 cue。

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
| `src/game/ui`、`scenes` | 呈現元件、view model、Phaser 場景 |
| `src/game/ui/screens` | P0–P7 各畫面的 `ScreenView` 子類別與暫停疊層（見 `docs/architecture/README.md`） |
| `src/game/config` | AI 難度、舞台調校 |
| `backend/app` | FastAPI 路由、服務、SQLite schema、計分 |
| `public/test-assets` | 舞台、特效（`vfx/*-impact-fx/sheet-transparent.png`）、開頭影片、音效與原型頁角色。Vite 複製到 `dist` |
| `public/assest/characters` | 內建角色原圖、`game_manifest.json` 與 `compact/` 精簡圖集。Customize Body 01–04 對應 `S1AW`／`S2AM`／`S2LW`／`S3WW`。Body 03 拍照生成用 S1AM 模板，跳過拍照使用 S2LW 圖集 |
| `assest` | 場景素材原檔。未引用的舊角色素材已於 2026-11-24 移到資源回收筒 |
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

一鍵啟動：雙擊 `start-dev.bat`。會檢查 venv／node_modules、提示 ComfyUI（8188）是否在跑，分別開視窗啟動後端（8000）與前端（5173），就緒後開啟 `http://localhost:5173/`。關閉那兩個視窗即停止服務。

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
| `http://127.0.0.1:5189/?hitbox` | P4 畫出 hurtbox（藍）與出招判定框（紅），對照動畫調招式表 |
| `http://127.0.0.1:5189/?gamepadDebug=1` | 手把診斷頁（只在開發伺服器），不啟動遊戲 |

Playwright 腳本在前端啟動後執行，截圖輸出到 `outputs/*-verification/`：

| 腳本 | 驗證範圍 |
|---|---|
| `scripts/verify-opponent-flow.mjs` | 排行榜、1P 選對手與難度、P2 只選場景、Announcer、命中／防禦特效、回合 K.O. 停留、P5、Replay |
| `scripts/verify-controls.mjs` | 改鍵、衝突、重設、存檔 v3、四種攻擊的站立／空中／蹲姿圖、W 跳 S 蹲、按住下／後防禦、推擠、鏡頭 |
| `scripts/verify-gamepad.mjs` | Mock Gamepad：診斷頁、單台 P0→P7＋Replay、雙台各自操作、熱插拔、LS／RS、長按、鍵盤備援、手把改鍵保存、R1 返回、L3 開面板並以搖桿改鍵（結束碼 2＝SKIPPED） |
| `scripts/verify-audio.mjs` | 音效 cue 序列及 Chrome FLAC／WAV 解碼 |
| `scripts/verify-p1.mjs` | 選角格、雙人、自訂拍照、單人選對手、閒置逾時、離線 |
| `scripts/verify-experience.mjs` | P0–P4 完整流程、相機、舞台後備 |
| `scripts/verify-prototype.mjs` | 原型流程、共用 HUD、暫停、減少動態 |
| `scripts/verify-screens.mjs` | 單人 P0→P7 全流程截圖（可指定輸出資料夾），並斷言所有 `/test-assets/` 請求零 404、無頁面錯誤 |
| `scripts/verify-versus.mjs` | 2P 改鍵（跨玩家衝突被拒）、2P 加入、雙人戰鬥由 2P 操作 ENEMY、連擊標語、倒地震動 |
| `scripts/verify-aligned-characters.mjs` | 對齊後角色圖集載入與呈現（需另起隔離後端於 19881） |
| `scripts/verify-comfy-live.py` | 對本機 ComfyUI（8188）實跑一次生成（需 ComfyUI 與後端） |

更新內建角色時，用相同檔名替換 `public/assest/characters/<角色>/` 裡的原圖，再執行 `python scripts/prepare-aligned-characters.py`。遊戲直接載入原圖作為全尺寸圖集。腳本重建 `compact/` 的 256 像素影格與 `AlignedSpriteData.json`，並依 `game_manifest.json` 取影格資料。Tony 的影格數由 PNG 尺寸推算。腳本需要 Pillow，也可用 ComfyUI 內附的 `python_embeded\python.exe` 執行。


場景素材由 `scripts/prepare-stage-assets.py` 從 `assest/` 產生，需安裝 ffmpeg。

P0 閒置 60 秒後依序輪播四支實機對戰影片（`public/test-assets/attract/`）：Joneey 對 GO、YG 對 SE7EN、Tony 對 GO、Chris 對 SE7EN，皆由左邊 1P 以 2–0 獲勝。一支播完接下一支；任何輸入（含輕拳）回 P0，下次閒置從下一支開始。啟動 Vite 後執行 `node scripts/record-attract.mjs [片名…]` 可重錄全部或指定的影片，腳本需要 Playwright、Chrome 與 ffmpeg，片名清單須與 `AppScene.ts` 的 `ATTRACT_CLIPS` 一致。輸出為 720p、30 fps，音軌使用遊戲的觀眾歡呼聲。舊的 GO 對 Tony 影片備份在 `outputs/attract-recording/intro-go-vs-tony.mp4`。

## Roadmap

| 階段 | 內容 | 狀態 |
|---|---|---|
| D1–D2 | 框架、狀態機、UI 導覽 | 完成 |
| D3–D5 | 輸入、時鐘、戰鬥、模擬對戰 | 完成 |
| D6–D8 | 後端整合 | 完成 |
| 現在 | 整合強化與視覺檢視 | 進行中 |
| D9 | ComfyUI 生成結果串接、P3 真實載入、正式素材 | 延後 |
