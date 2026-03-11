# CLAUDE.md

## プロジェクト概要

ギター練習用のコード進行管理Webアプリ。
- **バックエンド**: FastAPI (Python) — `backend/`
- **フロントエンド**: React + TypeScript (Vite) — `frontend/`
- **DB**: PostgreSQL (Neon)
- **スクレイピング**: Playwright (Chromium)

## 起動コマンド

### バックエンド
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### フロントエンド
```bash
cd frontend
npm run dev
```

## 主要ファイル

| ファイル | 役割 |
|---------|------|
| `backend/app/main.py` | FastAPI アプリのエントリーポイント・CORS 設定 |
| `backend/app/models.py` | SQLAlchemy ORM モデル（songs / sections / lines / chord_placements） |
| `backend/app/schemas.py` | Pydantic リクエスト/レスポンス スキーマ |
| `backend/app/routers/songs.py` | 曲の CRUD エンドポイント |
| `backend/app/routers/scraper.py` | スクレイピングエンドポイント |
| `backend/scraper/gakki_me.py` | Gakki.me スクレイパー |
| `backend/scraper/ufrelet.py` | U-Fret スクレイパー |
| `frontend/src/App.tsx` | React ルーター設定 |
| `frontend/src/api/client.ts` | Axios API クライアント |
| `frontend/src/types/index.ts` | TypeScript 型定義 |

## データモデル

```
songs (曲)
  └── sections (セクション: イントロ/Aメロ/Bメロ/サビ等)
        └── lines (行: 歌詞行)
              └── chord_placements (コード配置: 位置 + コード名)
```

## 環境変数

**backend/.env**
```
DATABASE_URL=postgresql://...
```

**frontend/.env.local**（本番のみ）
```
VITE_API_URL=https://...
```

## 注意事項

- `backend/.env` は `.gitignore` に含める（DB接続情報を含むため）
- Playwright は初回セットアップ時に `playwright install chromium` が必要
- フロントエンドの Vite dev server は `/api` を `localhost:8000` にプロキシする
- DB テーブルはアプリ起動時に SQLAlchemy が自動作成する（`models.py` の `Base.metadata.create_all`）
