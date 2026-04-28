# 網路成癮測驗 🌐

輕鬆小測驗，自動播放（可調整每題秒數），結束後顯示分級統計。

支援兩種模式：

- **單機模式** — 直接打開首頁就能玩，結果只在自己畫面。
- **課堂模式** — 老師建立場次顯示 QR，學生掃碼一起作答，老師端即時看到統計與每筆提交（資料寫到 Google Sheet）。

## 題庫

內建兩份題庫，課堂或單機模式都可選：

- **一般** — 原來的 10 題，適合青少年到成人。
- **國小以下** — 給小朋友的版本，措辭較柔和，結果頁不用「成癮」字眼。

也可以**自訂題庫**：用 Excel / Google Sheet 編輯題目 → 另存成 CSV 上傳。詳見下方「自訂題庫」段落。

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
  - 接著選擇本場次題目（一般 / 國小以下 / 自訂題庫），按「建立場次」
  - 畫面顯示 QR、加入連結、即時統計
- **學生端**：掃 QR（或讀 5 碼代號自行輸入連結）→ 載入老師選的題庫 → 輸入名字 → 作答 → 自動回傳結果

## 安全與資安

- HTML 不含任何密鑰（`TEACHER_KEY` 只在 Apps Script 後端，學生資料讀取也要這把 key），repo 公開無妨
- 場次 token 4 小時自動過期；URL 即使外流影響有限
- 後端驗證 payload 形狀、token、場次容量（單場上限 200 筆）
- 學生 score 由後端從 answers 重算，不信任 client
- 後端有 CacheService 全域節流：每分鐘最多 60 筆寫入、300 次讀取，超過直接 fail-fast 不進 spreadsheet（`apps-script/Code.gs` 上方的 `RATE_LIMIT_*` 常數可調）。前端會自動重試，正常使用無感

## 課堂可靠性

- 提交失敗會自動進入重試佇列（3s / 8s / 20s / 60s + 連回網路觸發）
- 作答中斷可從 localStorage 自動恢復進度
- 同 session 同一份提交以 `attemptId` 去重，學生 refresh 不會多筆
- Apps Script 端用 `LockService` 序列化寫入，30 人同時送沒問題

## 評分規則

- 每題回答「是」= 1 分，總分 0 ～ 題目數
- 一般（10 題）：≥8 重度 🚨 ／ 4 ～ 7 輕度 ⚠️ ／ 0 ～ 3 健康 🌿
- 國小以下（10 題）：≥8「需要爸媽幫忙」🚨 ／ 4 ～ 7「要小心囉」⚠️ ／ 0 ～ 3「很棒喔」🌿
- 自訂題庫可在 CSV 中自定義級距（見下方）

## 自訂題庫（CSV）

兩種方式：

1. **直接修改 `index.html`** 裡的 `BUILTIN_SETS` 物件——把新的 `questions` 陣列加進去。
2. **使用 CSV 匯入**——介面上「+ 匯入 CSV」，選檔即可。匯入後存在瀏覽器 localStorage，下次還在。課堂模式也可選用（題庫會跟場次一起存到後端）。

CSV 格式：

```csv
# title: 國中健康教育
# description: 給國中生使用
# rubric_high: 8,重度依賴,😱,你的網路時間明顯影響生活
# rubric_mid:  4,輕度依賴,⚠️,有點黏網路了
# rubric_low:  0,健康使用,🌿,保持得很好
emoji,question
⏰,你常常上網時間比原本想的還久嗎？
📱,你會在睡前看手機嗎？
🍱,你曾經因為上網忘記吃飯嗎？
😢,沒手機時你會心情低落嗎？
📚,上網影響你的功課或工作嗎？
... (5 ～ 20 題)
```

- 編碼：UTF-8（含或不含 BOM 都可以）
- 欄位：兩欄 `emoji,question`
- 列數：5 ～ 20 題
- 第一行可以有 `emoji,question` 的標頭（也可省略）
- `#` 開頭的列為註解，可選擇性提供題庫名稱、描述、結果級距
- 介面上的「下載範本 CSV」會給一份可直接修改的範本

## 其他自訂選項

- 預設秒數：開始畫面的輸入框（5–120 秒）
- 場次過期時間 / 容量上限：`apps-script/Code.gs` 上方的 `SESSION_TTL_MS`、`MAX_PER_SESSION`
- 題目數量範圍：`apps-script/Code.gs` 的 `MIN_QUESTIONS` / `MAX_QUESTIONS`，前端 `index.html` 同名常數要一致
- 改了 `apps-script/Code.gs`：**Manage deployments → 編輯 → New version** 重新部署，否則新版邏輯不會生效

## 上課前 checklist

1. 用教室實際網路（同一個 Wi-Fi）測一次：開老師頁 → 用手機掃 QR → 送一筆 → 確認試算表有寫入、老師畫面 4 秒內出現
2. 注意有些校園網路會擋 `script.google.com`，遇到時改用行動數據
3. 課程結束後可在 Apps Script 編輯器手動執行 `cleanupExpiredSessions()` 清掉舊資料
