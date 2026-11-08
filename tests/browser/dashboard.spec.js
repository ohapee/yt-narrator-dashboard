import { test, expect } from "@playwright/test";

test("login, parallel partial loading, quoted titles and durable job history", async ({page}) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let authenticated = false;
  const project = {id: "project00001", name: "20261108_John's <test> 動画", status: "GENERATING", mangaCount: 0, titleCount: 0, hasNarration: true};
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const fulfill = (data, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(data)});
    if (path === "/api/auth/status") return fulfill({authenticated});
    if (path === "/api/auth/login") {authenticated = true; return fulfill({success: true});}
    if (path === "/api/projects") return fulfill({success: true, projects: [project]});
    if (path === "/api/overview") return fulfill({success: true, totalProjects: 1});
    if (path === "/api/queues") return fulfill({success: false, error: "temporary"}, 503);
    if (path === "/api/jobs") return fulfill({success: true, counts: {queued: 0, running: 0, retry_wait: 0, failed: 1}, nextScheduledAt: "2026-11-09T00:00:00Z", jobs: [{id: "a".repeat(64), projectName: project.name, status: "failed", attempts: 3, settings: {voice: "ja-JP-NanamiNeural", speed: 1.3}, events: [], error: "TTS timeout"}]});
    if (path === "/api/jobs/retry") return fulfill({success: true});
    if (path === "/api/project/project00001") return fulfill({success: true, projectId: project.id, files: [], mangaImages: [], titleImages: [], narrationText: "テスト原稿", hasAudio: false});
    return fulfill({error: "unexpected " + path}, 404);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "yt-narrator 管理画面"})).toBeVisible();
  await page.getByLabel("パスワード").fill("test-password");
  await page.getByRole("button", {name: "ログイン", exact: true}).click();
  await expect(page.locator("#projects-grid")).toContainText("John's <test> 動画");
  await expect(page.locator("#data-refresh-status")).toContainText("キューの取得に失敗");
  await page.locator("[data-project-id]").click();
  await expect(page.locator("#modal-project-title")).toContainText("John's <test> 動画");
  await expect(page.locator("#narration-text-area")).toHaveValue("テスト原稿");
  await page.locator("#modal-close-bottom-btn").click();
  await page.locator("#job-history summary").click();
  await expect(page.locator("#job-history")).toContainText("TTS timeout");
  await page.getByRole("button", {name: "この案件を再試行"}).click();
  expect(errors).toEqual([]);
});

test("single-page comic is reused as title and creates one video scene", async ({page}) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const image = {id: "singleimage01", name: "visual_summary.png", url: "/api/image/singleimage01"};
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const fulfill = data => route.fulfill({contentType: "application/json", body: JSON.stringify(data)});
    if (path === "/api/auth/status") return fulfill({authenticated: true});
    if (path === "/api/projects") return fulfill({success: true, projects: [{id: "project00001", name: "20261108_図解テスト", status: "COMPLETED", mangaCount: 0, hasVisual: true, hasTitle: true, hasNarration: true, thumbnailId: image.id}]});
    if (path === "/api/overview") return fulfill({success: true, totalProjects: 1});
    if (path === "/api/queues") return fulfill({success: true, queues: []});
    if (path === "/api/jobs") return fulfill({success: true, jobs: [], counts: {}});
    if (path === "/api/project/project00001") return fulfill({success: true, projectId: "project00001", visualMode: "single_page", files: [], mangaImages: [image], titleImages: [image], narrationText: "1枚の画像を共用します。", hasAudio: false, metadata: {mode: "single_page", provider: "codex", reasoningModel: "gpt-6.1-sol", imageModel: null}});
    return route.fulfill({status: 404, body: ""});
  });
  await page.goto("/");
  await expect(page.locator("#projects-grid")).toContainText("1枚・約8コマ");
  await page.locator("[data-project-id]").click();
  await expect(page.locator("#modal-status-badge")).toContainText("タイトル共用");
  await page.locator('[data-modaltab="title-tab"]').click();
  await expect(page.locator("#title-cards-grid img")).toHaveAttribute("src", image.url);
  await page.locator('[data-modaltab="meta-tab"]').click();
  await expect(page.locator("#visual-generator-info")).toContainText("Codex CLI");
  await expect(page.locator("#visual-generator-info")).toContainText("CLIから非公開");
  await page.locator('[data-modaltab="video-tab"]').click();
  await expect(page.locator("#video-scenes-container .video-scene-card")).toHaveCount(1);
  await expect(page.locator("#video-scene-card-0")).toBeVisible();
  expect(errors).toEqual([]);
});
