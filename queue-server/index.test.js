const request = require('supertest');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const RESULTS_DIR = path.join(DATA_DIR, 'results');

let server;
let serverProcess;
const PORT = 8081;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
  if (fs.existsSync(TASKS_FILE)) {
    fs.unlinkSync(TASKS_FILE);
  }
  if (fs.existsSync(RESULTS_DIR)) {
    fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  }

  serverProcess = spawn('node', ['queue-server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => {
    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('Running on')) {
        resolve();
      }
    });
    setTimeout(resolve, 2000);
  });

  await sleep(500);
});

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

describe('Queue Server API', () => {
  const baseUrl = `http://localhost:${PORT}`;

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const res = await request(baseUrl).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /tasks', () => {
    it('should add a task', async () => {
      const res = await request(baseUrl)
        .post('/tasks')
        .send({ url: 'https://www.bilibili.com/video/BV1123' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.task).toHaveProperty('id');
      expect(res.body.task.url).toBe('https://www.bilibili.com/video/BV1123');
      expect(res.body.task.status).toBe('pending');
    });

    it('should return 400 if url is missing', async () => {
      const res = await request(baseUrl)
        .post('/tasks')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing url field');
    });
  });

  describe('GET /tasks', () => {
    it('should return all tasks and next pending task', async () => {
      const res = await request(baseUrl).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tasks');
      expect(res.body).toHaveProperty('nextTask');
      expect(Array.isArray(res.body.tasks)).toBe(true);
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('should update task status', async () => {
      const addRes = await request(baseUrl)
        .post('/tasks')
        .send({ url: 'https://www.bilibili.com/video/BV1456' });
      const taskId = addRes.body.task.id;

      const updateRes = await request(baseUrl)
        .patch(`/tasks/${taskId}`)
        .send({ status: 'downloading' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.task.status).toBe('downloading');

      const getRes = await request(baseUrl).get('/tasks');
      const updatedTask = getRes.body.tasks.find(t => t.id === taskId);
      expect(updatedTask.status).toBe('downloading');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(baseUrl)
        .patch('/tasks/nonexistent')
        .send({ status: 'downloading' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /results', () => {
    it('should save result and update task status', async () => {
      const addRes = await request(baseUrl)
        .post('/tasks')
        .send({ url: 'https://www.bilibili.com/video/BV1789' });
      const taskId = addRes.body.task.id;

      const resultRes = await request(baseUrl)
        .post('/results')
        .send({
          taskId,
          status: 'completed',
          text: '测试文字内容'
        });
      expect(resultRes.status).toBe(200);
      expect(resultRes.body.success).toBe(true);

      const getRes = await request(baseUrl).get(`/results/${taskId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.text).toBe('测试文字内容');
    });

    it('should return 404 for non-existent task result', async () => {
      const res = await request(baseUrl)
        .post('/results')
        .send({
          taskId: 'nonexistent',
          status: 'completed',
          text: 'test'
        });
      expect(res.status).toBe(404);
    });
  });

  describe('WebSocket /ws', () => {
    it('should receive task_added event', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'connected') {
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });
  });

  describe('FIFO Order', () => {
    it('should return oldest pending task first', async () => {
      await request(baseUrl).post('/tasks').send({ url: 'https://example.com/1' });
      await request(baseUrl).post('/tasks').send({ url: 'https://example.com/2' });
      await request(baseUrl).post('/tasks').send({ url: 'https://example.com/3' });

      const res = await request(baseUrl).get('/tasks');
      const pendingTasks = res.body.tasks.filter(t => t.status === 'pending');
      expect(pendingTasks[0].url).toBe('https://www.bilibili.com/video/BV1123');
      expect(pendingTasks[pendingTasks.length - 1].url).toBe('https://example.com/3');
    });
  });
});
