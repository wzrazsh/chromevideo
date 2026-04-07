const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const RESULTS_DIR = path.join(DATA_DIR, 'results');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const QUEUE_STATES = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

let queue = [];
let clients = new Set();

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf-8');
      queue = JSON.parse(data);
    }
  } catch (err) {
    console.error('[Queue] Failed to load tasks:', err.message);
    queue = [];
  }
}

function saveTasks() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(queue, null, 2));
  } catch (err) {
    console.error('[Queue] Failed to save tasks:', err.message);
  }
}

function loadResults() {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    const results = {};
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf-8'));
      results[path.basename(file, '.json')] = data;
    }
    return results;
  } catch (err) {
    console.error('[Queue] Failed to load results:', err.message);
    return {};
  }
}

function saveResult(taskId, result) {
  try {
    const filePath = path.join(RESULTS_DIR, `${taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[Queue] Failed to save result:', err.message);
  }
}

function deleteTaskData(taskId) {
  try {
    const resultFile = path.join(RESULTS_DIR, `${taskId}.json`);
    if (fs.existsSync(resultFile)) {
      fs.unlinkSync(resultFile);
    }
    const targetDir = path.join(DATA_DIR, 'downloads', taskId);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[Queue] Failed to delete data for task ${taskId}:`, err.message);
  }
}

