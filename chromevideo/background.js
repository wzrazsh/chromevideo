const QUEUE_SERVER = 'http://localhost:8080';
const POLL_INTERVAL = 5000;

let pollingTimer = null;
let currentTask = null;

async function log(level, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  console.log(prefix, ...args);
}

async function fetchJson(url, options = {}) {
  const method = options.method || 'GET';
  log('info', '[HTTP] -->', method, url);
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    log('info', '[HTTP] <--', method, url, 'OK', JSON.stringify(data));
    return data;
  } catch (err) {
    log('error', '[HTTP] <--', method, url, 'FAILED:', err.message);
    throw new Error(`fetchJson failed: ${err.message}`);
  }
}

async function getBilibiliCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: '.bilibili.com' }, (cookies) => {
      const cookieObj = {};
      cookies.forEach(cookie => {
        cookieObj[cookie.name] = cookie.value;
      });
      resolve(cookieObj);
    });
  });
}

async function fetchWithCookies(url, cookies) {
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  
  log('info', '[API] --> GET', url);
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieStr
    }
  });
  if (!response.ok) {
    log('error', '[API] <--', url, 'HTTP', response.status);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  log('info', '[API] <--', url, 'OK', JSON.stringify(data));
  return data;
}

async function getTasks() {
  try {
    const data = await fetchJson(`${QUEUE_SERVER}/tasks`);
    return data;
  } catch (err) {
    log('error', 'Failed to fetch tasks:', err.message);
    return null;
  }
}

async function updateTaskStatus(taskId, status, extra = {}) {
  try {
    const data = await fetchJson(`${QUEUE_SERVER}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra })
    });
    return data;
  } catch (err) {
    log('error', 'Failed to update task status:', err.message);
    return null;
  }
}

async function reportResult(taskId, result) {
  try {
    const data = await fetchJson(`${QUEUE_SERVER}/results`, {
      method: 'POST',
      body: JSON.stringify({ taskId, ...result })
    });
    return data;
  } catch (err) {
    log('error', 'Failed to report result:', err.message);
    return null;
  }
}

function getExtensionPath() {
  return `${currentTask.id}`;
}

async function downloadBilibiliVideo(url, taskId) {
  log('info', 'Starting B站 video download:', url);

  const cookies = await getBilibiliCookies();
  log('info', 'Got cookies, count:', Object.keys(cookies).length);

  const bvidMatch = url.match(/BV\w+/);
  if (!bvidMatch) {
    throw new Error('Invalid B站 URL: missing BV id');
  }
  const bvid = bvidMatch[0];

  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const viewData = await fetchWithCookies(apiUrl, cookies);
  if (!viewData.data) {
    throw new Error('Failed to get video metadata');
  }

  const { title, aid, cid } = viewData.data;
  const cleanTitle = title.replace(/[\\\/\?\<\>\"\|:：\*]/g, '_').substring(0, 100);

  log('info', `Video: ${title} (aid=${aid}, cid=${cid})`);

  const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`;
  const playData = await fetchWithCookies(playUrlApi, cookies);

  let videoUrl = null;
  let audioUrl = null;

  if (playData.data && playData.data.durl) {
    const durl = playData.data.durl[0];
    videoUrl = durl.url;
  }

  if (playData.data && playData.data.dash) {
    const dash = playData.data.dash;
    if (dash.video && dash.video[0]) {
      videoUrl = dash.video[0].baseUrl || dash.video[0].url;
    }
    if (dash.audio && dash.audio[0]) {
      audioUrl = dash.audio[0].baseUrl || dash.audio[0].url;
    }
  }

  if (!videoUrl && !audioUrl) {
    throw new Error('Failed to get video/audio URLs');
  }

  const downloadPath = getExtensionPath();
  const files = [];

  async function downloadWithChrome(url, filename) {
    log('info', `Downloading: ${filename}`);
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: `${downloadPath}/${filename}`,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          log('info', `Download started: ${filename}, id: ${downloadId}`);
          function listener(delta) {
            if (delta.id === downloadId && delta.state) {
              if (delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(listener);
                // 查找下载完成后的真实绝对路径
                chrome.downloads.search({ id: downloadId }, (results) => {
                  if (results && results.length > 0) {
                    resolve(results[0].filename);
                  } else {
                    resolve(`${downloadPath}/${filename}`); // Fallback
                  }
                });
              } else if (delta.state.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(listener);
                reject(new Error('Download interrupted'));
              }
            }
          }
          chrome.downloads.onChanged.addListener(listener);
        }
      });
    });
  }

  try {
    let videoPath = null;
    let audioPath = null;

    if (videoUrl) {
      const videoFilename = `${cleanTitle}.mp4`;
      videoPath = await downloadWithChrome(videoUrl, videoFilename);
      files.push(videoFilename);
    }

    if (audioUrl) {
      const audioFilename = `${cleanTitle}.mp3`;
      audioPath = await downloadWithChrome(audioUrl, audioFilename);
      files.push(audioFilename);
    }

    log('info', 'Download completed:', { videoPath, audioPath, files });
    return { videoPath, audioPath, title: cleanTitle, files };
  } catch (err) {
    log('error', 'Download failed:', err.message);
    throw err;
  }
}

