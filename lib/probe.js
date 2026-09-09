import net from 'node:net';
import onvif from 'onvif';

const { Cam } = onvif;

// 監視器常見的連接埠，以及它們代表什麼
const CHECK_PORTS = [
  { port: 554, what: 'RTSP 即時串流' },
  { port: 8554, what: 'RTSP 即時串流（備用埠）' },
  { port: 80, what: '網頁介面 / ONVIF' },
  { port: 8000, what: 'ONVIF / 廠商協定' },
  { port: 8080, what: '網頁介面 / ONVIF' },
  { port: 8899, what: 'ONVIF（喬安等小廠常用）' },
  { port: 2020, what: 'ONVIF' },
  { port: 445, what: 'SMB 檔案分享（NAS 用）' },
];

// ONVIF 可能的連接埠（依序嘗試）
const ONVIF_PORTS = [8899, 80, 8000, 2020, 8080];

const PORT_TIMEOUT_MS = 1500;
const ONVIF_TIMEOUT_MS = 2500;

/** 測試某個 TCP 連接埠有沒有開著 */
function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(PORT_TIMEOUT_MS);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/** 用 ONVIF 問相機：你的即時串流網址是什麼？ */
function askOnvif(host, username, password, port) {
  return new Promise((resolve, reject) => {
    let cam;
    const timer = setTimeout(
      () => reject(new Error('逾時')),
      ONVIF_TIMEOUT_MS + 1500
    );
    try {
      cam = new Cam(
        { hostname: host, username, password, port, timeout: ONVIF_TIMEOUT_MS },
        (err) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          cam.getStreamUri({ protocol: 'RTSP' }, (err2, stream) => {
            clearTimeout(timer);
            if (err2) return reject(err2);
            resolve({
              port,
              uri: (stream && stream.uri) || '',
              maker: (cam.deviceInformation && cam.deviceInformation.manufacturer) || '',
              model: (cam.deviceInformation && cam.deviceInformation.model) || '',
            });
          });
        }
      );
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/**
 * 探測一台相機：哪些連接埠開著、支不支援 ONVIF、
 * 以及（若支援）它自己回報的 RTSP 網址。
 */
export async function probe(host, username = 'admin', password = '') {
  const results = await Promise.all(
    CHECK_PORTS.map(async (p) => ({ ...p, open: await checkPort(host, p.port) }))
  );

  const openPorts = results.filter((r) => r.open);
  const hasRtsp = openPorts.some((p) => p.port === 554 || p.port === 8554);
  const hasSmb = openPorts.some((p) => p.port === 445);

  // 只有在有連接埠開著時才試 ONVIF（省時間）
  let onvifInfo = null;
  let onvifError = '';
  if (openPorts.length > 0) {
    for (const port of ONVIF_PORTS) {
      if (!openPorts.some((p) => p.port === port)) continue;
      try {
        onvifInfo = await askOnvif(host, username, password, port);
        break;
      } catch (err) {
        onvifError = err.message || String(err);
      }
    }
  }

  return {
    host,
    reachable: openPorts.length > 0,
    ports: results,
    hasRtsp,
    hasSmb,
    onvif: onvifInfo,
    onvifError: onvifInfo ? '' : onvifError,
  };
}
