# Backrooms 2D Starter

Phaser 3.90.0 + Vite 8 + JavaScript。瀏覽器俯視角、桌面鍵盤操作的最小遊戲原型。

## 啟動

先從 https://nodejs.org/en/download 安裝 Node.js LTS（本專案需要 22.12 或更新版本，建議目前 LTS）。npm 會一起安裝。

在這個資料夾開啟終端機：

```sh
npm install
npm run dev
```

開啟終端機顯示的本機網址，通常是 http://127.0.0.1:5173 。不要直接雙擊 index.html。

```sh
npm run build
npm run preview
```

build 會把部署用靜態檔案放到 dist/。預覽請使用 preview 顯示的網址。

## 已包含

- WASD／方向鍵移動，Shift 奔跑，R 重來。
- 牆壁碰撞、跟隨鏡頭、黃色走廊。
- 圓形漸暗視野、綠色出口與過關訊息。
- 所有圖形由程式生成，不需要下載美術素材。

## 從哪裡改

- src/main.js：遊戲邏輯。MAP 控制地圖，WALK_SPEED / RUN_SPEED 控制速度。
- src/style.css：網頁外框與文字樣式。
- index.html：遊戲容器、操作說明。

MAP 中 # 是牆、. 是地板、P 是唯一出生點、E 是唯一出口。每列長度必須相同，最外圍保持牆壁，出口要能從出生點走到。若希望擴充地圖，先改 MAP，之後再考慮使用 Tiled。

create() 建立場景、碰撞與鍵盤控制；update() 讀取方向並設定速度。Arcade Physics 處理每幀位移，因此不要再把速度乘上 delta。

## 目前範圍

這是探索原型，尚未加入怪物、音效、存檔、程序生成或手機觸控。視野是漸層遮罩，牆壁不會遮擋光線。Phaser 主程式包較大，正式部署前再考慮按需載入或客製建置。

建議擴充順序：腳步與環境音 → 牆壁遮光 → 一隻會巡邏的怪物 → 多張手工地圖。

## 官方文件

- https://docs.phaser.io/phaser/getting-started/making-your-first-phaser-game
- https://docs.phaser.io/api-documentation/api-documentation
- https://vite.dev/guide/

## 驗證狀態

已通過 JavaScript 語法檢查，以及地圖尺寸、單一出生點／出口和出口可達性檢查。已使用 Node.js 24.21.0 完成 npm install 與 npm run build，並在瀏覽器確認遊戲畫面成功載入，未出現瀏覽器警告或錯誤。尚未完成整關操作測試。建置會提示 Phaser 主程式包超過 500 kB，這不影響本機啟動。

## K2Hackathon 專案位置

這個遊戲位於 `frontend/backrooms/`，是獨立的 Vite 前端。從 repository 根目錄啟動：

```sh
cd frontend/backrooms
npm ci
npm run dev
```

`frontend/` 原有的 Next.js 應用使用自己的啟動指令；本遊戲的預設開發網址是 http://127.0.0.1:5173 。

提交本遊戲時，先確認目前分支與 diff；只加入需要提交的遊戲原始碼與 package-lock.json。node_modules/ 與 dist/ 已列入本資料夾的 .gitignore。
