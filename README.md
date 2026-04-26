# 網路成癮測驗 🌐

10 題輕鬆小測驗，自動播放（可調整每題秒數），結束後顯示分級統計。

## 本地預覽

直接打開 `index.html`，或：

```bash
python3 -m http.server 8000
# 開 http://localhost:8000
```

## 部署到 GitHub Pages

1. 建立一個新的 GitHub repo，把這個資料夾推上去：

   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin git@github.com:<你的帳號>/<repo>.git
   git push -u origin main
   ```

2. GitHub repo → **Settings → Pages**
3. **Source** 選 `Deploy from a branch`，**Branch** 選 `main` / `root`，存檔
4. 等一下下，網址會出現在同一頁：`https://<你的帳號>.github.io/<repo>/`

完成 ✨

## 評分規則

- 每題回答「是」= 1 分，總分 0–10
- **8–10 分**：重度網路成癮 🚨
- **4–7 分**：輕度網路成癮 ⚠️
- **0–3 分**：健康使用 🌿

## 自訂

- 改題目：編輯 `index.html` 裡的 `QUESTIONS` 陣列
- 改級距：找到 `showResult()` 函式裡的 `if (score >= 8)` 區塊
- 預設秒數：開始畫面的輸入框（5–120 秒）
