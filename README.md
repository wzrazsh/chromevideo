# ChromeVideo 项目

B站视频下载 Chrome 扩展 + 队列服务架构。

## 功能

- Chrome 扩展自动轮询队列服务获取下载任务
- 支持 B站 视频/番剧下载
- Python 音视频拆分 + 语音转文字

## 启动顺序

1. **启动队列服务**
   ```bash
   npm start
   ```

2. **启动 Chrome 扩展**
   ```bash
   node start-browser.js
   ```

3. **启动 Python 处理服务（可选）**
   ```bash
   python process-video.py
   ```

## 添加下载任务

```bash
# 视频
curl -X POST http://localhost:8080/tasks -H "Content-Type: application/json" -d "{\"url\":\"https://www.bilibili.com/video/BV1LZwyzuEMi\"}"

# 番剧
curl -X POST http://localhost:8080/tasks -H "Content-Type: application/json" -d "{\"url\":\"https://www.bilibili.com/bangumi/play/ep3384191/\"}"
```

## 查看任务状态

```bash
curl http://localhost:8080/tasks
```

## 任务状态流转

```
pending → downloading → processing → completed → processed
                  ↓
                failed
```

## 端口

| 端口 | 用途 |
|-----|------|
| 8080 | HTTP/WebSocket 队列服务 |
| 9222 | Chrome 远程调试 |

## API

| 方法 | 路径 | 说明 |
|-----|------|-----|
| POST | `/tasks` | 添加下载任务 `{url}` |
| GET | `/tasks` | 获取待处理任务 |
| PATCH | `/tasks/:id` | 更新任务状态 |
| POST | `/results` | 上报处理结果 |
| GET | `/results/:taskId` | 获取任务结果 |
| WS | `/ws` | 实时任务变更推送 |

## 目录结构

```
chromevideo/
├── queue-server/       # Node.js HTTP/WebSocket 队列服务
├── chromevideo/        # Chrome 扩展 (Manifest V3)
├── data/               # 数据存储
│   ├── tasks.json      # 任务持久化
│   ├── results/        # 处理结果
│   └── downloads/      # 下载视频
├── process-video.py    # Python 音视频处理
└── start-browser.js    # 独立浏览器启动脚本
```

## 配置

阿里云环境变量（语音转文字）：
```bash
export ALIYUN_ACCESS_KEY=your_key
export ALIYUN_ACCESS_SECRET=your_secret
export ALIYUN_APP_KEY=your_app_key
```

## 测试

```bash
npm test
```

## 注意事项

- B站视频需要用户已登录态（直接使用本机的 Chrome Default 配置，共享 Cookie）
- 浏览器使用 `child_process.spawn` 启动 Playwright Chromium，避免了 Playwright 接管下载将文件命名为乱码的问题
- 视频和音频下载完成后，由 `queue-server` 统一移动至 `data/downloads/{taskId}/` 目录下
- 扩展会自动打开标签页显示下载进度
- 番剧/视频下载使用相同接口
