# 網路成癮測驗 🌐

10 題輕鬆小測驗，自動播放（可調整每題秒數），結束後顯示分級統計。

支援兩種模式：

- **單機模式** — 直接打開首頁就能玩，結果只在自己畫面。
- **課堂模式** — 老師建立場次顯示 QR，學生掃碼一起作答，老師端即時看到統計與每筆提交（資料寫到 Google Sheet）。

## 本地預覽

```bash
python3 -m http.server 8000
# 開 http://localhost:8000
```

## 部署到 GitHub Pages

本 repo 已內建 GitHub Actions（`.github/workflows/deploy.yml`），推到 `master` 會自動部署。

1. **Settings → Pages → Source** 選 `GitHub Actions`（一次性設定）
2. 推上 `master` 即自動部署
3. 網址：`https://<帳號>.github.io/<repo>/`

## 課堂模式設定（Apps Script + Google Sheet）

### 1. 建立後端

1. 新增一個 Google Sheet
2. **Extensions → Apps Script**，把 `apps-script/Code.gs` 整份貼進去
3. 把檔案最上面的 `TEACHER_KEY` 改成你自己的隨機字串（建議 16 字元以上，老師專用，不要跟學生說）
4. **Deploy → New deployment → Type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. 複製 Web App URL（`/exec` 結尾）

> 第一次部署會跳「Google hasn't verified this app」警告，這是個人 Apps Script 正常現象。點 **Advanced → Go to ... (unsafe) → Allow** 即可，只發生一次。

### 2. 設定前端

把第 1 步取得的 Web App URL 填到 `index.html` 裡的 `WEB_APP_URL` 常數：

```js
const WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
```

提交、推上去，等 Pages 部署完。

### 3. 課堂使用流程

- **老師端**：開 `https://<你的網址>/?role=teacher`
  - 第一次會要求輸入剛剛設定的 `TEACHER_KEY`（只存在這台瀏覽器的 localStorage）
  - 系統自動建立場次（5 碼代號 + token），畫面顯示 QR、加入連結、即時統計
- **學生端**：掃 QR（或讀 5 碼代號自行輸入連結）→ 輸入名字 → 作答 → 自動回傳結果

## 安全與資安

- HTML 不含任何密鑰，repo 公開無妨
- 場次 token 4 小時自動過期；URL 即使外流影響有限
- 後端驗證 payload 形狀、token、場次容量（單場上限 200 筆）
- 學生 score 由後端從 answers 重算，不信任 client

## 課堂可靠性

- 提交失敗會自動進入重試佇列（3s / 8s / 20s / 60s + 連回網路觸發）
- 作答中斷可從 localStorage 自動恢復進度
- 同 session 同一份提交以 `attemptId` 去重，學生 refresh 不會多筆
- Apps Script 端用 `LockService` 序列化寫入，30 人同時送沒問題

## 評分規則

- 每題回答「是」= 1 分，總分 0–10
- **8–10 分**：重度網路成癮 🚨
- **4–7 分**：輕度網路成癮 ⚠️
- **0–3 分**：健康使用 🌿

## 自訂

- 改題目：編輯 `index.html` 裡的 `QUESTIONS` 陣列
- 改級距：找 `showResult()` 函式裡的 `if (score >= 8)` 區塊
- 預設秒數：開始畫面的輸入框（5–120 秒）
- 場次過期時間 / 容量上限：`apps-script/Code.gs` 上方的 `SESSION_TTL_MS`、`MAX_PER_SESSION`

## 上課前 checklist

1. 用教室實際網路（同一個 Wi-Fi）測一次：開老師頁 → 用手機掃 QR → 送一筆 → 確認試算表有寫入、老師畫面 4 秒內出現
2. 注意有些校園網路會擋 `script.google.com`，遇到時改用行動數據
3. 課程結束後可在 Apps Script 編輯器手動執行 `cleanupExpiredSessions()` 清掉舊資料
