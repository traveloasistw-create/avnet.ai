import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, STREAMS_DIR, RECORDINGS_DIR, saveConfig } from './config.js';

// HLS 即時串流參數（切片越短、緩衝越少，延遲越低）
const HLS_SEGMENT_TIME = 1;
const HLS_LIST_SIZE = 6;
const RESTART_DELAY_MS = 5000;

// 省電模式：沒人看的攝影機閒置這麼久後自動關閉連線（省電、省流量）
const ON_DEMAND_IDLE_MS = 25000;
const ON_DEMAND_SWEEP_MS = 5000;

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
    this.lastAccess = new Map(); // 省電模式：id -> 最後有人存取的時間戳
    this._sweepTimer = null;
  }

  // ---- 查詢 ----
  load(cameras) {
    this.cameras = cameras;
    // 一般攝影機開機就啟動；省電模式（onDemand）攝影機先不啟動，等有人點才喚醒
    for (const c of cameras) {
      if (c.enabled !== false && !c.onDemand) this._spawn(c);
    }
    this._startSweep();
  }

  // 省電模式：定期關閉「有開著但已無人觀看」的省電攝影機
  _startSweep() {
    if (this._sweepTimer) return;
    this._sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const cam of this.cameras) {
        if (!cam.onDemand) continue;
        if (!this.processes.has(cam.id)) continue;
        const last = this.lastAccess.get(cam.id) || 0;
        if (now - last > ON_DEMAND_IDLE_MS) {
          console.log(`💤 省電：${cam.name} 閒置關閉連線`);
          this._stop(cam.id);
          this._clearStreamDir(cam.id);
        }
      }
    }, ON_DEMAND_SWEEP_MS);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  // 省電模式：確保攝影機已啟動（沒開就喚醒），並記錄存取時間
  ensure(id) {
    const cam = this.get(id);
    if (!cam || cam.enabled === false) return false;
    this.lastAccess.set(id, Date.now());
    if (!this.processes.has(id)) {
      console.log(`⏰ 喚醒：${cam.name}`);
      this._spawn(cam);
    }
    return true;
  }

  // 每當有人讀取這台的串流片段時呼叫（讓省電攝影機保持喚醒）
  onStreamAccess(id) {
    const cam = this.get(id);
    if (!cam || !cam.onDemand) return;
    this.ensure(id);
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
    // 省電模式攝影機先不啟動，等有人點才喚醒
    if (camera.enabled !== false && !camera.onDemand) this._spawn(camera);
    this._persist();
    return camera;
  }

  update(id, patch) {
    const cam = this.get(id);
    if (!cam) return false;
    this._stop(id);
    this._clearStreamDir(id);
    Object.assign(cam, patch);
    // 省電模式攝影機保持休眠，等有人點才喚醒
    if (cam.enabled !== false && !cam.onDemand) this._spawn(cam);
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

    // 畫質：選了標清且有子串流網址時，改用子串流
    const inputUrl =
      camera.useSub && camera.subUrl ? camera.subUrl : camera.url;

    const args = [
      '-nostdin',
      '-loglevel', 'error',
      // ---- 低延遲：輸入端不多做緩衝，盡快送出 ----
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-rtsp_transport', 'tcp',
      '-timeout', '5000000',
      '-i', inputUrl,
      // ---- 輸出 1：HLS 即時串流 ----
      '-an', '-c:v', 'copy',
      '-f', 'hls',
      '-hls_time', String(HLS_SEGMENT_TIME),
      '-hls_list_size', String(HLS_LIST_SIZE),
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
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
