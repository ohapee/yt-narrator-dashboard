import {test,expect} from '@playwright/test';

test('public gallery works without login, advances on ended, searches and repeats safely',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const entries=[{id:'a'.repeat(32),title:'20261110_最初の動画 <script>',duration:120,videoUrl:'/watch/media/first.mp4',posterUrl:'/watch/media/first.jpg'},{id:'b'.repeat(32),title:'20261109_次の動画',duration:65,videoUrl:'/watch/media/second.mp4',posterUrl:'/watch/media/second.jpg'}];
 await page.route('**/watch/data',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,configured:true,items:entries,cursor:null})}));
 await page.route('**/watch/media/**',route=>route.fulfill({status:404,body:''}));
 await page.goto('/watch/');await expect(page.locator('#list .card')).toHaveCount(2);await expect(page.locator('#now-title')).toContainText('最初の動画 <script>');await expect(page.locator('#player')).toHaveAttribute('src','/watch/media/first.mp4');
 await page.getByLabel('再生速度').selectOption('1.5');
 expect(await page.locator('#player').evaluate(video=>video.playbackRate)).toBe(1.5);
 await page.locator('#player').dispatchEvent('ended');await expect(page.locator('#player')).toHaveAttribute('src','/watch/media/second.mp4');
 await page.locator('#player').dispatchEvent('loadedmetadata');
 expect(await page.locator('#player').evaluate(video=>({rate:video.playbackRate,defaultRate:video.defaultPlaybackRate,preservesPitch:video.preservesPitch}))).toEqual({rate:1.5,defaultRate:1.5,preservesPitch:true});
 await page.locator('#continuous').uncheck();await page.locator('#player').dispatchEvent('ended');await expect(page.locator('#player')).toHaveAttribute('src','/watch/media/second.mp4');
 await page.locator('#repeat').check();await page.locator('#next').click();await expect(page.locator('#player')).toHaveAttribute('src','/watch/media/first.mp4');
 await page.locator('#search').fill('次の');await expect(page.locator('#list .card')).toHaveCount(1);
 await page.reload();await expect(page.getByLabel('再生速度')).toHaveValue('1.5');
 expect(await page.locator('#player').evaluate(video=>video.playbackRate)).toBe(1.5);
 expect(errors).toEqual([]);
});

test('an empty public library explains its state',async({page})=>{
 await page.route('**/watch/data',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,configured:false,items:[],cursor:null})}));await page.goto('/watch/');await expect(page.locator('#empty')).toContainText('まだ公開されていません');
});
