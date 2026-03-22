# コード押さえ方の優先順位

コード押さえ方（ボイシング）を決定する際の優先順位。

## 優先順位

### 1. その曲・そのコード名に対して明示的に指定された押さえ方
- `has_custom_voicing = true` かつ `preferred_voicing_signature` が保存されているもの
- 曲単位・コード名単位での設定（`chord_name × song_id`）
- 同じ曲内で同じコード名が複数の箇所に出てきても、すべて同じ押さえ方を使う

### 2. （現在未実装 / 将来拡張用）その曲内の同じコード名で指定されているもの
- ※ 現在は Priority 1 が曲×コード名単位なので、Priority 2 は実質 Priority 1 に統合されている

### 3. すべての曲を通じた押さえ方ランキング1位のもの
- `VoicingPreference` テーブルの `usage_count` が最大のもの
- `hydrateVoicingPreferences` → `voicingUsageCounts` で管理
- フロントエンドでランキングに反映して `ranked` リスト先頭に出す

### 4. 押さえ方データベース（`@tombatossals/chords-db`）にあるもの
- スコアリングで DB 候補を優先

### 5. アルゴリズムで生成したもの（DB になし）
- `resolveChordVoicingsAsync` の生成候補をスコア順に並べる

## 現在の実装との差分（不具合）

現在は `has_custom_voicing = true` が **コード配置（chord_placement）単位** で保存されている。
同じ曲・同じコード名が2箇所以上あるとき、それぞれが独立に保存され、別々の押さえ方が登録されうる。

**正しい動作**: 押さえ方を保存するとき、同じ曲内の同じ `chord_name` を持つすべての配置に同じ押さえ方を反映する。

→ 修正方針は [voicing-save-propagation.md](./voicing-save-propagation.md) を参照。
