# 押さえ方保存の伝播（不具合調査・修正方針）

## 不具合の概要

同じ曲の中に同じコード名（例: `Dm7/G`）が複数箇所に出てくるとき、
それぞれを個別に保存すると **異なる押さえ方が登録されてしまう**。

## 根本原因

### データモデル

現在の DB は `ChordPlacement`（コード配置）単位で押さえ方を保存している:

```
chord_placements
  has_custom_voicing: bool
  preferred_voicing_signature: str | null   ← 絶対フレット列 e.g. "x,x,0,2,1,0"
  preferred_voicing_chord_name: str | null
  preferred_voicing: int                    ← ランキング index
```

「曲×コード名」単位のテーブルは存在しない。

### フロントエンドの保存処理

`ChordSheet.tsx` の `handleSaveVoicing` は **クリックした1つのコード配置 ID** にしか保存しない:

```ts
// ChordSheet.tsx:242
const updatedChord = await updateChordVoicing(id, chordId, voicingIndex, ...)
```

### 表示ロジック

`applyEffectiveVoicingPreference` は:
- `has_custom_voicing = true` → 自分自身の署名をそのまま使う（song-level preference を無視）
- `has_custom_voicing = false` → 同じ曲内の他のカスタムボイシングから多数決で決める

```ts
// ChordSheet.tsx:127
if (chord.has_custom_voicing) {
  return chord  // ← ここで song-level を完全スキップ
}
```

### 問題が起きるシナリオ

1. Dm7/G が曲中に2箇所（A, B）
2. A に voicing X を保存 → B は song-level preference 経由で X を表示
3. B に voicing Y を保存 → B は Y を独立保持、A は X のまま
4. 結果: A=X, B=Y（2種類が共存）

## 修正方針

### フロントエンド修正（`ChordSheet.tsx`）

`handleSaveVoicing` で、同じ `chord_name` を持つすべてのコード配置に同じ押さえ方を保存する。

```ts
async function handleSaveVoicing(
  chordId: string,
  voicingIndex: number,
  voicingSignature?: string | null,
  voicingChordName?: string | null,
) {
  if (!id || !song) return

  // 同じ chord_name を持つ全配置を収集
  const chordName = findChordPlacementById(song, chordId)?.chord_name
  const allSameNameChords = chordName
    ? song.sections.flatMap(s => s.lines.flatMap(l => l.chords.filter(c => c.chord_name === chordName)))
    : []

  // 全配置に対して同じ押さえ方を保存
  await Promise.all(
    allSameNameChords.map(c =>
      updateChordVoicing(id, c.id, voicingIndex, voicingSignature, voicingChordName, true)
    )
  )
  ...
}
```

### バックエンド修正（オプション）

- `PATCH /songs/{song_id}/chords/by_chord_name/{chord_name}` のような「曲内一括更新」エンドポイントを追加する
- または既存の `PATCH` を1件ずつ複数回呼ぶ（フロントエンドのみ修正でも対応可能）

## 既存データの二重保存を解消するには

現在 DB に存在する「同じ曲・同じコード名で複数の押さえ方が保存されている」状態を直すには:

1. 管理ツール or SQLで確認:
   ```sql
   SELECT s.title, cp.chord_name, cp.preferred_voicing_signature, count(*)
   FROM chord_placements cp
   JOIN lines l ON cp.line_id = l.id
   JOIN sections sec ON l.section_id = sec.id
   JOIN songs s ON sec.song_id = s.id
   WHERE cp.has_custom_voicing = true
   GROUP BY s.title, cp.chord_name, cp.preferred_voicing_signature
   ORDER BY s.title, cp.chord_name;
   ```
2. 同じ曲・コード名で複数の署名が出た場合、一方に統一する（最新保存 or 手動確認）
