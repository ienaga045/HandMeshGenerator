# Hand Base Mesh Generator JS

Python版 Hand Base Mesh Generator のメッシュ生成処理を、GitHub Pagesで動作する静的JavaScriptアプリへ移植したPoCです。

## 現在の範囲

- Manual modeのみ
- Webカメラ未対応
- MediaPipe未対応
- 21点ランドマークJSONとスライダー値からOBJを生成
- OBJは `o hand_base_mesh`、`v`、`f` のみを出力

## Python版から維持しているメッシュ構成

- MediaPipe Hands 21点ランドマーク
- 掌スラブ: 12頂点 / 8面
- ボーン四角柱: 24接続 x 8頂点 / 6面
- 関節球: 21点 x 48頂点 / 40面
- 標準合計: 1212頂点 / 992面

形状維持を優先するため、`meshGenerator.js` はPython版の以下の処理をほぼ1:1で移植しています。

- `normalize_landmarks_for_obj`
- `radius_for_landmark`
- `width_for_bone`
- `orthonormal_basis`
- `generate_box_prism`
- `generate_uv_sphere`
- `generate_palm_slab`
- `build_hand_mesh`

JavaScriptは数値型が64bit浮動小数の `Number` で固定です。Python版はNumPy `float32` を使う箇所があるため、座標の完全ビット一致は保証しません。OBJ出力はPython版と同じく小数6桁へ丸めます。

## 実行

GitHub Pagesでは `index.html` を公開してください。ローカルでは静的サーバーで開くのが確実です。

```bash
python3 -m http.server 8000
```

ブラウザで以下を開きます。

```text
http://localhost:8000
```

## テスト

Node.jsがある環境では、メッシュ構成の簡易テストを実行できます。

```bash
npm test
```

確認内容:

- 接続数 24
- ランドマーク数 21
- 標準頂点数 1212
- 標準面数 992
- OBJの `v` / `f` 行数

## 将来予定

- MediaPipe Hand LandmarkerによるWebCam capture mode
- 21点ランドマークからManual modeパラメータへの変換
- 右手/左手切り替え
- スマホのインカメ対応
