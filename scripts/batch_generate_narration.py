#!/usr/bin/env python3
"""
Google Drive 上の yt-narrator 案件フォルダから、
未生成のナレーション音声 (narration_tts.mp3) を検出し、
ローカルの edge-tts で一括高速生成して Google Drive へ自動アップロードするスクリプト。
"""

import os
import sys
import json
import time
import asyncio
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
import edge_tts

DEV_VARS_PATH = Path(__file__).resolve().parent.parent / ".dev.vars"

def load_env_vars():
    if not DEV_VARS_PATH.exists():
        raise FileNotFoundError(f"{DEV_VARS_PATH} が見つかりません。")
    vars_dict = {}
    with open(DEV_VARS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                vars_dict[k.strip()] = v.strip().strip('"').strip("'")
    return vars_dict

class GoogleDriveClient:
    def __init__(self, vars_dict):
        self.client_id = vars_dict["GOOGLE_CLIENT_ID"]
        self.client_secret = vars_dict["GOOGLE_CLIENT_SECRET"]
        self.refresh_token = vars_dict["GOOGLE_REFRESH_TOKEN"]
        self.access_token = None
        self.token_expiry = 0

    def get_token(self):
        if self.access_token and time.time() < self.token_expiry - 60:
            return self.access_token
        params = urllib.parse.urlencode({
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token"
        }).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=params)
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read())
            self.access_token = data["access_token"]
            self.token_expiry = time.time() + data.get("expires_in", 3600)
            return self.access_token

    def drive_request(self, endpoint, method="GET", data=None, headers=None):
        token = self.get_token()
        url = endpoint if endpoint.startswith("https://") else f"https://www.googleapis.com/drive/v3/{endpoint}"
        req_headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        if headers:
            req_headers.update(headers)
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        with urllib.request.urlopen(req) as res:
            content_type = res.headers.get("Content-Type", "")
            if "application/json" in content_type:
                return json.loads(res.read())
            return res.read()

    def get_file_content(self, file_id):
        return self.drive_request(f"files/{file_id}?alt=media").decode("utf-8", errors="replace")

    def upload_mp3(self, folder_id, file_name, mp3_bytes):
        token = self.get_token()
        boundary = "-------314159265358979323846"
        metadata = {"name": file_name, "parents": [folder_id], "mimeType": "audio/mp3"}
        metadata_part = f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(metadata)}\r\n".encode("utf-8")
        media_header = f"--{boundary}\r\nContent-Type: audio/mp3\r\n\r\n".encode("utf-8")
        delimiter = f"\r\n--{boundary}--\r\n".encode("utf-8")
        body = metadata_part + media_header + mp3_bytes + delimiter

        url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
            "Content-Length": str(len(body))
        }
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())

    def update_catalog_file(self, catalog_file_id, catalog_json):
        token = self.get_token()
        json_bytes = json.dumps(catalog_json, ensure_ascii=False, indent=2).encode("utf-8")
        url = f"https://www.googleapis.com/upload/drive/v3/files/{catalog_file_id}?uploadType=media"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
        req = urllib.request.Request(url, data=json_bytes, headers=headers, method="PATCH")
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())

async def synthesize_speech(text, voice="ja-JP-NanamiNeural", rate="+30%", pitch="+0Hz"):
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
    chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)

