import dgram from 'dgram';
import net from 'net';
import os from 'os';
import PanasonicPlatformLogger from './logger';
import {
  LOCAL_SSDP_ADDRESS,
  LOCAL_SSDP_PORT,
  LOCAL_SSDP_SEARCH_TARGETS,
  LOCAL_SSDP_MARKERS,
  LOCAL_MAX_SCAN_HOSTS,
} from './const';

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 0xff).join('.');
}

/**
 * Sends an SSDP M-SEARCH for each Panasonic search target and returns the IPs
 * of hosts whose response looks like a module. The responder's own source
 * address is the module IP, so no LOCATION parsing is needed.
 */
export function ssdpSearch(
  log: PanasonicPlatformLogger,
  timeout: number,
): Promise<Set<string>> {
  return new Promise((resolve) => {
    const hosts = new Set<string>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(hosts);
    };

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('utf-8').toLowerCase();
      if (LOCAL_SSDP_MARKERS.some(marker => text.includes(marker))) {
        hosts.add(rinfo.address);
      }
    });

    socket.on('error', (err) => {
      log.debug(`Local discovery: SSDP socket error - ${err.message}`);
      finish();
    });

    socket.on('listening', () => {
      for (const target of LOCAL_SSDP_SEARCH_TARGETS) {
        const message = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n'
          + `HOST: ${LOCAL_SSDP_ADDRESS}:${LOCAL_SSDP_PORT}\r\n`
          + 'MAN: "ssdp:discover"\r\n'
          + 'MX: 2\r\n'
          + `ST: ${target}\r\n\r\n`,
        );
        socket.send(message, LOCAL_SSDP_PORT, LOCAL_SSDP_ADDRESS, (err) => {
          if (err) {
            log.debug(`Local discovery: SSDP send failed - ${err.message}`);
          }
        });
      }
      setTimeout(finish, timeout);
    });

    try {
      socket.bind();
    } catch (err) {
      log.debug(`Local discovery: SSDP bind failed - ${(err as Error).message}`);
      finish();
    }
  });
}

/** Resolves true if a TCP connection to `host:port` succeeds within `timeout`. */
function checkPort(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (open: boolean) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Scans the given hosts for an open TCP port, at most `concurrency` at a time,
 * and returns those that accept a connection.
 */
export async function scanForOpenPort(
  hosts: string[],
  port: number,
  timeout: number,
  concurrency: number,
): Promise<Set<string>> {
  const open = new Set<string>();
  let index = 0;

  const worker = async () => {
    while (index < hosts.length) {
      const host = hosts[index++];
      if (await checkPort(host, port, timeout)) {
        open.add(host);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, hosts.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return open;
}

/**
 * Enumerates the usable host IPs on the first non-internal IPv4 interface,
 * excluding the network, broadcast and own addresses. If the netmask spans
 * more than {@link LOCAL_MAX_SCAN_HOSTS} addresses, only the local /24 is used.
 */
export function localSubnetHosts(log: PanasonicPlatformLogger): string[] {
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || !net.isIPv4(info.address) || !info.netmask) {
        continue;
      }

      const own = ipToInt(info.address);
      const mask = ipToInt(info.netmask);
      let network = (own & mask) >>> 0;
      let broadcast = (network | (~mask >>> 0)) >>> 0;

      if (broadcast - network - 1 > LOCAL_MAX_SCAN_HOSTS) {
        // Netmask too wide to scan in full - fall back to the local /24.
        network = (own & 0xffffff00) >>> 0;
        broadcast = (network | 0xff) >>> 0;
        log.debug('Local discovery: subnet larger than '
          + `${LOCAL_MAX_SCAN_HOSTS} hosts, scanning the local /24 only.`);
      }

      const hosts: string[] = [];
      for (let addr = network + 1; addr < broadcast; addr++) {
        if (addr !== own) {
          hosts.push(intToIp(addr));
        }
      }
      log.debug(`Local discovery: scanning ${hosts.length} hosts on ${info.address}`);
      return hosts;
    }
  }
  return [];
}
