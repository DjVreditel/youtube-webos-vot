'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GLOBAL_CLI = path.join(process.env.APPDATA || '', 'npm/node_modules/@webos-tools/cli/node_modules');
const { Client } = require(require.resolve('ssh2', { paths: [ROOT, GLOBAL_CLI] }));

const devicesFile = path.join(process.env.APPDATA || process.env.HOME, '.webos/tv/novacom-devices.json');
const deviceName = process.env.TV_DEVICE || 'tv';
const dev = JSON.parse(fs.readFileSync(devicesFile, 'utf8')).find((d) => d.name === deviceName);
if (!dev) throw new Error(`device "${deviceName}" not found in ${devicesFile} (set it up with ares-setup-device)`);

const [mode, ...args] = process.argv.slice(2);
const usage = 'usage: tv.cjs exec <command> | push <local file> <remote path> | forward <local port> <remote port>';
if (!['exec', 'push', 'forward'].includes(mode)) {
  console.error(usage);
  process.exit(1);
}

function exec(conn, command) {
  conn.exec(command, (err, stream) => {
    if (err) throw err;
    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('close', (code) => {
      conn.end();
      process.exitCode = code ?? 0;
    });
  });
}

const conn = new Client();
conn.on('error', (e) => {
  console.error('SSH error:', e.message);
  process.exit(2);
});
conn.on('ready', () => {
  if (mode === 'exec') {
    exec(conn, args.join(' '));
  } else if (mode === 'push') {
    const data = fs.readFileSync(args[0], 'utf8').replace(/\r/g, '');
    const b64 = Buffer.from(data).toString('base64');
    exec(conn, `echo ${b64} | base64 -d > '${args[1]}' && echo 'pushed ${args[1]}'`);
  } else {
    const [localPort, remotePort] = args.map(Number);
    net
      .createServer((sock) => {
        conn.forwardOut('127.0.0.1', localPort, '127.0.0.1', remotePort, (err, stream) => {
          if (err) {
            sock.destroy();
            return;
          }
          sock.on('error', () => stream.close());
          stream.on('error', () => sock.destroy());
          sock.pipe(stream).pipe(sock);
        });
      })
      .listen(localPort, '127.0.0.1', () => console.log(`forwarding 127.0.0.1:${localPort} -> tv:${remotePort}`));
  }
});
conn.connect({
  host: dev.host,
  port: dev.port,
  username: dev.username,
  password: dev.password,
  privateKey: dev.privateKey ? fs.readFileSync(dev.privateKey) : undefined,
  readyTimeout: 15000
});
