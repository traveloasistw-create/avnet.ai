import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, STREAMS_DIR, RECORDINGS_DIR } from './config.js';

// HLS 即時串流參數
const HLS_SEGMENT_TIME = 2;
const HLS_LIST_SIZE = 4;
const RESTART_DELAY_MS = 5000;

/**
 * 每台攝影機開「一個」ffmpeg，同一條 RTSP 連線同時輸出兩路：
 *   1) HLS  → 給網頁即時看板播放
 *   2) 分段 MP4 → 存檔供回放（可關閉）
 * 用 -c copy 直接複製串流，不重新編碼，CPU 負擔極低。
 */
export class CameraManager {
  constructor(recording) {
    this.recording = recording; // { enabled, segmentMinutes, retentionDays }
    this.processes = new Map(); // id -> { proc, camera, status }
  }

  start(camera) {
    const streamDir = path.join(STREAMS_DIR, camera.id);
    fs.mkdirSync(streamDir, { recursive: true });

    const playlist = path.join(streamDir, 'index.m3u8');
    const segPattern = path.join(streamDir, 'seg_%03d.ts');

    const args = [
      '-nostdin',
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-stimeout', '5000000',
      '-i', camera.url,
      // ---- 輸出 1：HLS 即時串流 ----
      '-an', '-c:v', 'copy',
      '-f', 'hls',
      '-hls_time', String(HLS_SEGMENT_TIME),
      '-hls_list_size', String(HLS_LIST_SIZE),
      '-hls_flags', 'delete_segments+omit_endlist',
      '-hls_segment_filename', segPattern,
      playlist,
    ];

    const willRecord = this.recording.enabled && camera.record !== false;
    if (willRecord) {
      const recDir = path.join(RECORDINGS_DIR, camera.id);
      fs.mkdirSync(recDir, { recursive: true });
      // 檔名帶時間戳記，方便依日期分類與清理
      const recPattern = path.join(recDir, '%Y-%m-%d_%H-%M-%S.mp4');
      args.push(
        // ---- 輸出 2：分段錄影 MP4 ----
        '-an', '-c:v', 'copy',
        '-f', 'segment',
        '-segment_time', String(this.recording.segmentMinutes * 60),
        '-segment_format', 'mp4',
        // 片段化 MP4：邊寫邊可播、程式中斷也不會整段損壞
        '-segment_format_options',
        'movflags=+frag_keyframe+empty_moov+default_base_moof',
        '-reset_timestamps', '1',
        '-strftime', '1',
        recPattern
      );
    }

    console.log(
      `▶️  啟動: ${camera.name} (${camera.id})${willRecord ? ' [錄影中]' : ''}`
    );
    const proc = spawn(FFMPEG, args);
    const entry = { proc, camera, status: 'starting' };
    this.processes.set(camera.id, entry);

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[${camera.id}] ${msg}`);
    });

    proc.on('spawn', () => {
      entry.status = 'running';
    });

    proc.on('exit', (code, signal) => {
      entry.status = 'stopped';
      if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
      console.warn(
        `⚠️  ${camera.name} 中斷 (code=${code})，${RESTART_DELAY_MS / 1000} 秒後重試`
      );
      setTimeout(() => {
        if (this.processes.get(camera.id) === entry) this.start(camera);
      }, RESTART_DELAY_MS);
    });

    proc.on('error', (err) => {
      entry.status = 'error';
      console.error(`❌ 無法啟動 ffmpeg (${camera.id}):`, err.message);
      if (err.code === 'ENOENT') {
        console.error(
          '   找不到 ffmpeg。請先安裝 ffmpeg，或用 FFMPEG_PATH 環境變數指定路徑。'
        );
      }
    });
  }

  status(id) {
    return this.processes.get(id)?.status || 'unknown';
  }

  stopAll() {
    for (const { proc } of this.processes.values()) proc.kill('SIGTERM');
  }
}
