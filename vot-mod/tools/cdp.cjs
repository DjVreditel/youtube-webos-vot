'use strict';
const [mode, ...args] = process.argv.slice(2);
const PORT = 9998;

async function pickTarget() {
  if (process.env.CDP_WS) return process.env.CDP_WS;
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (mode === 'list') {
    for (const t of list) console.log(t.type, t.title, t.url.slice(0, 120));
    process.exit(0);
  }
  const t = list.find((x) => /youtube\.com\/tv/.test(x.url)) || list.find((x) => x.type === 'page');
  if (!t) throw new Error('no page target');
  return t.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${PORT}`);
}

(async () => {
  const ws = new WebSocket(await pickTarget());
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      console.log(`[console.${msg.params.type}] ${text}`.slice(0, 400));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log(`[EXCEPTION] ${d.exception?.description || d.text}`.slice(0, 600));
    } else if (msg.method === 'Console.messageAdded') {
      const m2 = msg.params.message;
      const params = (m2.parameters || []).slice(1).map((p) => (p.value !== undefined ? JSON.stringify(p.value) : p.preview ? JSON.stringify(p.preview.properties.map((x) => x.name + '=' + x.value)) : p.description || p.type));
      console.log(`[${m2.level}] ${m2.text} ${params.join(' ')}`.slice(0, 700));
    } else if (msg.method === 'Network.requestWillBeSent' && new RegExp(process.env.CDP_NET).test(msg.params.request.url)) {
      console.log(`[net] ${msg.params.request.method} ${msg.params.request.url}`);
    } else if (msg.method === 'Network.responseReceived' && new RegExp(process.env.CDP_NET).test(msg.params.response.url)) {
      console.log(`[net] ${msg.params.response.status} ${msg.params.response.url}`);
    } else if (msg.method === 'Log.entryAdded') {
      console.log(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`.slice(0, 400));
    }
  };
  await new Promise((r) => (ws.onopen = r));

  if (mode === 'backup') {
    const res = await send('Runtime.evaluate', {
      expression: '(function(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}return {origin:location.origin,data:o};})()',
      returnByValue: true
    });
    const dump = res.result.result.value;
    if (!dump || !dump.data['yt.leanback.default::last-identity-used']) {
      console.error('no signed-in YouTube account in localStorage, backup not written');
      process.exit(1);
    }
    require('fs').writeFileSync(args[0], JSON.stringify(dump));
    console.log(`backed up ${Object.keys(dump.data).length} keys of ${dump.origin} to ${args[0]}`);
    ws.close();
  } else if (mode === 'restore') {
    const dump = JSON.parse(require('fs').readFileSync(args[0], 'utf8'));
    const res = await send('Runtime.evaluate', {
      expression: `(function(d){var n=0;for(var k in d){localStorage.setItem(k,d[k]);n++;}return n;})(${JSON.stringify(dump.data)})`,
      returnByValue: true
    });
    console.log(`restored ${res.result.result.value} keys; relaunch the app to apply`);
    ws.close();
  } else if (mode === 'eval') {
    const res = await send('Runtime.evaluate', { expression: args.join(' '), awaitPromise: true, returnByValue: true });
    const r = res.result;
    console.log(r.exceptionDetails ? 'ERROR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : JSON.stringify(r.result.value, null, 1));
    ws.close();
  } else if (mode === 'bench') {
    const [pattern = 'RRRRRRRRRRDDRRRRRRRRRRDDLLLLLLLLLLUU', interval = '250'] = args;
    const keys = { R: [39, 'ArrowRight'], L: [37, 'ArrowLeft'], D: [40, 'ArrowDown'], U: [38, 'ArrowUp'] };
    const ev = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r.result.result && r.result.result.value);
    await ev(`(function(){var b=window.__bench={t:[],on:true};function f(ts){b.t.push(performance.now());if(b.on)requestAnimationFrame(f);}requestAnimationFrame(f);return 1;})()`);
    for (const ch of pattern) {
      const [code, key] = keys[ch];
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key });
      await new Promise((r) => setTimeout(r, Number(interval)));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const res = await ev(`(function(){var b=window.__bench;b.on=false;var t=b.t,g=[];for(var i=1;i<t.length;i++)g.push(t[i]-t[i-1]);var s=g.slice().sort(function(a,b){return a-b});var dur=(t[t.length-1]-t[0])/1000;var m=performance.memory||{};return {frames:t.length,seconds:+dur.toFixed(1),fps:+(t.length/dur).toFixed(1),p50:+s[Math.floor(s.length*0.5)].toFixed(1),p95:+s[Math.floor(s.length*0.95)].toFixed(1),max:+s[s.length-1].toFixed(0),over50ms:g.filter(function(x){return x>50}).length,over100ms:g.filter(function(x){return x>100}).length,heapMB:m.usedJSHeapSize?+(m.usedJSHeapSize/1048576).toFixed(1):null,dom:document.getElementsByTagName('*').length,hash:location.hash.slice(0,40)};})()`);
    console.log(JSON.stringify(res));
    ws.close();
  } else if (mode === 'profile') {
    const [pattern = 'RRRRRRRRRRRRDDDRRRRRRRRRRRRUUU', interval = '250'] = args;
    const keys = { R: 39, L: 37, D: 40, U: 38 };
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 500 });
    await send('Profiler.start');
    for (const ch of pattern) {
      const code = keys[ch];
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await new Promise((r) => setTimeout(r, Number(interval)));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const res = await send('Profiler.stop');
    const p = res.result.profile;
    require('fs').writeFileSync(args[2] || 'profile.cpuprofile', JSON.stringify(p));
    const total = {};
    const byUrl = {};
    let all = 0;
    const walk = (n) => {
      const cf = n.callFrame || n;
      const url = (cf.url || '').replace(/^.*\//, '').replace(/\?.*$/, '') || '(native)';
      const key = `${cf.functionName || '(anon)'} @ ${url}:${cf.lineNumber}`;
      const self = n.hitCount || 0;
      total[key] = (total[key] || 0) + self;
      byUrl[url] = (byUrl[url] || 0) + self;
      all += self;
      (n.children || []).forEach((c) => walk(typeof c === 'object' ? c : null));
    };
    if (p.head) walk(p.head);
    else {
      const map = new Map(p.nodes.map((n) => [n.id, n]));
      for (const n of p.nodes) {
        const cf = n.callFrame;
        const url = (cf.url || '').replace(/^.*\//, '').replace(/\?.*$/, '') || '(native)';
        const key = `${cf.functionName || '(anon)'} @ ${url}:${cf.lineNumber}`;
        total[key] = (total[key] || 0) + (n.hitCount || 0);
        byUrl[url] = (byUrl[url] || 0) + (n.hitCount || 0);
        all += n.hitCount || 0;
      }
      void map;
    }
    console.log('TOTAL samples', all);
    console.log('--- by script');
    Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log((100 * v / all).toFixed(1).padStart(5) + '%  ' + k));
    console.log('--- top functions (self)');
    Object.entries(total).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log((100 * v / all).toFixed(1).padStart(5) + '%  ' + k));
    ws.close();
  } else if (mode === 'cshot') {
    await send('Runtime.evaluate', {
      expression: "window.__shot=null;window.screenshot().then(function(b){var u=new Uint8Array(b.buffer),s='';for(var i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));window.__shot=btoa(s);},function(e){window.__shot='ERR '+e;})"
    });
    let data = null;
    for (let i = 0; i < 60 && !data; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const res = await send('Runtime.evaluate', { expression: 'window.__shot', returnByValue: true });
      data = res.result.result.value;
    }
    if (!data || data.startsWith('ERR')) throw new Error(data || 'screenshot timed out');
    require('fs').writeFileSync(args[0], Buffer.from(data, 'base64'));
    console.log('saved', args[0]);
    ws.close();
  } else if (mode === 'shot') {
    const res = await send('Page.captureScreenshot', {});
    require('fs').writeFileSync(args[0], Buffer.from(res.result.data, 'base64'));
    console.log('saved', args[0]);
    ws.close();
  } else if (mode === 'key') {
    for (const code of args.map(Number)) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await new Promise((r) => setTimeout(r, 600));
    }
    ws.close();
  } else if (mode === 'console') {
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Console.enable');
    if (process.env.CDP_NET) await send('Network.enable');
    if (args[1] === 'reload') await send('Page.reload', { ignoreCache: true });
    else if (args[1]) await send('Runtime.evaluate', { expression: args.slice(1).join(' ') });
    setTimeout(() => { ws.close(); process.exit(0); }, Number(args[0] || 20) * 1000);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
