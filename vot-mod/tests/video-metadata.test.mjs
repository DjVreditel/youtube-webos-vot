import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function metadata() {
  let now=0, sequence=0;const timers=new Map();
  const box={exports:{},Date:{now:()=>now},setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
  const code=fs.readFileSync(new URL('../src/vot/video-metadata.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,box);
  return {wait:box.exports.waitForVideoMetadata,timers,tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);now+=timer.delay;timer.fn();}};
}

test('translation waits for actual full duration instead of inventing 343 seconds',async()=>{
  const b=metadata(),video={readyState:0,duration:NaN};let settled=false;
  const p=b.wait(()=>video,new AbortController().signal).then(v=>{settled=true;return v;});
  await Promise.resolve();assert.equal(settled,false);
  video.readyState=1;video.duration=3395.881;b.tick();
  assert.equal((await p).duration,3395.881);assert.equal(b.timers.size,0);
});

test('stopping during metadata wait aborts and cancels pending checks',async()=>{
  const b=metadata(),c=new AbortController();const p=b.wait(()=>null,c.signal);
  c.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(b.timers.size,0);
});

test('unknown metadata times out without creating a fake-duration request',async()=>{
  const b=metadata();const p=b.wait(()=>({readyState:4,duration:Infinity}),new AbortController().signal,100);
  b.tick();await assert.rejects(p,/Видео ещё загружается/);assert.equal(b.timers.size,0);
});