async def main():
    # '--pitch -10Hz' のように負の値が渡された際に argparse がオプションフラグと誤認するのを防ぐ
    processed_argv = []
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if (arg == "--pitch" or arg == "-p") and i + 1 < len(sys.argv) and not sys.argv[i+1].startswith("--"):
            processed_argv.append(f"--pitch={sys.argv[i+1]}")
            i += 2
        elif (arg == "--rate" or arg == "-r") and i + 1 < len(sys.argv) and not sys.argv[i+1].startswith("--"):
            processed_argv.append(f"--rate={sys.argv[i+1]}")
            i += 2
        else:
            processed_argv.append(arg)
            i += 1

    parser = argparse.ArgumentParser(description="未生成ナレーション音声の一括バッチ生成＆Driveアップロード")
    parser.add_argument("--limit", type=int, default=None, help="処理する最大件数（指定なしで未生成の全件）")
    parser.add_argument("--dry-run", action="store_true", help="実際の生成を行わず対象件数のみ確認")
    parser.add_argument("--voice", default="ja-JP-NanamiNeural", help="話者 (デフォルト: ja-JP-NanamiNeural)")
    parser.add_argument("--rate", default="+30%", help="速度 (デフォルト: +30%%)")
    parser.add_argument("--pitch", default="+0Hz", help="ピッチ (デフォルト: +0Hz, 例: -10Hz)")
    args = parser.parse_args(processed_argv)

    vars_dict = load_env_vars()
    drive = GoogleDriveClient(vars_dict)
    projects_folder_id = vars_dict.get("PROJECTS_FOLDER_ID", "19qNS_wUoFOzDy646-ssSC0Y0nU34YhMf")

    print("=" * 60)
    print("🎙️ yt-narrator ナレーション音声 一括バッチ生成ツール")
    print("=" * 60)

    # 1. カタログの取得
    print("1. Google Drive 上の _catalog.json を取得中...")
    cat_res = drive.drive_request(f"files?q='{projects_folder_id}'+in+parents+and+name='_catalog.json'+and+trashed=false&fields=files(id)")
    if not cat_res.get("files"):
        print("❌ _catalog.json が見つかりませんでした。")
        return
    cat_file_id = cat_res["files"][0]["id"]
    catalog_data = drive.drive_request(f"files/{cat_file_id}?alt=media")
    catalog = catalog_data if isinstance(catalog_data, dict) else json.loads(catalog_data.decode("utf-8"))

    projects = catalog.get("projects", [])
    # 未生成案件の抽出（narration_tts.txt があり、audio が未生成のもの）
    unprocessed = [p for p in projects if p.get("hasNarration") and not p.get("hasAudio")]

    print(f"📊 総プロジェクト数: {len(projects)} 件")
    print(f"🎯 音声未生成の案件: {len(unprocessed)} 件")

    if not unprocessed:
        print("🎉 すべての案件で音声生成が完了しています！")
        return

    targets = unprocessed[:args.limit] if args.limit else unprocessed
    print(f"🚀 今回の処理対象: {len(targets)} 件 (話者: {args.voice}, 速度: {args.rate}, ピッチ: {args.pitch})")

    if args.dry_run:
        print("\n【処理対象一覧 (最初の10件)】:")
        for i, p in enumerate(targets[:10], 1):
            print(f"  {i}. {p['name']}")
        if len(targets) > 10:
            print(f"  ...他 {len(targets) - 10} 件")
        print("\n💡 --dry-run モードのため実際の生成はスキップしました。")
        return

    # 2. 順次音声生成 ＆ Google Drive アップロード
    success_count = 0
    error_count = 0
    start_time = time.time()

    # プロジェクトIDをキーとしたマップ
    proj_map = {p["id"]: p for p in projects}

    for idx, p in enumerate(targets, 1):
        folder_id = p["id"]
        folder_name = p["name"]
        print(f"\n[{idx}/{len(targets)}] 処理中: {folder_name[:45]}...")

        try:
            # フォルダ内の narration_tts.txt を探す
            q = f"'{folder_id}' in parents and name = 'narration_tts.txt' and trashed = false"
            txt_search = drive.drive_request(f"files?q={urllib.parse.quote(q)}&fields=files(id,size)")
            txt_files = txt_search.get("files", [])
            if not txt_files:
                print("  ⚠️ narration_tts.txt が見つかりませんでした。スキップします。")
                error_count += 1
                continue

            txt_id = txt_files[0]["id"]
            text_content = drive.get_file_content(txt_id).strip()
            if not text_content:
                print("  ⚠️ 原稿テキストが空でした。スキップします。")
                error_count += 1
                continue

            # 音声合成
            t0 = time.time()
            mp3_bytes = await synthesize_speech(text_content, voice=args.voice, rate=args.rate, pitch=args.pitch)
            tts_sec = time.time() - t0
            mp3_size_kb = len(mp3_bytes) / 1024

            # Google Drive へアップロード
            t1 = time.time()
            up_res = drive.upload_mp3(folder_id, "narration_tts.mp3", mp3_bytes)
            up_sec = time.time() - t1
            uploaded_id = up_res.get("id", "")

            print(f"  ✅ 音声生成: {tts_sec:.1f}秒 ({mp3_size_kb:.1f}KB, {len(text_content)}文字) | Drive保存: {up_sec:.1f}秒 (ID: {uploaded_id[:12]}...)")

            # カタログ更新用
            if folder_id in proj_map:
                proj_map[folder_id]["hasAudio"] = True
                proj_map[folder_id]["audioFileId"] = uploaded_id
                proj_map[folder_id]["audioFileSize"] = len(mp3_bytes)

            success_count += 1

        except Exception as e:
            print(f"  ❌ エラー発生: {e}")
            error_count += 1

    total_sec = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"🏁 バッチ処理完了！ 所要時間: {total_sec:.1f} 秒")
    print(f"✅ 成功: {success_count} 件 | ❌ 失敗: {error_count} 件")
    print("=" * 60)

    # 3. カタログの更新
    if success_count > 0:
        print("📝 最新状態を Google Drive の _catalog.json へ反映中...")
        new_projects = list(proj_map.values())
        catalog["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        catalog["audioProjects"] = sum(1 for p in new_projects if p.get("hasAudio"))
        catalog["completedProjects"] = sum(1 for p in new_projects if p.get("status") == "COMPLETED")
        catalog["partialProjects"] = sum(1 for p in new_projects if p.get("status") != "COMPLETED")
        catalog["projects"] = new_projects

        drive.update_catalog_file(cat_file_id, catalog)
        print("🎉 _catalog.json を更新しました！ダッシュボード上の音声バッチも即時反映されます。")

if __name__ == "__main__":
    asyncio.run(main())
