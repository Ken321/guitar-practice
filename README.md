# Guitar Practice

ギター練習用のコード進行管理Webアプリ。日本のギタータブサイト（Gakki.me、U-Fret）からコード進行をスクレイピングしてインポートしたり、手動で登録・管理できます。

## 機能

- 曲の登録・編集・削除（コード進行付き）
- SVGコードダイアグラムの表示
- 日本のタブサイト（Gakki.me / U-Fret）からの自動インポート
- 音楽理論ライブラリ（Tonal）によるコード解析

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18 + TypeScript + Vite |
| バックエンド | FastAPI + SQLAlchemy |
| データベース | PostgreSQL (Neon) |
| スクレイピング | Playwright (Chromium) |
| デプロイ | Railway (backend) / Vercel (frontend) |

## 構成概要

このプロジェクトは `frontend/` と `backend/` を分けた構成です。

- `frontend/`
  React + Vite の SPA です。曲一覧、曲詳細、追加画面、コードダイアグラム表示、度数表示を担当します。
- `backend/`
  FastAPI ベースの API です。曲データの CRUD、コードシート保存、スクレイピング、キー推定を担当します。
- PostgreSQL
  曲、セクション、行、コード配置を保存します。
- 外部サイト
  U-Fret / 楽器.me からコード譜を取得します。

基本的なデータの流れは次の通りです。

1. frontend が `/api/...` にリクエストする
2. backend が DB から曲データを返す、またはスクレイピングを実行する
3. スクレイピング時は `capo` とコード進行から `original_key` を推定し、`key` は譜面キーとして導出する
4. frontend は譜面キーを基準にコード表示や度数表示を行う

## データモデルの考え方

曲データではキーを 2 種類持ちます。

- `original_key`
  原曲のキー。実音ベースのキーです。
- `key`
  譜面上のキー。カポを前提にコード譜へ書かれているキーです。
- `capo`
  カポ位置です。

たとえば `capo=3` で譜面キーが `C` の場合、原曲キーは `Eb` になります。  
度数表示は譜面に書かれているコードを自然に読めるように、`key` を基準に計算します。

## ディレクトリ構成

役割が分かりやすい主要ディレクトリは次の通りです。

- `backend/app/main.py`
  FastAPI のエントリポイントです。
- `backend/app/models.py`
  SQLAlchemy モデルです。`Song`, `Section`, `Line`, `ChordPlacement` を定義しています。
- `backend/app/schemas.py`
  API の入出力スキーマです。
- `backend/app/routers/songs.py`
  曲 CRUD とコード内容更新 API です。
- `backend/app/routers/scraper.py`
  スクレイピング API の入口です。
- `backend/app/music_theory.py`
  キー推定、カポ考慮、譜面キー/原曲キーの導出ロジックです。
- `backend/scraper/`
  U-Fret / 楽器.me ごとのスクレイパー実装です。
- `backend/scripts/`
  既存曲のメタデータ再計算やバックフィル用スクリプトです。
- `frontend/src/pages/`
  ページ単位の UI です。
- `frontend/src/components/`
  コード譜表示、ポップオーバー、エディタなどの部品です。
- `frontend/src/api/client.ts`
  Axios ベースの API クライアントです。
- `frontend/src/types/`
  frontend 側の型定義です。
- `frontend/src/utils/`
  度数計算、コード正規化、ボイシング解決などのロジックです。

## ローカル開発の起動方法

### 前提条件

- Python 3.11+
- Node.js 18+
- PostgreSQL（または Neon アカウント）

### バックエンド

```bash
cd backend

# 仮想環境のセットアップ
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 依存パッケージのインストール
pip install -r requirements.txt
playwright install chromium

# 環境変数の設定
cp .env.example .env
# .env を編集して DATABASE_URL を設定

# 開発サーバーの起動
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs

### フロントエンド

```bash
cd frontend

# 依存パッケージのインストール
npm install

# 開発サーバーの起動
npm run dev
```

- フロント: http://localhost:3000
- `/api` へのリクエストは Vite プロキシ経由でバックエンドに転送される

### 環境変数

**backend/.env**
```
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/guitar_practice?sslmode=require
```

**frontend/.env.local**（本番用、ローカル開発では不要）
```
VITE_API_URL=https://your-backend.railway.app
```

## GitHub と Vercel で公開する

### 推奨構成

- GitHub: このリポジトリ全体を管理
- Vercel: `frontend/` を公開
- Railway: `backend/` を公開

バックエンドは `playwright` + `chromium` を使ってスクレイピングしているため、現状のままでは Vercel より Railway のほうが安定します。最短で公開するなら、フロントを Vercel、API を Railway に分けるのが実用的です。

### 1. GitHub に push する

まだ Git リポジトリを作っていない場合:

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:<your-account>/guitar-practice.git
git push -u origin main
```

HTTPS を使う場合:

```bash
git remote add origin https://github.com/<your-account>/guitar-practice.git
git push -u origin main
```

### 2. Railway で backend を公開する

- GitHub リポジトリを Railway に接続
- Root Directory を `backend` に設定
- 環境変数 `DATABASE_URL` を設定
- Playwright/Chromium が使えるように Railway 側のビルド設定を有効にする

### 3. Vercel で frontend を公開する

- GitHub リポジトリを Vercel に接続
- Root Directory を `frontend` に設定
- Framework Preset は `Vite`
- 環境変数 `VITE_API_URL=https://your-backend.railway.app` を設定

このリポジトリには [frontend/vercel.json](/Users/321ken/Codes/guitar-practice/frontend/vercel.json) を入れてあり、React Router の直接アクセスでも 404 にならないようにしています。

### 4. デプロイ後の確認

- トップページが表示される
- 曲一覧が読める
- `/songs/:id` を直接開いても 404 にならない
- 新規追加時に API へ接続できる

### 補足

- backend まで Vercel に寄せたい場合は、スクレイピング機能を別サービスに切り出す前提で考えたほうが良いです。
- 先に Vercel は frontend だけ公開し、backend は Railway のままにするのが安全です。

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/songs` | 曲一覧の取得 |
| GET | `/api/songs/{id}` | 曲の詳細取得 |
| POST | `/api/songs` | 曲の作成 |
| PUT | `/api/songs/{id}` | 曲の更新 |
| DELETE | `/api/songs/{id}` | 曲の削除 |
| POST | `/api/scraper/gakki-me` | Gakki.me からスクレイピング |
| POST | `/api/scraper/u-fret` | U-Fret からスクレイピング |

## プロジェクト構成

```
guitar-practice/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI アプリ
│   │   ├── database.py      # DB 設定
│   │   ├── models.py        # SQLAlchemy モデル
│   │   ├── schemas.py       # Pydantic スキーマ
│   │   └── routers/
│   │       ├── songs.py     # 曲 CRUD
│   │       └── scraper.py   # スクレイピング
│   └── scraper/
│       ├── base.py
│       ├── gakki_me.py
│       └── ufrelet.py
└── frontend/
    └── src/
        ├── pages/           # ページコンポーネント
        ├── components/      # UI コンポーネント
        ├── api/             # Axios クライアント
        ├── types/           # TypeScript 型定義
        └── utils/           # ユーティリティ
```
