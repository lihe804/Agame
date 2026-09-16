/**
 * 用 CDP 驱动无头 Chrome 做端到端检查：
 *   1. 打开页面，等 #loading 隐藏（模型加载完成）
 *   2. 截选角页
 *   3. 点击指定角色卡，进入场景
 *   4. 模拟按住 W 前进 + 空格跳跃，再截图
 *   5. 打印页面 JS 报错
 *
 * 用法: node cdp-check.mjs <url> <outPrefix> [charIndex]
 */
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const outPrefix = process.argv[3] || 'D:/code/Agame/.tmp/shots/shot';
const charIndex = process.argv[4] ?? '0';
const CDP = 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickTarget() {
  const res = await fetch(CDP + '/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

const wsUrl = await pickTarget();
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});

let msgId = 0;
const pending = new Map();
const problems = [];

ws.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    problems.push(msg.params.type.toUpperCase() + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  }
});

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

async function shoot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = `${outPrefix}_${name}.png`;
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('shot ->', p);
}

async function key(type, code, keyName, vk) {
  await send('Input.dispatchKeyEvent', {
    type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
}

console.log('navigate', url);
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

const deadline = Date.now() + 120000;
let loaded = false;
while (Date.now() < deadline) {
  await sleep(1500);
  const txt = await evaluate("(document.getElementById('loading-text')||{}).textContent || ''");
  const hidden = await evaluate("document.getElementById('loading').classList.contains('hidden')");
  console.log('  loading text:', JSON.stringify(txt), 'hidden:', hidden);
  if (hidden) { loaded = true; break; }
}
if (!loaded) console.log('!! 模型加载未在 120s 内完成');

await sleep(2500);
await shoot('01_select');

console.log('click card', charIndex);
await evaluate(`document.querySelector('.card[data-char="${charIndex}"]').click()`);
await sleep(4000);
await shoot('02_explore_idle');

console.log('walk forward + jump');
await key('keyDown', 'KeyW', 'w', 87);
await sleep(1200);
await key('keyDown', 'ShiftLeft', 'Shift', 16);
await sleep(600);
await key('keyDown', 'Space', ' ', 32);
await sleep(120);
await key('keyUp', 'Space', ' ', 32);
await sleep(900);
await shoot('03_explore_walk');
await key('keyUp', 'KeyW', 'w', 87);
await key('keyUp', 'ShiftLeft', 'Shift', 16);

// 转向看一下场景
console.log('drag to rotate camera');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 450, button: 'left', clickCount: 1 });
for (let i = 0; i < 12; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800 + i * 22, y: 450, button: 'left' });
  await sleep(40);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1064, y: 450, button: 'left', clickCount: 1 });
await sleep(1500);
await shoot('04_explore_rotated');

// 伪骨骼检查：切割是否成功 + 行走摆臂
console.log('limb rig test');
const limbInfo = await evaluate("JSON.stringify(window.__wb.state.player.limb ? Object.keys(window.__wb.state.player.limb) : null)");
console.log('limb parts:', limbInfo);
await evaluate("window.__wb.state.player.pos.set(0, 0, 4); window.__wb.state.player.vel.set(0,0,0); window.__wb.state.player.vy = 0;");
await evaluate("window.__wb.state.rig.yaw = 0; window.__wb.state.rig.pitch = 0.3; window.__wb.state.rig.dist = 3.4;");
await key('keyDown', 'KeyW', 'w', 87);
await sleep(1500);
const limbRot = await evaluate("(() => { const L = window.__wb.state.player.limb; return JSON.stringify({lArm: +L.lArm.rotation.x.toFixed(2), rArm: +L.rArm.rotation.x.toFixed(2), lLeg: +L.lLeg.rotation.x.toFixed(2), rLeg: +L.rLeg.rotation.x.toFixed(2)}); })()");
console.log('limb walk rotations:', limbRot);
await shoot('09_limb_walk');
await key('keyUp', 'KeyW', 'w', 87);
// 跳跃张臂
await key('keyDown', 'Space', ' ', 32);
await sleep(120);
await key('keyUp', 'Space', ' ', 32);
await sleep(300);
const limbAir = await evaluate("(() => { const L = window.__wb.state.player.limb; return JSON.stringify({lArmZ: +L.lArm.rotation.z.toFixed(2), lArmX: +L.lArm.rotation.x.toFixed(2), airK: +window.__wb.state.player.airK.toFixed(2)}); })()");
console.log('limb air rotations:', limbAir);
await shoot('10_limb_jump');
await sleep(1200);

// 房门交互测试：传送到门口 → 提示出现 → E 开门 → 走进屋内
console.log('door interaction test');
await evaluate("window.__wb.state.player.pos.set(15, 2.5, 2.6); window.__wb.state.player.vel.set(0, 0, 0); window.__wb.state.player.vy = 0;");
await evaluate("window.__wb.state.rig.yaw = Math.PI; window.__wb.state.rig.pitch = 0.2; window.__wb.state.rig.dist = 4.5;");
await sleep(2200);
await shoot('05_door_hint');
const hintVisible = await evaluate("!document.getElementById('hint').classList.contains('hidden')");
console.log('hint visible:', hintVisible);

await key('keyDown', 'KeyE', 'e', 69);
await key('keyUp', 'KeyE', 'e', 69);
await sleep(1400);
await shoot('06_door_open');
const doorOpen = await evaluate("window.__wb.state.beach.door.open");
console.log('door open:', doorOpen);

// 走进门洞，检查是否进到露台上
await key('keyDown', 'KeyW', 'w', 87);
await sleep(2600);
await key('keyUp', 'KeyW', 'w', 87);
await sleep(800);
const inside = await evaluate("JSON.stringify({x: +window.__wb.state.player.pos.x.toFixed(2), y: +window.__wb.state.player.pos.y.toFixed(2), z: +window.__wb.state.player.pos.z.toFixed(2)})");
console.log('player pos after walk-in:', inside);
await shoot('07_interior');

// 相机防穿墙：在屋里把镜头拉远，确认相机会被墙收近
console.log('camera anti-clip test (inside house)');
await evaluate("window.__wb.state.rig.dist = 9; window.__wb.state.rig.yaw = Math.PI * 0.8;");
await sleep(1800);
const camInside = await evaluate("JSON.stringify({camY: +window.__wb.camera.position.y.toFixed(2), camZ: +window.__wb.camera.position.z.toFixed(2), dist: +window.__wb.state.rig.smoothDist.toFixed(2)})");
console.log('camera state inside house:', camInside);
await shoot('08_camera_clamped');

// 退出来再关上门
await evaluate("window.__wb.state.player.pos.set(15, 2.9, 2.4); window.__wb.state.player.vel.set(0,0,0);");
await sleep(600);
await key('keyDown', 'KeyE', 'e', 69);
await key('keyUp', 'KeyE', 'e', 69);
await sleep(900);
const doorClosed = await evaluate("!window.__wb.state.beach.door.open");
console.log('door closed again:', doorClosed);

const perf = await evaluate("JSON.stringify({w: innerWidth, h: innerHeight, canvas: !!document.querySelector('canvas')})");
console.log('page state:', perf);

if (problems.length) {
  console.log('\n=== 页面问题 ===');
  for (const p of [...new Set(problems)].slice(0, 25)) console.log('-', p);
} else {
  console.log('\n无控制台报错');
}

ws.close();
