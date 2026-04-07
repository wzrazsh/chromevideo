#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess
import requests
from pathlib import Path

QUEUE_SERVER = "http://localhost:8080"
POLL_INTERVAL = 5
DATA_DIR = Path(__file__).parent / "data"
RESULTS_DIR = DATA_DIR / "results"
DOWNLOADS_DIR = DATA_DIR / "downloads"

# TODO: Fill in Alibaba Cloud credentials
ALIYUN_ACCESS_KEY = os.environ.get("ALIYUN_ACCESS_KEY", "")
ALIYUN_ACCESS_SECRET = os.environ.get("ALIYUN_ACCESS_SECRET", "")
ALIYUN_APP_KEY = os.environ.get("ALIYUN_APP_KEY", "")


def log(level, *args):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level.upper()}]", *args, flush=True)


def fetch_json(url, method="GET", body=None):
    headers = {"Content-Type": "application/json"}
    if method == "GET":
        resp = requests.get(url, headers=headers)
    elif method == "POST":
        resp = requests.post(url, json=body, headers=headers)
    elif method == "PATCH":
        resp = requests.patch(url, json=body, headers=headers)
    else:
        raise ValueError(f"Unsupported method: {method}")
    resp.raise_for_status()
    return resp.json()


def get_completed_tasks():
    try:
        data = fetch_json(f"{QUEUE_SERVER}/tasks")
        completed = [
            t
            for t in data.get("tasks", [])
            if t.get("status") == "completed" and not t.get("processed")
        ]
        return completed
    except Exception as e:
        log("error", f"Failed to fetch tasks: {e}")
        return []


def update_task_processed(task_id, text, audio_path):
    try:
        fetch_json(
            f"{QUEUE_SERVER}/tasks/{task_id}",
            method="PATCH",
            body={
                "status": "processed",
                "transcribed": True,
                "text": text,
                "transcribedAudioPath": audio_path,
            },
        )
        log("info", f"Task {task_id} marked as processed")
    except Exception as e:
        log("error", f"Failed to update task {task_id}: {e}")


def extract_audio(video_path, output_path):
    log("info", f"Extracting audio from: {video_path}")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "2",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")
    log("info", f"Audio saved to: {output_path}")
    return output_path


def transcribe_with_aliyun(audio_path):
    if not ALIYUN_ACCESS_KEY or not ALIYUN_ACCESS_SECRET or not ALIYUN_APP_KEY:
        log("warn", "Aliyun credentials not configured, skipping transcription")
        return ""

    log("info", "Transcribing with Aliyun...")

    url = "https://nls-gateway.cn-shanghai.aliyuncs.com/stream/v1/tta"
    headers = {"Content-Type": "application/json", "X-NLS-AppKey": ALIYUN_APP_KEY}
    payload = {
        "appkey": ALIYUN_APP_KEY,
        "file_link": f"file://{os.path.abspath(audio_path)}",
        "format": "mp3",
        "sample_rate": 48000,
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        result = resp.json()
        text = result.get("result", {}).get("text", "")
        log("info", f"Transcription completed: {len(text)} chars")
        return text
    except Exception as e:
        log("error", f"Transcription failed: {e}")
        return ""


def save_result(task_id, video_path, audio_path, text):
    result = {
        "taskId": task_id,
        "videoPath": str(video_path) if video_path else None,
        "audioPath": str(audio_path) if audio_path else None,
        "text": text,
        "processedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_file = RESULTS_DIR / f"{task_id}.json"
    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log("info", f"Result saved to: {result_file}")


def process_task(task):
    task_id = task["id"]
    video_path = task.get("videoPath")
    title = task.get("title", task_id)

    if not video_path or not os.path.exists(video_path):
        log("warn", f"Video file not found: {video_path}")
        return

    audio_dir = DOWNLOADS_DIR / task_id
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"{title}.mp3"

    try:
        extract_audio(video_path, str(audio_path))
        text = transcribe_with_aliyun(str(audio_path))
        save_result(task_id, video_path, audio_path, text)
        update_task_processed(task_id, text, str(audio_path))
    except Exception as e:
        log("error", f"Failed to process task {task_id}: {e}")


def main():
    log("info", "Process Video 服务已启动")
    log("info", f"Poll interval: {POLL_INTERVAL}s")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    while True:
        try:
            tasks = get_completed_tasks()
            for task in tasks:
                process_task(task)
        except Exception as e:
            log("error", f"Poll error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
