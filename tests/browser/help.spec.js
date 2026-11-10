import {test, expect} from '@playwright/test';

test('help opens from login, explains the architecture and links to the operating guide', async ({page}) => {
  await page.route('**/api/auth/status', route => route.fulfill({contentType:'application/json', body:JSON.stringify({authenticated:false})}));
  await page.goto('/');
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', {name:'使い方・構成図を見る'}).click();
  const help = await popup;
  await expect(help.getByRole('heading', {level:1})).toContainText('全体のつながり');
  await expect(help.getByRole('img', {name:'システム全体の構成図'})).toBeVisible();
  await expect(help.locator('#schedule')).toContainText('最大2件');
  await help.getByText('Cloudflareでの公開が「R2有効化待ち」のままです。', {exact:true}).click();
  await expect(help.locator('details[open]')).toContainText('10042');
  const brokenAnchors = await help.locator('a[href^="#"]').evaluateAll(links => links.map(link=>link.getAttribute('href')).filter(href=>!document.getElementById(href.slice(1))));
  expect(brokenAnchors).toEqual([]);
  await expect(help.getByRole('link', {name:'公開動画の運用手順'})).toHaveAttribute('href', /docs\/PUBLIC_VIDEO_LIBRARY\.md$/);
});

test('help remains readable on mobile and its diagram scrolls inside the page', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/help.html');
  await expect(page.getByRole('heading', {level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.diagram').evaluate(node=>node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByRole('link', {name:'04 画面の使い方',exact:true}).click();
  await expect(page.locator('#viewing')).toContainText('0.5〜2倍の7段階');
  await expect(page.locator('#publishing')).toContainText('稼働状況を自動取得した表示ではありません');
});
