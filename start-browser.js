const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');

const DEBUG_PORT = 9222;
const HTTP_PORT = 8080;
const CHROME_PROFILE_PATH = 'C:\\Users\\' + (process.env.USERNAME || 'User') + '\\AppData\\Local\\Google\\Chrome\\User Data\\Default';

async function main() {
  const extPath = path.join(__dirname, 'chromevideo');
  const downloadDir = path.resolve(__dirname, 'data', 'downloads');
  
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Pre-configure Chrome download directory in Preferences
  const prefPath = path.join(CHROME_PROFILE_PATH, 'Default', 'Preferences');
  try {
    const defaultDir = path.dirname(prefPath);
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const prefs = {
      download: {
        default_directory: downloadDir,
        prompt_for_download: false,
        directory_upgrade: true
      },
      savefile: {
        default_directory: downloadDir
      }
    };
    fs.writeFileSync(prefPath, JSON.stringify(prefs));
    console.log('[Chrome] 已创建并预设默认下载目录为:', downloadDir);
  } catch (e) {
    console.error('[Chrome] 配置默认下载目录失败:', e.message);
  }

  console.log(`[Chrome] 正在通过 spawn 启动 Playwright Chromium...`);
  
  const executablePath = chromium.executablePath();
  
  const chromeArgs = [
    `--user-data-dir=${CHROME_PROFILE_PATH}`,
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox',
    'about:blank'
  ];

  const chromeProcess = spawn(executablePath, chromeArgs, {
    detached: true,
    stdio: 'ignore'
  });
  chromeProcess.unref();

  console.log('[Chrome] 启动成功');
  console.log('[HTTP Server] 启动在端口', HTTP_PORT);
  console.log('[HTTP Server] Chrome调试端口', DEBUG_PORT);

  const server = http.createServer(async (req, res) => {
    // ...
  });

  server.listen(HTTP_PORT + 1); // Avoid port 8080 collision with queue-server

  console.log('[Chrome] 发送POST请求示例:');
  console.log(`curl -X POST http://localhost:${HTTP_PORT}/open -H "Content-Type: application/json" -d '{"url":"https://www.douyin.com"}'`);
  console.log('[Chrome] 按 Ctrl+C 关闭');

  function getJson(endpoint) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${DEBUG_PORT}${endpoint}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  function sendCDPCommand(wsUrl, method, params = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const id = Date.now();

      ws.on('open', () => {
        ws.send(JSON.stringify({ id, method, params }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.close();
          resolve(msg.result);
        }
      });

      ws.on('error', reject);
    });
  }
}

main().catch(console.error);
