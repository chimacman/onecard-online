import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('HTTP API and live event stream synchronize both players', { timeout: 12_000 }, async () => {
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT:'0' }, cwd: new URL('../', import.meta.url).pathname, stdio:['ignore','pipe','pipe'] });
  let stdout = '';
  const port = await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => {
        stdout += chunk.toString();
        const match = stdout.match(/localhost:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
      server.once('exit', () => reject(Error('server stopped before ready')));
    }),
    wait(4000).then(() => { throw Error('server startup timed out'); }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  const post = async (name, data) => {
    const response = await fetch(`${origin}/api/${name}`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    return { status:response.status, body:await response.json() };
  };
  let reader;
  try {
    const page = await fetch(origin);
    assert.equal(page.status,200);
    assert.match(await page.text(),/원카드 클럽/);
    assert.equal((await fetch(`${origin}/health`)).status,200);
    const a = (await post('create',{name:'홍길동'})).body;
    const b = (await post('join',{code:a.code,name:'친구'})).body;
    assert.equal(a.code.length,6);
    const response = await fetch(`${origin}/api/events?code=${a.code}&token=${a.token}`, {headers:{Accept:'text/event-stream'}});
    assert.equal(response.status,200);
    reader = response.body.getReader();
    const dec = new TextDecoder();
    let buff = '';
    async function nextEvent() {
      for (let attempt=0;attempt<20;attempt++) {
        const hit = buff.match(/(?:^|\n)data: ([^\n]+)\n\n/);
        if (hit) { buff = buff.slice(buff.indexOf(hit[0]) + hit[0].length);return JSON.parse(hit[1]); }
        const chunk = await reader.read();
        if (chunk.done) throw Error('SSE closed');
        buff += dec.decode(chunk.value);
      }
      throw Error('too many SSE packets');
    }
    const first = await nextEvent();
    assert.equal(first.players.length,2);
    assert.equal(first.status,'lobby');
    await post('action',{code:a.code,token:b.token,action:'ready'});
    const second = await nextEvent();
    assert.equal(second.players[1].ready,true);
    await post('action',{code:a.code,token:a.token,action:'start'});
    const third = await nextEvent();
    assert.equal(third.status,'playing');
    assert.equal(third.self.hand.length,7);
    assert.equal(third.players[1].count,7);
    assert.equal(third.players[1].hand,undefined);
    await post('action',{code:a.code,token:b.token,action:'chat',message:'안녕!'});
    const fourth = await nextEvent();
    assert.equal(fourth.logs.at(-1).text,'안녕!');
    const bad = await post('action',{code:a.code,token:'badtoken',action:'draw'});
    assert.equal(bad.status,400);
  } finally {
    if (reader) await reader.cancel();
    server.kill('SIGTERM');
  }
});
