const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const DEBUG_PORT = 9222;
const CHROME_PROFILE_PATH = 'C:\\Users\\' + (process.env.USERNAME || 'User') + '\\AppData\\Local\\Google\\Chrome\\User Data\\Default';

test('chromevideo extension', async () => {
  const extPath = path.join(__dirname, 'chromevideo');

  const context = await chromium.launchPersistentContext(CHROME_PROFILE_PATH, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      `--remote-debugging-port=${DEBUG_PORT}`
    ],
  });

  console.log('[Chrome] 扩展已加载');
  console.log('[Chrome] 调试端口:', DEBUG_PORT);
  console.log('[Chrome] 扩展会自动轮询 http://localhost:8080/tasks 获取任务');
  console.log('[Chrome] 按 Ctrl+C 关闭浏览器');

  await new Promise(() => {});
});
