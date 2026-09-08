import { spawn } from 'node:child_process';
import path from 'node:path';
import { FFMPEG, STREAMS_DIR } from './config.js';

const DEBOUNCE_MS = 60000; // 同一支相機 60 秒內只通知一次
const SCENE_THRESH = 0.12; // 畫面變化門檻（越小越敏感）
const RESTART_MS = 8000;

/**
 * 移動偵測：對每支開啟的相機，讀「本地已產生的 HLS」用 ffmpeg 的場景變化偵測，
 * 偵測到明顯畫面變化就呼叫 onMotion（去發推播）。不另外連相機，省頻寬。
 */
export class MotionWatcher {
  constructor(onMotion) {
    this.onMotion = onMotion;
    this.procs = new Map(); // id -> proc
    this.wanted = new Set(); // 想要偵測的相機 id
    this.last = new Map(); // id -> 上次通知時間
  }

  start(camera) {
    this.wanted.add(camera.id);
    this._spawn(camera);
  }

  stop(id) {
    this.wanted.delete(id);
    const p = this.procs.get(id);
    if (p) {
      this.procs.delete(id);
      p.kill('SIGKILL');
    }
  }

  stopAll() {
    this.wanted.clear();
    for (const p of this.procs.values()) p.kill('SIGKILL');
    this.procs.clear();
  }

  _spawn(camera) {
    if (this.procs.has(camera.id)) return;
    if (!this.wanted.has(camera.id)) return;
    const playlist = path.join(STREAMS_DIR, camera.id, 'index.m3u8');
    const args = [
      '-nostdin',
      '-loglevel', 'info',
      // 只解「關鍵影格」（約每秒 1 張）而不是每一張，解碼量大幅下降；
      // 對「有沒有人經過」這種偵測已經足夠，但 CPU 只要原本的零頭。
      '-skip_frame', 'nokey',
      '-i', playlist,
      '-an',
      // 先縮成小圖再比對，比對成本幾乎為零
      '-vf', `scale=320:-2,select='gt(scene,${SCENE_THRESH})',metadata=print`,
      '-f', 'null',
      '-',
    ];
    const proc = spawn(FFMPEG, args);
    this.procs.set(camera.id, proc);

    proc.stderr.on('data', (buf) => {
      if (buf.toString().includes('lavfi.scene_score')) this._trigger(camera);
    });
    proc.on('error', () => {});
    proc.on('exit', () => {
      this.procs.delete(camera.id);
      // 串流可能還沒起來，稍後重試
      if (this.wanted.has(camera.id)) {
        setTimeout(() => this._spawn(camera), RESTART_MS);
      }
    });
  }

  _trigger(camera) {
    const now = Date.now();
    if (now - (this.last.get(camera.id) || 0) < DEBOUNCE_MS) return;
    this.last.set(camera.id, now);
    this.onMotion(camera);
  }
}
