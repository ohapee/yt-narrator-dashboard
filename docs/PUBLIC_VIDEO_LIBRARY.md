# 新方式の画像＋音声から作る公開動画ライブラリ

## 構成と公開範囲

- PC側のFFmpegで `visual_summary.png` と完成MP3を結合し、1080×1920・30fps・H.264/AACのMP4を作る。画像全体を表示し、音声全尺で再生する。追加字幕・ズームは付けない。
- MP4と270×480のJPEGサムネイルをCloudflare R2へ保存し、Cloudflare Workerの `/watch/` で公開する。
- 公開一覧にはタイトル・再生時間・サムネイル・動画だけを返す。Driveの画像／原稿／OAuth認証情報や管理画面は公開しない。
- 動画を最初に再生する操作は視聴者が行う。以後は「連続再生」が有効なら終了後に次へ進む。ブラウザが音声付き再生を制限した場合は再生ボタンを案内する。
- 前後の移動、検索、最後から先頭への繰り返し、`?video=公開ID`の共有URLに対応する。
- 再生速度は0.5／0.75／1／1.25／1.5／1.75／2倍から選択できる。速度は次の動画へ引き継ぎ、ブラウザのローカル保存が使える場合は再読み込み後も維持する。音の高さを維持する設定を使用する。
- これは配信・閲覧用MP4であり、YouTubeへの自動投稿は行わない。再生時間は音声全尺のため、YouTube Shortsへの投稿条件に収まるとは限らない。

## Cloudflare公開の自動化