async function processTask(task) {
  if (currentTask) {
    log('info', 'Skipping task, already processing:', currentTask.id);
    return;
  }

  currentTask = task;
  log('info', 'Processing task:', task.id, task.url);

  try {
    await updateTaskStatus(task.id, 'downloading');

    const tab = await chrome.tabs.create({ url: task.url, active: false });
    log('info', 'Opened tab:', tab.id, task.url);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const result = await downloadBilibiliVideo(task.url, task.id);

    await chrome.tabs.remove(tab.id);

    await reportResult(task.id, {
      status: 'completed',
      videoPath: result.videoPath,
      audioPath: result.audioPath,
      title: result.title
    });

    log('info', 'Task completed:', task.id);
  } catch (err) {
    log('error', 'Task failed:', task.id, err.message);

    await reportResult(task.id, {
      status: 'failed',
      error: err.message
    });
  } finally {
    currentTask = null;
  }
}

async function pollTasks() {
  log('info', '[POLL] Checking queue server...');
  
  const data = await getTasks();
  if (!data) {
    log('warn', '[POLL] Failed to get response from queue server');
    return;
  }

  if (!data.nextTask) {
    log('info', '[POLL] No pending tasks in queue');
    return;
  }

  if (currentTask) {
    log('info', '[POLL] Already processing task, skipping');
    return;
  }

  log('info', '[POLL] Found pending task:', data.nextTask.id, data.nextTask.url);
  await processTask(data.nextTask);
}

function startPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
  }
  log('info', 'Starting task polling, interval:', POLL_INTERVAL, 'ms');
  pollingTimer = setInterval(pollTasks, POLL_INTERVAL);
  pollTasks();
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    log('info', 'Stopped task polling');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log('info', 'Chrome Video 插件已安装');
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  log('info', '浏览器启动，插件已加载');
  startPolling();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getStatus') {
    sendResponse({
      polling: !!pollingTimer,
      currentTask: currentTask ? { id: currentTask.id, url: currentTask.url } : null
    });
  } else if (message.action === 'startPolling') {
    startPolling();
    sendResponse({ success: true });
  } else if (message.action === 'stopPolling') {
    stopPolling();
    sendResponse({ success: true });
  }
  return true;
});

  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
      log('info', 'Download finished:', delta);
      chrome.downloads.search({ id: delta.id }, (results) => {
        if (results && results.length > 0) {
          const item = results[0];
          // We can use item.filename which is the absolute path to the downloaded file
          log('info', `Actual downloaded file path: ${item.filename}`);
          // The background page doesn't directly handle the moving, we just wait for both files
          // to finish downloading.
        }
      });
    }
  });

log('info', 'Background service worker started');
startPolling();
