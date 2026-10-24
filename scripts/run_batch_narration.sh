#!/bin/bash
# ==============================================================================
# yt-narrator ナレーション音声 一括バッチ生成ランナー
#
# 【デフォルト設定】
# 話者: ja-JP-NanamiNeural（女性）
# 速度: +50%（約1.5倍速）
# ピッチ: -10Hz（落ち着いたトーン）
#
# 【使用例】
# 1. デフォルト設定で未生成の全件を一括生成:
#    ./scripts/run_batch_narration.sh
#
# 2. 件数を指定してテスト実行（例: 5件）:
#    ./scripts/run_batch_narration.sh --limit 5
#
# 3. 対象件数・一覧の事前確認（ドライラン）:
#    ./scripts/run_batch_narration.sh --dry-run
#
# 4. パラメータをカスタマイズ（例: 男性Keita、等倍速）:
#    ./scripts/run_batch_narration.sh --voice ja-JP-KeitaNeural --rate +0% --pitch +0Hz
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_BIN="/home/eiichi/src/python-tools/.venv/bin/python"

# 仮想環境の存在確認
if [ ! -f "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

cd "$ROOT_DIR"

# ユーザー指定の引数があればそれを優先、なければ推奨デフォルト値で実行
if [ $# -eq 0 ]; then
  echo "🚀 デフォルト設定（話者: ja-JP-NanamiNeural, 速度: +50%, ピッチ: -10Hz）で全件生成を開始します..."
  exec "$PYTHON_BIN" "$SCRIPT_DIR/batch_generate_narration.py" \
    --voice ja-JP-NanamiNeural \
    --rate "+50%" \
    --pitch "-10Hz"
else
  exec "$PYTHON_BIN" "$SCRIPT_DIR/batch_generate_narration.py" "$@"
fi
