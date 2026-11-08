# 1枚の漫画・インフォグラフィックをCLIで生成する方式

## 成果物

- 1案件につき `visual_summary.png` **1枚・1080×1920px（9:16、YouTube Shorts用）**。画像の中に約8コマ／8項目を配置し、日本語の見出しを上部に入れる。
- タイトル欄・一覧のサムネイルも同じDriveファイルを共用する。タイトル用画像を別途生成しない。
- `visual_done.json` に入力ハッシュ、CLI名／版、指定した推論モデル、プロンプト版、画像寸法、日時、タイトル共用先を保存する。
- 画像モデル名はCLIの実行結果で取得できないため `imageModel: null` と記録する。推論モデルを画像モデルとして表示しない。
- 既存の `manga_01.jpg`〜`manga_08.jpg`／`00_title.jpg` は保持し、従来形式として閲覧・動画化できる。

## 実行構成

Cloudflare WorkersではローカルCLIを起動できないため、このPC上の `scripts/generate-visuals.mjs` が未完了案件を読み取り、CLIで生成して完成したPNGを認証付きのアプリ経由でDriveへ保存する。画像生成API・APIキー・APIスクリプトは使わない。

- **Codex CLI**: `codex exec --enable image_generation` の内蔵画像生成を使用。ログイン済みChatGPTアカウントで、無人実行からPNG保存まで実証済み。
- **Antigravity CLI**: `agy --print` と内蔵image-generatorを利用する呼び出しも実装。公式に機能はあるが、この環境での画像生成は未検証。IDE起動用の `antigravity` コマンドとは別物。権限やプランで利用できない場合は失敗として記録する。
- デフォルトは検証済みのCodex CLI／漫画形式。CLIの利用枠・ログイン状態に依存する。別サービスへ自動切替しない。

## 実行例

```bash
npm run generate:visuals -- --dry-run
npm run generate:visuals -- --limit 1
npm run generate:visuals -- --style infographic --project DRIVE_FOLDER_ID
npm run generate:visuals -- --provider antigravity --style infographic --project DRIVE_FOLDER_ID
```

`--model` は構成を考える推論モデルの指定であり、画像モデルの指定ではない。既定値はCodexが `gpt-6.1-sol`、Antigravityが `gemini-4-argon-medium`。`--project` を省略すると原稿がある未完了案件のみ対象にする。既存の完了した8枚形式を一括再生成しない。

## 再開・検査

- `flock` でこのPCの二重起動を防止。入力・方式・モデル・プロンプト版ごとに `.artifacts/visuals/` に原稿／プロンプト／CLIログ／生成PNG／状態を保存する。API認証情報はCLI子プロセスへ渡さない。
- CLI終了コードだけでは成功としない。PNGの存在・構造・解像度、ffmpegでのデコードを検査する。ネイティブ生成では1152×2048px等の9:16を指定する。サービスが異なる縦横比を返した場合も、切り抜き・変形をせず白い余白を加えて1080×1920pxに収める。APIは1080×1920px以外の保存を拒否する。CLIにも内容・日本語・約8コマの目視確認を指示するが、全件の人間による品質保証を意味しない。
- 保存失敗時は既存PNGから再開し、画像を生成し直さない。破損PNGはログとともに残るので、確認後に当該ファイルだけを削除して再試行できる。
- Driveへの保存前に原稿のハッシュを再確認し、生成中に原稿が変わった場合は409で拒否する。
- 失敗案件は自動実行では6時間待ってから再試行し、後続を処理する。明示的な `--project` では待機を解除して再試行できる。
- アプリの `POST /api/visuals/:projectId` は認証・案件範囲・PNG・入力一致を検査する。既存の同名PNGはDriveの更新として保存し、同じ案件でファイルを増殖させない。

## 定期実行

ユーザーsystemdの `yt-narrator-visuals.timer` が毎時15分に最大1案件を処理する。音声の毎時00分・最大4件とは独立している。このPCとユーザーサービスが稼働し、Codex CLIがログイン済みである必要がある。PC停止中は画像生成も停止する。アカウント利用枠を使うため無制限・無料とは扱わない。

```bash
systemctl --user status yt-narrator-visuals.timer
journalctl --user -u yt-narrator-visuals.service -n 50
systemctl --user start yt-narrator-visuals.service
systemctl --user disable --now yt-narrator-visuals.timer
```

`ops/systemd/` の設定を `~/.config/systemd/user/` に配置して `systemctl --user daemon-reload` と `systemctl --user enable --now yt-narrator-visuals.timer` で有効にする。環境が異なる場合はサービス内の絶対パスを修正する。

## 参照

- [OpenAI公式: Codex image generation](https://learn.chatgpt.com/docs/image-generation)
- [Antigravity公式: headless CLI](https://antigravity.google/docs/cli/headless/)
- [Antigravity公式: image-generator追加の更新履歴](https://antigravity.google/changelog)
