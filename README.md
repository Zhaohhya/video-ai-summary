# Aether Brief

视频 AI 摘要工具 —— 输入视频链接，自动下载、转写语音、生成结构化摘要。

## 功能特性

- 支持 **B站** 和 **小红书** 视频链接（含短链 b23.tv / xhslink.com）
- **OpenAI Whisper** 本地语音转写，无需上传音频到第三方
- **MiniMax AI** 中文摘要生成，支持简洁 / 深度两种模式
- 导出 TXT / SRT 字幕文件
- 多种展示格式：要点、叙事、时间线、脑图
- 实时进度追踪与处理日志面板
- 深色 / 浅色主题切换
- 流光星座动态背景（Canvas 粒子系统 + 极光 + 鼠标光迹）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + Uvicorn |
| 视频下载 | yt-dlp |
| 音频提取 | FFmpeg |
| 语音识别 | OpenAI Whisper（本地运行，base 模型） |
| AI 摘要 | MiniMax-M2.7（Anthropic SDK 兼容接口） |
| 前端 | 原生 HTML / CSS / JS + Canvas 动效 |

## 前置要求

- Python 3.9+
- [FFmpeg](https://ffmpeg.org/download.html)（需加入系统 PATH）
- MiniMax API Key

## 安装

```bash
git clone https://github.com/Zhaohhya/video-ai-summary.git
cd video-ai-summary

python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

## 配置

设置 API Key 环境变量：

```bash
# Linux / macOS
export ANTHROPIC_API_KEY=your_api_key_here

# Windows CMD
set ANTHROPIC_API_KEY=your_api_key_here

# Windows PowerShell
$env:ANTHROPIC_API_KEY="your_api_key_here"
```

## 运行

```bash
python main.py
```

浏览器打开 http://127.0.0.1:8000

## 使用方式

1. 粘贴 B站 或 小红书视频链接到输入框
2. 选择总结深度（简洁 / 深度）
3. 点击「开始总结」或粘贴链接后自动触发
4. 等待处理完成（下载 → 提取音频 → 转写 → AI 摘要）
5. 查看结果，可复制摘要或导出字幕文件

## 处理流程

```
视频链接 → yt-dlp 下载 → FFmpeg 提取音频 → Whisper 转写 → MiniMax AI 摘要
```

每次任务的输出保存在 `outputs/{task_id}/` 下：

```
outputs/{task_id}/
├── info.json        # 视频元信息（标题、作者、时长）
├── transcript.txt   # 完整转写文本
├── segments.json    # 带时间戳的逐句转写
└── summary.txt      # AI 生成的摘要
```

## 项目结构

```
├── main.py              # FastAPI 后端入口与 API 路由
├── config.py            # 配置：支持的平台域名、CORS 白名单
├── video_downloader.py  # yt-dlp 视频下载封装
├── transcriber.py       # Whisper 语音转写
├── summarizer.py        # MiniMax AI 摘要生成
├── platforms/
│   ├── bilibili.py      # B站链接解析
│   └── xiaohongshu.py   # 小红书链接解析
├── static/
│   ├── index.html       # 前端页面
│   ├── app.js           # 前端逻辑与 Canvas 动效
│   └── style.css        # Glass-morphism 样式
├── outputs/             # 任务输出目录
└── requirements.txt     # Python 依赖
```

## License

MIT