2026-11-10時点のアカウントはR2が未有効で、Cloudflare APIが10042を返している。ユーザーsystemdの自動処理は起動済みで、15分ごとに確認する。契約の有効化そのものは[Cloudflare Dashboard](https://dash.cloudflare.com/)の対象アカウント → Storage & databases → R2 → Overviewから、アカウント所有者が条件・料金を確認して行う。

有効化後は追加コマンドなしで、次の処理を順番に行う。

1. 本番の管理者専用公開APIが既に利用可能か確認する。
2. 未設定ならR2の `yt-narrator-public-videos` を確認する。未有効の10042では処理を止め、正常な待機状態として次回へ回す。
3. R2が有効でバケットがなければ作成する。既存のバケットは維持する。
4. 通常の `wrangler.json` でWorkerをデプロイし、`PUBLIC_VIDEOS`バインディングを接続する。
5. 公開APIが利用可能になったことを再確認する。確認失敗時には動画公開を開始しない。
6. 未公開の新方式画像＋音声を1回最大2件、動画化・アップロードして一覧へ公開する。既に公開済みの同じ版はスキップする。

セットアップ後はR2作成やデプロイを繰り返さず、動画公開サイクルだけを実行する。音声・画像の既存サービスとは別で動作する。PCの稼働・ユーザーsystemd・管理者認証が必要で、初回セットアップにはこのPCのWrangler認証とインストール済み依存関係が必要。

```bash
# サイクルを今すぐ1回実行（未有効なら待機状態で正常終了）
npm run automate:videos -- --limit 2

# ホスティングの確認・セットアップだけ。動画の作成はしない
npm run automate:videos -- --setup-only

# 状態・次回予定・ログ
cat .artifacts/public-videos/automation.json
systemctl --user list-timers yt-narrator-videos.timer
journalctl --user -u yt-narrator-videos.service -n 50
```

`automation.json` は `checking` → `waiting_for_r2`、または `creating_bucket` → `deploying` → `publishing` → `ready` の状態を記録する。障害は `error` として残り、次のタイマー実行で再確認する。生成・保存ごとの状態は別の `state.json` に記録する。

通常の `npm run deploy` にR2バインディングを含めたため、後日のデプロイで公開先が外れる問題を防ぐ。`npm run deploy:videos` は同じコマンドの別名。以前の別設定ファイルは廃止した。R2未有効の間は本番デプロイも待機するが、既に稼働中のWorkerの音声・画像関連APIは継続する。

バケットをインターネットへ直接公開する必要はなく、公開マニフェストを確認するWorkerだけが動画を配信する。R2には利用量に応じた課金があるため、[公式料金表](https://developers.cloudflare.com/r2/pricing/)と[契約手順](https://developers.cloudflare.com/r2/get-started/)を確認する。契約や支払情報の操作をスクリプトから行うことはない。

本番公開URLは `https://yt-narrator-dashboard.eiichi-okamine.workers.dev/watch/`。現在はR2の契約有効化待ちであり、本番動画の配信完了を意味しない。ローカルR2では実案件の作成・保存・再生・シークを検証済み。

## 動画作成と公開

```bash
# 作成対象のみ確認
npm run publish:videos -- --dry-run

# 動画だけをPC上へ作る（R2未有効でも実行可能）
npm run publish:videos -- --project DRIVE_FOLDER_ID --render-only --limit 1

# 未公開の新方式画像＋音声を最大2件、動画化して公開
npm run publish:videos -- --limit 2

# 既存分の初回公開。1回の上限は100件
npm run publish:videos -- --limit 100
```

既定の接続先は本番Worker。ローカルR2で検証する場合は次を使う。

```bash
npm run dev:videos -- --ip 127.0.0.1 --persist-to /tmp/yt-narrator-video-preview
DASHBOARD_URL=http://localhost:8792 npm run publish:videos -- --project DRIVE_FOLDER_ID --limit 1
```

ローカル一覧は http://localhost:8792/watch/ 。ローカルR2への保存は本番公開にはならない。CLIの管理者認証は画像ランナーと同じく環境変数`ADMIN_TOKEN`または`.admin-password`を使う。

## 処理と再開

1. カタログから新方式画像と音声がある案件を選ぶ。従来8枚形式だけの案件は対象外。
2. 案件ID、画像とMP3のDriveファイルID・更新日時・容量、レンダー版からSHA-256を作る。同じ版が公開済みならスキップする。
3. 素材を認証付きAPIから取得し、`.artifacts/public-videos/公開ID/ハッシュ/`へ保存する。
4. FFmpegでMP4とJPEGを生成する。映像H.264・音声AAC・1080×1920・音声との時間一致をffprobeで検査する。動画の保存上限は25MB。静止画用に長めのキーフレーム間隔を指定して容量を抑える。
5. 管理者専用APIへMP4とJPEGを別々にアップロードする。再アップロード時は同じキーを再利用する。素材変更時は拒否する。
6. 両ファイルの保存後、公開マニフェストを作る。この成功前は、アップロード途中のファイルを公開ルートから取得できない。
7. 公開一覧へ反映する。R2の一覧はカーソルでページ末尾まで読み取る。Driveのカタログに公開状態を混ぜない。

ローカルの`state.json`に処理中・公開済み・失敗を保存し、`flock`で同じPCの二重起動を防ぐ。保存失敗時も既存MP4を再利用する。失敗案件は自動処理では6時間待ち、明示的な`--project`指定では待機を解除する。未完了の`.partial.mp4`は成功後のMP4と区別する。認証済み管理APIに保存するため、MP4をブラウザへ直接送る公開アップロード機能はない。

## 非公開と再公開

管理画面の「公開動画の管理」（`/publications.html`）から非公開にできる。公開マニフェストを取り下げ、一覧と新規の動画取得を停止する。動画ファイル自体は保持する。既にダウンロード・再生バッファに入った内容は回収できない。

非公開フラグを残すため、定期処理による自動再公開はしない。再公開する場合は案件を明示する。

```bash
npm run publish:videos -- --project DRIVE_FOLDER_ID --republish --limit 1
```

素材が同じなら保存済みのローカルMP4・R2素材を再利用する。原稿だけが変わっても、実際の画像／MP3が更新されるまでは公開動画を変更しない。

## 配信API

| 認証 | メソッド | パス | 内容 |
| --- | --- | --- | --- |
| 不要 | GET | `/watch/data?cursor=...` | 公開一覧。Driveの案件IDは返さない |
| 不要 | GET / HEAD | `/watch/media/:id/:hash.mp4` | 公開済みMP4。Range、If-Range、416対応 |
| 不要 | GET / HEAD | `/watch/media/:id/:hash.jpg` | 公開済みサムネイル |
| 管理者 | GET | `/api/publications` | 公開状態と管理用案件ID |
| 管理者 | POST | `/api/publications/:projectId/prepare` | 最新入力のハッシュと公開済み判定 |
| 管理者 | PUT | `/api/publications/:projectId/assets/:hash/video` | MP4保存（25MB以下） |
| 管理者 | PUT | `/api/publications/:projectId/assets/:hash/poster` | JPEG保存（1MB以下） |
| 管理者 | POST | `/api/publications/:projectId` | 公開確定 |
| 管理者 | POST | `/api/publications/:projectId/unpublish` | 非公開化と自動再公開の停止 |

公開メディアはマニフェストの存在とハッシュを毎回確認し、未公開・旧版の推測URLを拒否する。動画・サムネイルは`no-store`で配信し、取り下げ後のキャッシュ再利用を抑える。

## 定期実行

`ops/systemd/yt-narrator-videos.service`と`.timer`をこのPCへインストールして有効化済み。サービスは `automate-publication.mjs --limit 2` を実行し、R2未有効の間も定期確認する。手動の初期公開と同時に起動しても、ファイルロックで競合を防ぐ。

別PCへ移設する場合は、サービス内の絶対パスとCLIへのPATHを調整し、同じ管理者認証・Wrangler認証を用意して登録する。

```bash
mkdir -p ~/.config/systemd/user
cp ops/systemd/yt-narrator-videos.service ~/.config/systemd/user/
cp ops/systemd/yt-narrator-videos.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now yt-narrator-videos.timer

# 手動起動とログ
systemctl --user start yt-narrator-videos.service
journalctl --user -u yt-narrator-videos.service -n 50

# 自動処理の停止
systemctl --user disable --now yt-narrator-videos.timer
```

毎時00・15・30・45分に起動し、1回最大2件を作成・公開する。既存分もこの処理で順次公開する。音声00分、画像15分とは独立。PCが停止するとセットアップ確認・動画生成も停止するが、公開済みの動画はCloudflareから配信できる。ユーザーサービスのログアウト後の動作はホスト設定に依存する。

## 検証

自動テスト34件・ブラウザテスト4件が成功。R2未有効時に作成・デプロイしないこと、有効化後の作成→デプロイ→API確認の順序、既存バケットと既存公開環境の再利用、失敗時に公開へ進まないことをテストする。R2の契約有効化後の本番操作は、その時点でサービスの実行履歴から確認する。
