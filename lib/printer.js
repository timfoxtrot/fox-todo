import net from 'node:net';
import { config } from '../config.js';

/**
 * Raw ESC/POS over TCP 9100. The JK-E02 module accepts exactly one connection
 * at a time, so every job goes through a promise chain: two people hitting
 * "print" at once produce two clean receipts instead of one interleaved mess.
 */
let queue = Promise.resolve();

export function sendToPrinter(buffer) {
  const job = queue.then(
    () => writeOnce(buffer),
    () => writeOnce(buffer), // a previous failure must not poison the queue
  );
  // Keep the chain alive regardless of this job's outcome.
  queue = job.catch(() => {});
  return job;
}

function writeOnce(buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(config.connectTimeout);
    socket.once('timeout', () =>
      finish(new Error(`Timed out talking to printer at ${config.printerHost}:${config.printerPort}`)));
    socket.once('error', (err) =>
      finish(new Error(`Printer connection failed (${err.code || err.message}) at ${config.printerHost}:${config.printerPort}`)));

    socket.connect(config.printerPort, config.printerHost, () => {
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        // The module has no application-level ack; flush, pause, then close so
        // the last bytes are not cut off by an immediate FIN.
        setTimeout(() => finish(null), 300);
      });
    });
  });
}

/** True if the printer is listening, without sending anything to it. */
export function probePrinter() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(config.statusTimeout);
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(config.printerPort, config.printerHost, () => done(true));
  });
}

const FLAGS = {
  'Cover Is Open': 'coverOpen',
  'Cutter Error': 'cutterError',
  'Paper End': 'paperEnd',
  'Paper Near End': 'paperNearEnd',
  'Printer Off-Line': 'offline',
};

/**
 * The JK-E02 exposes paper/cover/cutter state on its little web UI. Scraping
 * prn_stat.htm is the only way to read it, since port 9100 here is write-only.
 */
export async function readPrinterStatus() {
  const reachable = await probePrinter();
  const status = {
    reachable,
    host: config.printerHost,
    port: config.printerPort,
    coverOpen: null,
    cutterError: null,
    paperEnd: null,
    paperNearEnd: null,
    offline: null,
    detail: reachable ? null : 'No response on port 9100',
  };
  if (!reachable) return status;

  try {
    const res = await fetch(`http://${config.printerHost}/prn_stat.htm`, {
      signal: AbortSignal.timeout(config.statusTimeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const plain = html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '\n');
    const cells = plain.split('\n').map((s) => s.trim()).filter(Boolean);

    for (const [label, key] of Object.entries(FLAGS)) {
      const i = cells.indexOf(label);
      if (i !== -1 && cells[i + 1]) status[key] = /^yes$/i.test(cells[i + 1]);
    }
  } catch (err) {
    // Reachable on 9100 but the status page did not answer: still printable.
    status.detail = `Status page unavailable (${err.message})`;
  }
  return status;
}
