import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, STREAMS_DIR, RECORDINGS_DIR, saveConfig } from './config.js';

// HLS 即時串流參數
const HLS_SEGMENT_TIME = 2;
const HLS_LIST_SIZE = 4;
const RESTART_DELAY_MS = 5000;

const ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 管理所有攝影機：持有清單（來源事實）、每台一個 ffmpeg 程序，
 * 並支援執行中即時新增/修改/刪除攝影機（不必重啟整個程式）。
 *
 * 每台攝影機用「一條 RTSP 連線、一個 ffmpeg」同時輸出兩路：
 *   1) HLS      → 網頁即時看板
 *   2) 分段 MP4 → 存檔供回放（可關閉）
 * 皆用 -c copy 直接複製串流，不重新編碼，CPU 負擔極低。
 */
export class CameraManager {
  constructor(recording) {
    this.recording = recording;
    this.cameras = []; // 完整清單（含停用的）
    this.processes = new Map(); // id -> { proc, camera, status }
  }

  // ---- 查詢 ----
  load(cameras) {
    this.cameras = cameras;
    for (const c of cameras) if (c.enabled !== false) this._spawn(c);
  }
  list() {
    return this.cameras;
  }
  enabled() {
    return this.cameras.filter((c) => c.enabled !== false);
  }
  get(id) {
    return this.cameras.find((c) => c.id === id);
  }
  status(id) {
    return this.processes.get(id)?.status || 'unknown';
  }

  // ---- 即時異動（新增/修改/刪除） ----
  add(camera) {
    if (!camera.id || !ID_RE.test(camera.id))
      throw new Error('攝影機代號格式不正確');
    if (this.get(camera.id)) throw new Error('攝影機代號已存在');
    if (!camera.url) throw new Error('缺少 RTSP 網址');
    this.cameras.push(camera);
    if (camera.enabled !== false) this._spawn(camera);
    this._persist();
    return camera;
  }

  update(id, patch) {
    const cam = this.get(id);
    if (!cam) return false;
    this._stop(id);
    this._clearStreamDir(id);
    Object.assign(cam, patch);
    if (cam.enabled !== false) this._spawn(cam);
    this._persist();
    return true;
  }

  remove(id) {
    if (!this.get(id)) return false;
    this._stop(id);
    this._clearStreamDir(id);
    this.cameras = this.cameras.filter((c) => c.id !== id);
    this._persist();
    return true;
  }

  stopAll() {
    for (const { proc } of this.processes.values()) proc.kill('SIGTERM');
  }

  // ---- 內部 ----
  _persist() {
    saveConfig({ recording: this.recording, cameras: this.cameras });
  }

  _clearStreamDir(id) {
    fs.rmSync(path.join(STREAMS_DIR, path.basename(id)), {
      recursive: true,
      force: true,
    });
  }

  _stop(id) {
    const entry = this.processes.get(id);
    if (entry) {
      this.processes.delete(id); // 先移除，避免 exit 事件觸發自動重啟
      entry.proc.kill('SIGTERM');
    }
  }

  _spawn(camera) {
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
      const recPattern = path.join(recDir, '%Y-%m-%d_%H-%M-%S.mp4');
      args.push(
        // ---- 輸出 2：分段錄影 MP4 ----
        '-an', '-c:v', 'copy',
        '-f', 'segment',
        '-segment_time', String(this.recording.segmentMinutes * 60),
        '-segment_format', 'mp4',
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
      // 只有這個 entry 仍是目前程序時才自動重啟（避免已被刪除/替換的殘留）
      if (this.processes.get(camera.id) !== entry) return;
      console.warn(
        `⚠️  ${camera.name} 中斷 (code=${code})，${RESTART_DELAY_MS / 1000} 秒後重試`
      );
      setTimeout(() => {
        if (this.processes.get(camera.id) === entry) this._spawn(camera);
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
}