function notifyClients(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;

  console.log(`[${new Date().toISOString()}] [HTTP] ${method} ${pathname}`);

  if (url.pathname === '/tasks' && method === 'GET') {
    const pendingTasks = queue.filter(t => t.status === QUEUE_STATES.PENDING);
    const nextTask = pendingTasks.length > 0 ? pendingTasks[0] : null;
    sendJson(res, 200, { tasks: queue, nextTask });

  } else if (url.pathname === '/tasks' && method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.url) {
        return sendJson(res, 400, { error: 'Missing url field' });
      }
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url: body.url,
        status: QUEUE_STATES.PENDING,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      queue.push(task);
      saveTasks();
      notifyClients({ type: 'task_added', task });
      sendJson(res, 201, { success: true, task });

    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }

  } else if (url.pathname.startsWith('/tasks/') && method === 'PATCH') {
    const taskId = url.pathname.slice(7);
    try {
      const body = await parseBody(req);
      const task = queue.find(t => t.id === taskId);
      if (!task) {
        return sendJson(res, 404, { error: 'Task not found' });
      }
      if (body.status) {
        task.status = body.status;
        task.updatedAt = new Date().toISOString();
      }
      if (body.videoPath) {
        task.videoPath = body.videoPath;
      }
      saveTasks();
      notifyClients({ type: 'task_updated', task });
      sendJson(res, 200, { success: true, task });

    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }

  } else if (url.pathname === '/results' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { taskId, status, text, audioPath, videoPath, error, title } = body;

      const task = queue.find(t => t.id === taskId);
      if (!task) {
        return sendJson(res, 404, { error: 'Task not found' });
      }

      task.status = status || QUEUE_STATES.COMPLETED;
      task.updatedAt = new Date().toISOString();

      // Handle moving downloaded files to the correct target directory
      let finalVideoPath = videoPath;
      let finalAudioPath = audioPath;
      
      if (status === 'completed' || status === QUEUE_STATES.COMPLETED) {
        const targetDir = path.join(DATA_DIR, 'downloads', taskId);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const safeTitle = title ? title.replace(/[\\\/\?\<\>\"\|:：\*]/g, '_').substring(0, 100) : 'video';

        if (videoPath) {
          // If the extension returns a relative path (e.g. task_id/filename.mp4), resolve it to absolute
          const absVideoPath = path.isAbsolute(videoPath) 
            ? videoPath 
            : path.join(DATA_DIR, 'downloads', videoPath);

          if (fs.existsSync(absVideoPath)) {
            finalVideoPath = path.join(targetDir, `${safeTitle}.mp4`);
            if (path.resolve(absVideoPath) !== path.resolve(finalVideoPath)) {
              try {
                fs.copyFileSync(absVideoPath, finalVideoPath);
                fs.unlinkSync(absVideoPath); // Try to remove original
                console.log(`[Queue] Moved video to: ${finalVideoPath}`);
              } catch (e) {
                console.error(`[Queue] Failed to move video: ${e.message}`);
                finalVideoPath = absVideoPath; // Keep original if failed
              }
            } else {
              finalVideoPath = absVideoPath;
            }
          }
        }

        if (audioPath) {
          const absAudioPath = path.isAbsolute(audioPath) 
            ? audioPath 
            : path.join(DATA_DIR, 'downloads', audioPath);

          if (fs.existsSync(absAudioPath)) {
            finalAudioPath = path.join(targetDir, `${safeTitle}.mp3`);
            if (path.resolve(absAudioPath) !== path.resolve(finalAudioPath)) {
              try {
                fs.copyFileSync(absAudioPath, finalAudioPath);
                fs.unlinkSync(absAudioPath); // Try to remove original
                console.log(`[Queue] Moved audio to: ${finalAudioPath}`);
              } catch (e) {
                console.error(`[Queue] Failed to move audio: ${e.message}`);
                finalAudioPath = absAudioPath; // Keep original if failed
              }
            } else {
              finalAudioPath = absAudioPath;
            }
          }
        }
      }

      const result = {
        taskId,
        status: task.status,
        text,
        audioPath: finalAudioPath,
        videoPath: finalVideoPath,
        error,
        completedAt: new Date().toISOString()
      };

      saveResult(taskId, result);
      saveTasks();
      notifyClients({ type: 'result_received', task, result });

      sendJson(res, 200, { success: true, result });

    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }

  } else if (url.pathname.startsWith('/results/') && method === 'GET') {
    const taskId = url.pathname.slice(9);
    const results = loadResults();
    const result = results[taskId];
    if (!result) {
      return sendJson(res, 404, { error: 'Result not found' });
    }
    sendJson(res, 200, result);

  } else if (url.pathname === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', queueLength: queue.length });

  } else if (url.pathname === '/tasks' && method === 'DELETE') {
    try {
      const body = await parseBody(req);
      if (!body.taskIds || !Array.isArray(body.taskIds)) {
        return sendJson(res, 400, { error: 'Missing or invalid taskIds field' });
      }
      
      const idsToDelete = new Set(body.taskIds);
      queue = queue.filter(t => !idsToDelete.has(t.id));
      
      // Clean up local files
      body.taskIds.forEach(id => deleteTaskData(id));
      
      saveTasks();
      notifyClients({ type: 'tasks_deleted', taskIds: body.taskIds });
      
      sendJson(res, 200, { success: true, deletedCount: body.taskIds.length });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }

  } else if (method === 'GET') {
    let filePath = url.pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, url.pathname);
    let extname = path.extname(filePath);
    
    // Prevent directory traversal attacks
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }

    // Default to HTML if no extension (useful for single-page apps, though not strictly needed here)
    if (!extname) {
      filePath += '.html';
      extname = '.html';
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT') {
          sendJson(res, 404, { error: 'Not found' });
        } else {
          sendJson(res, 500, { error: 'Internal server error' });
        }
      } else {
        const contentType = MIME_TYPES[extname] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });

  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function startWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    clients.add(ws);

    ws.send(JSON.stringify({ type: 'connected', queueLength: queue.length }));

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      clients.delete(ws);
    });
  });

  return wss;
}

function start() {
  loadTasks();

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('[Server] Unhandled error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });

  startWebSocket(server);

  server.listen(PORT, () => {
    console.log(`[Queue Server] Running on http://localhost:${PORT}`);
    console.log(`[Queue Server] WebSocket on ws://localhost:${PORT}/ws`);
    console.log(`[Queue Server] Tasks file: ${TASKS_FILE}`);
    console.log(`[Queue Server] Results dir: ${RESULTS_DIR}`);
  });

  process.on('SIGINT', () => {
    console.log('\n[Queue Server] Shutting down...');
    saveTasks();
    server.close(() => process.exit(0));
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, QUEUE_STATES };
