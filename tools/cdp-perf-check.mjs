/**
 * 三张 500 台长关的浏览器性能采样。
 *
 * 用法: node tools/cdp-perf-check.mjs [url]
 */
const url = process.argv[2] || 'http://127.0.0.1:8765/';
const CDP = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pickTarget() {
  const response = await fetch(CDP + '/json/list');
  const list = await response.json();
  const page = list.find((target) => target.type === 'page');
  if (!page) throw new Error('没有可用的页面目标');
  return page.webSocketDebuggerUrl;
}

const ws = new WebSocket(await pickTarget());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();
const problems = [];

ws.addEventListener('message', (event) => {
  let message;
  try { message = JSON.parse(event.data); } catch (_) { return; }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result ?? message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    problems.push('EXCEPTION: ' + (details.exception?.description || details.text));
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    problems.push(message.params.type.toUpperCase() + ': ' +
      message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  }
});

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('超时: ' + method));
    }, 60000);
    pending.set(id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitFor(expression, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error('等待状态超时: ' + expression);
}

async function sampleCourse(id, platformNumber) {
  console.log('sampling:', id);
  await evaluate(`(() => {
    const state = window.__wb.state;
    const visual = state.beach.courseVisual('${id}');
    const platform = visual.platforms.find((item) => item.number === ${platformNumber});
    state.beach.setCourseStage('${id}', platform.stage);
    state.beach.setViewMode('${id}');
    state.activeCourse = '${id}';
    state.timer.running = false;
    state.timer.course = null;
    state.timer.checkpoints['${id}'] = platform;
    state.player.respawn({ x: platform.x, y: platform.top + 0.04, z: platform.z });
    state.player.group.position.copy(state.player.pos);
    state.rig.initialized = false;
  })()`);
  await sleep(1000);

  return evaluate(`new Promise((resolve) => {
    const frameTimes = [];
    let previous = 0;
    const safety = setTimeout(() => {
      const info = window.__wb.renderer.info;
      const gl = window.__wb.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      resolve({
        course: '${id}',
        timedOut: true,
        frames: frameTimes.length,
        calls: info.render.calls,
        triangles: info.render.triangles,
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      });
    }, 20000);
    const sample = (now) => {
      if (previous) frameTimes.push(now - previous);
      previous = now;
      if (frameTimes.length < 30) {
        requestAnimationFrame(sample);
        return;
      }
      clearTimeout(safety);
      const sorted = frameTimes.slice().sort((a, b) => a - b);
      const average = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
      const info = window.__wb.renderer.info;
      const gl = window.__wb.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      resolve({
        course: '${id}',
        fps: 1000 / average,
        averageMs: average,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: Math.max(...frameTimes),
        longFrames: frameTimes.filter((value) => value > 33.4).length,
        calls: info.render.calls,
        triangles: info.render.triangles,
        frames: frameTimes.length,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      });
    };
    requestAnimationFrame(sample);
  })`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.setWebLifecycleState', { state: 'active' });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url });

for (let i = 0; i < 100; i++) {
  await sleep(200);
  if (await evaluate("document.getElementById('loading')?.classList.contains('hidden')")) break;
}
await evaluate("localStorage.removeItem('wb-course-progress-v2'); localStorage.removeItem('wb-sky-progress-v1')");
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 100; i++) {
  await sleep(200);
  if (await evaluate("document.getElementById('loading')?.classList.contains('hidden')")) break;
}
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await waitFor("window.__wb.state.mode === 'explore'");
await sleep(700);

const results = [];
results.push(await sampleCourse('sky', 251));
results.push(await sampleCourse('ocean', 251));
results.push(await sampleCourse('comet', 251));

console.log('performance:', JSON.stringify(results));
if (results.some((result) => !result.frames)) throw new Error('浏览器未产生可采样的动画帧');
if (problems.length) throw new Error(problems.join('\n'));
ws.close();
