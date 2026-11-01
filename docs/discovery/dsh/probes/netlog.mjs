// Preloaded with NODE_OPTIONS="--import <this file>" to record every outbound attempt of
// the dsh host and its child processes: DNS lookups and socket connects, one JSON line
// each, appended to $LAOSHI_PROBE_NETLOG. Records only; never blocks a connection.
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';

const file = process.env.LAOSHI_PROBE_NETLOG;
if (file) {
  const log = (kind, host, port) => {
    try {
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, kind, host, port: port ?? null }) + '\n');
    } catch {}
  };

  const lookup = dns.lookup;
  dns.lookup = function (hostname, ...rest) {
    log('dns', hostname);
    return lookup.call(this, hostname, ...rest);
  };
  const promisesLookup = dns.promises.lookup;
  dns.promises.lookup = function (hostname, ...rest) {
    log('dns', hostname);
    return promisesLookup.call(this, hostname, ...rest);
  };

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = args[0];
    if (Array.isArray(first)) {
      // internal normalized form: [options, callback]
      const o = first[0] ?? {};
      if (o.path) log('ipc', o.path); else log('connect', o.host ?? 'localhost', o.port);
    } else if (first && typeof first === 'object') {
      if (first.path) log('ipc', first.path); else log('connect', first.host ?? 'localhost', first.port);
    } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
      log('ipc', first);
    } else {
      log('connect', typeof args[1] === 'string' ? args[1] : 'localhost', first);
    }
    return connect.apply(this, args);
  };
}
