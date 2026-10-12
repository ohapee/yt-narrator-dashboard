/**
 * 全64プロジェクトをスキャンして _catalog.json を生成・Google Drive へアップロードするスクリプト
 */
const fs = require("fs");
const path = require("path");

const devVarsPath = path.join(__dirname, "../.dev.vars");
const vars = Object.fromEntries(
  fs.readFileSync(devVarsPath, "utf8")
    .split("\n")
    .filter(l => l.includes("="))
    .map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"|"$/g, "")];
    })
);

async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: vars.GOOGLE_CLIENT_ID,
    client_secret: vars.GOOGLE_CLIENT_SECRET,
    refresh_token: vars.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });
  const tRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: params });
  const data = await tRes.json();
  if (!data.access_token) {
    throw new Error("OAuth トークン取得失敗: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function driveFetch(endpoint, token, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.headers || {})
  };
  const url = endpoint.startsWith("https://") ? endpoint : `https://www.googleapis.com/drive/v3/${endpoint}`;
  return await fetch(url, { ...options, headers });
}

async function main() {
  const token = await getAccessToken();
  const rootId = vars.TARGET_FOLDER_ID || "1Q2EneDppL5P92Efk8BU5onQD4O8c9SS3";

  // projects フォルダの検索
  console.log("1. projects フォルダを検索中...");
  const pFolderRes = await driveFetch(
    `files?q='${rootId}'+in+parents+and+name='projects'+and+trashed=false&fields=files(id)&spaces=drive`,
    token
  );
  const pFolderData = await pFolderRes.json();
  const projectsFolderId = pFolderData.files?.[0]?.id || "19qNS_wUoFOzDy646-ssSC0Y0nU34YhMf";
  console.log(`projects フォルダID: ${projectsFolderId}`);

  // サブフォルダ全件取得
  console.log("2. projects フォルダ内の全サブフォルダ一覧を取得中...");
  let pageToken = "";
  let folders = [];
  do {
    const q = `'${projectsFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`;
    const url = `files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime,modifiedTime)&pageSize=1000${pageToken ? "&pageToken=" + pageToken : ""}`;
    const res = await driveFetch(url, token);
    const data = await res.json();
    folders.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log(`取得サブフォルダ数: ${folders.length} 件`);
  folders.sort((a, b) => b.name.localeCompare(a.name));

  console.log("3. 各フォルダの成果物構成を並列スキャン中...");
  const catalog = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < folders.length; i += BATCH_SIZE) {
    const batch = folders.slice(i, i + BATCH_SIZE);
    process.stdout.write(`スキャン進捗: ${i + 1}〜${Math.min(i + BATCH_SIZE, folders.length)} / ${folders.length} 件...\r`);

    const results = await Promise.all(batch.map(async (folder) => {
      try {
        const q = `'${folder.id}' in parents and trashed = false`;
        const res = await driveFetch(
          `files?q=${encodeURIComponent(q)}&fields=files(id,name,size,mimeType)&pageSize=100`,
          token
        );
        const data = await res.json();
        const files = data.files || [];

        const mangaImages = files.filter(f => /^manga_\d+\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        const titleImages = files.filter(f => /^(00_title|title).*\.(jpg|jpeg|png)$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        const hasNarration = files.some(f => f.name === "narration_tts.txt");
        const hasYoutube = files.some(f => f.name === "youtube.json");
        const audioFile = files.find(f => f.name === "narration_tts.mp3" || f.name === "narration.mp3");
        const hasAudio = !!audioFile;
        const mangaDoneFile = files.find(f => f.name === "manga_done.json");

        let thumbnailId = "";
        const finalTitle = titleImages.find(t => t.name.includes("final")) ||
                           titleImages.find(t => t.name.includes("perfected")) ||
                           titleImages.find(t => t.name === "00_title.jpg") ||
                           titleImages[0];
        if (finalTitle) {
          thumbnailId = finalTitle.id;
        } else if (mangaImages[0]) {
          thumbnailId = mangaImages[0].id;
        }

        let status = "GENERATING";
        if (mangaImages.length >= 8 && hasNarration && mangaDoneFile) {
          status = "COMPLETED";
        } else if (mangaImages.length > 0 || titleImages.length > 0) {
          status = "PARTIAL";
        }

        return {
          id: folder.id,
          name: folder.name,
          createdTime: folder.createdTime,
          modifiedTime: folder.modifiedTime,
          totalFiles: files.length,
          mangaCount: mangaImages.length,
          titleCount: titleImages.length,
          hasNarration,
          hasAudio,
          audioFileId: audioFile?.id || "",
          audioFileSize: audioFile?.size ? Number(audioFile.size) : 0,
          hasYoutube,
          hasMetadata: !!mangaDoneFile,
          hasTitle: titleImages.length > 0,
          thumbnailId,
          status
        };
      } catch (err) {
        return {
          id: folder.id,
          name: folder.name,
          createdTime: folder.createdTime,
          modifiedTime: folder.modifiedTime,
          totalFiles: 0,
          mangaCount: 0,
          titleCount: 0,
          hasNarration: false,
          hasAudio: false,
          audioFileId: "",
          audioFileSize: 0,
          hasYoutube: false,
          hasMetadata: false,
          hasTitle: false,
          thumbnailId: "",
          status: "UNKNOWN"
        };
      }
    }));
    catalog.push(...results);
  }

  console.log(`\nスキャン完了！ 総件数: ${catalog.length} 件`);
  const catalogJson = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalProjects: catalog.length,
    completedProjects: catalog.filter(p => p.status === "COMPLETED").length,
    audioProjects: catalog.filter(p => p.hasAudio).length,
    partialProjects: catalog.filter(p => p.status !== "COMPLETED").length,
    projects: catalog
  };

  const jsonStr = JSON.stringify(catalogJson, null, 2);
  const jsonBuffer = Buffer.from(jsonStr, "utf8");

  // 4. Google Drive の projects フォルダ直下に _catalog.json を保存
  console.log("4. Google Drive へ _catalog.json を保存中...");
  const checkRes = await driveFetch(
    `files?q='${projectsFolderId}'+in+parents+and+name='_catalog.json'+and+trashed=false&fields=files(id)`,
    token
  );
  const checkData = await checkRes.json();
  const existingFile = checkData.files?.[0];

  if (existingFile) {
    console.log(`既存の _catalog.json (ID: ${existingFile.id}) を更新します...`);
    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: jsonBuffer
      }
    );
    console.log("更新完了ステータス:", patchRes.status);
  } else {
    console.log("新規 _catalog.json をアップロードします...");
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = {
      name: "_catalog.json",
      parents: [projectsFolderId],
      mimeType: "application/json"
    };

    const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaHeader = `--${boundary}\r\nContent-Type: application/json\r\n\r\n`;

    const encoder = new TextEncoder();
    const p1 = encoder.encode(metadataPart);
    const p2 = encoder.encode(mediaHeader);
    const p3 = jsonBuffer;
    const p4 = encoder.encode(closeDelimiter);

    const body = new Uint8Array(p1.length + p2.length + p3.length + p4.length);
    let offset = 0;
    body.set(p1, offset); offset += p1.length;
    body.set(p2, offset); offset += p2.length;
    body.set(p3, offset); offset += p3.length;
    body.set(p4, offset);

    const postRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(body.length)
        },
        body
      }
    );
    console.log("新規作成完了ステータス:", postRes.status);
    const postData = await postRes.json();
    console.log("作成されたファイルID:", postData.id);
  }

  console.log("🎉 _catalog.json の作成・保存が正常に完了しました！");
}

main().catch(console.error);
