/**
 * 星跃追光专项 CDP 检查：
 *   1. 校验 500 平台、20 宝箱、80 个充能台和每阶段 7 个强制断层
 *   2. 用真实键盘事件验证 F 星跃可跨越第一处强制断层，且会消耗次数
 *   3. 验证充能台、宝箱、复活检查点和刷新积分的资源语义
 *   4. 验证星跃存档与天空、海洋长关互不覆盖
 *
 * 用法: node tools/cdp-comet-check.mjs [url] [outPrefix]
 */
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const outPrefix = process.argv[3] || 'D:/code/Agame/.tmp/shots/comet';
const CDP = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(outPrefix.slice(0, outPrefix.lastIndexOf('/')), { recursive: true });

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
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('超时: ' + method));
    }, 30000);
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

async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error('等待状态超时: ' + expression);
}

async function key(code, keyValue, down) {
  await send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    code,
    key: keyValue,
    windowsVirtualKeyCode: keyValue.toUpperCase().charCodeAt(0)
  });
}

async function shoot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = outPrefix + '_' + name + '.png';
  fs.writeFileSync(path, Buffer.from(response.data, 'base64'));
  console.log('shot ->', path);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url });

for (let i = 0; i < 80; i++) {
  await sleep(250);
  const loaded = await evaluate("document.getElementById('loading')?.classList.contains('hidden')");
  if (loaded) break;
}

await evaluate("localStorage.removeItem('wb-course-progress-v2'); localStorage.removeItem('wb-sky-progress-v1')");
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 80; i++) {
  await sleep(250);
  const loaded = await evaluate("document.getElementById('loading')?.classList.contains('hidden')");
  if (loaded) break;
}
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await sleep(1800);

const stats = await evaluate(`(() => {
  const visual = window.__wb.state.beach.courseVisual('comet');
  const platforms = visual.platforms;
  const intervals = [];
  const routeDistances = [0];
  let minDistance = Infinity;
  let maxDistance = 0;
  let maxRise = 0;
  let headingTurns = 0;
  let headingTravel = 0;
  const nearShortcuts = [];
  for (let i = 1; i < platforms.length; i++) {
    const previous = platforms[i - 1];
    const current = platforms[i];
    const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
    intervals.push(distance);
    routeDistances.push(routeDistances[routeDistances.length - 1] + distance);
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
    maxRise = Math.max(maxRise, current.top - previous.top);
    if (Math.abs(current.routeYaw - previous.routeYaw) > 0.08) headingTurns++;
    headingTravel += Math.abs(Math.atan2(
      Math.sin(current.routeYaw - previous.routeYaw),
      Math.cos(current.routeYaw - previous.routeYaw)
    ));
  }
  for (let i = 0; i < platforms.length; i++) {
    for (let j = i + 2; j < platforms.length; j++) {
      const a = platforms[i];
      const b = platforms[j];
      if (Math.abs(a.top - b.top) > 0.6) continue;
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      const routeDistance = routeDistances[j] - routeDistances[i];
      if (distance < 5.9 && routeDistance - distance > 1.2) {
        nearShortcuts.push([a.number, b.number, distance, routeDistance]);
      }
    }
  }
  const locked = platforms.filter((platform) => platform.locked);
  const houseConflicts = platforms.filter((platform) =>
    Math.abs(platform.x - 15) < 4.5 &&
    Math.abs(platform.z - 7) < 4.5
  );
  return {
    platforms: platforms.length,
    rewards: visual.rewards.length,
    chargePads: platforms.filter((platform) => platform.dashPad).length,
    dashLandings: platforms.filter((platform) => platform.dashRim).length,
    forcedGaps: intervals.filter((distance) => distance > 4.5).length,
    minDistance,
    maxDistance,
    maxRise,
    maxTop: Math.max(...platforms.map((platform) => platform.top)),
    minX: Math.min(...platforms.map((platform) => platform.x)),
    maxX: Math.max(...platforms.map((platform) => platform.x)),
    headingTurns,
    headingTravel,
    nearShortcuts: nearShortcuts.slice(0, 12),
    nearShortcutCount: nearShortcuts.length,
    locked: locked.length,
    nextStageLocked: platforms[25].locked,
    houseConflicts: houseConflicts.length,
    rewardNumbers: platforms.filter((platform) => platform.reward).map((platform) => platform.number)
  };
})()`);
console.log('comet stats:', JSON.stringify(stats));
if (stats.platforms !== 500 || stats.rewards !== 20) throw new Error('星跃追光平台或宝箱数量错误');
if (stats.chargePads !== 80 || stats.dashLandings !== 140 || stats.forcedGaps !== 140) {
  throw new Error('星跃追光充能台或强制断层数量错误');
}
if (stats.minDistance < 2.6 || stats.maxDistance > 6.1) throw new Error('星跃追光相邻距离异常');
if (stats.maxRise > 0.48) throw new Error('星跃追光存在普通跳跃无法承受的高差');
if (stats.maxTop < 75 || stats.minX > -100 || stats.maxX - stats.minX < 50) {
  throw new Error('星跃追光没有形成远海高空曲折路线');
}
if (stats.headingTurns < 60 || stats.headingTravel < 70 || stats.houseConflicts) {
  throw new Error('星跃追光路线过于平直或侵入房屋');
}
if (stats.nearShortcutCount) throw new Error('星跃追光存在可绕开阶段路线的近距捷径');
if (!stats.nextStageLocked || stats.locked === 0) throw new Error('星跃追光没有阻止跨阶段捷径');
if (stats.rewardNumbers.some((number, index) => number !== (index + 1) * 25)) {
  throw new Error('星跃追光宝箱没有按每 25 个平台分布');
}

const launch = await evaluate(`(() => {
  const state = window.__wb.state;
  const platforms = state.beach.courseVisual('comet').platforms;
  const targetIndex = platforms.findIndex((platform) => platform.dashRim && !platform.dashPad && platform.number > 2);
  const target = platforms[targetIndex];
  const source = platforms[targetIndex - 1];
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  state.activeCourse = 'comet';
  state.score.courses.comet.dashCharges = 3;
  state.run.currentCourse = 'comet';
  state.run.checkpoint = source;
  state.run.checkpoints.comet = source;
  state.player.respawn({ x: source.x, y: source.top + 0.02, z: source.z });
  state.player.group.position.copy(state.player.pos);
  state.rig.yaw = Math.atan2(-dx, -dz);
  state.rig.initialized = false;
  state.beach.setViewMode('comet');
  return { source: source.number, target: target.number, targetHalf: target.half, distance: Math.hypot(dx, dz) };
})()`);
await sleep(220);
await key('KeyF', 'f', true);
await key('KeyF', 'f', false);
await waitFor('window.__wb.state.score.courses.comet.dashCharges === 2', 5000);
await waitFor('window.__wb.state.player.dashTime === 0 && window.__wb.state.player.onGround', 12000);
const dashResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const target = state.beach.courseVisual('comet').platforms.find((platform) => platform.number === ${launch.target});
  return {
    charges: state.score.courses.comet.dashCharges,
    distance: Math.hypot(state.player.pos.x - target.x, state.player.pos.z - target.z),
    topDelta: Math.abs(state.player.pos.y - target.top),
    onGround: state.player.onGround,
    dashTime: state.player.dashTime
  };
})()`);
console.log('dash crossing:', JSON.stringify({ launch, result: dashResult }));
if (dashResult.charges !== 2 || !dashResult.onGround || dashResult.distance > launch.targetHalf + 0.2 || dashResult.topDelta > 0.2) {
  throw new Error('F 星跃无法稳定跨越第一处强制断层');
}
await shoot('01_dash_landing');

const chargeResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const pad = state.beach.courseVisual('comet').platforms.find((platform) => platform.dashPad);
  state.score.courses.comet.dashCharges = 0;
  state.player.respawn({ x: pad.x, y: pad.top + 0.02, z: pad.z });
  state.player.group.position.copy(state.player.pos);
  return pad.number;
})()`);
await sleep(250);
const refill = await evaluate(`(() => ({
  charges: window.__wb.state.score.courses.comet.dashCharges,
  text: document.getElementById('dash-status').textContent,
  saved: JSON.parse(localStorage.getItem('wb-course-progress-v2')).courses.comet.dashCharges
}))()`);
console.log('charge pad:', JSON.stringify({ pad: chargeResult, ...refill }));
if (refill.charges !== 3 || refill.text !== '星跃充能 3 / 3' || refill.saved !== 3) {
  throw new Error('充能台没有恢复星跃次数或没有写入存档');
}

const rewardResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.courseVisual('comet').rewards[0];
  const skyCheckpoint = state.beach.courseVisual('sky').platforms[24];
  const oceanCheckpoint = state.beach.courseVisual('ocean').platforms[49];
  state.score.courses.comet.dashCharges = 0;
  state.run.checkpoints.sky = skyCheckpoint;
  state.run.checkpoints.ocean = oceanCheckpoint;
  state.player.respawn({ x: reward.platform.x, y: reward.platform.top + 0.02, z: reward.platform.z });
  state.player.group.position.copy(state.player.pos);
  return {
    reward: reward.platform.number,
    skyCheckpoint: skyCheckpoint.number,
    oceanCheckpoint: oceanCheckpoint.number
  };
})()`);
await sleep(350);
const rewardState = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    opened: state.beach.courseVisual('comet').rewards[0].opened,
    charges: state.score.courses.comet.dashCharges,
    checkpoint: saved?.courses?.comet?.checkpointNumber,
    skyCheckpoint: saved?.courses?.sky?.checkpointNumber,
    oceanCheckpoint: saved?.courses?.ocean?.checkpointNumber,
    nextStageUnlocked: !state.beach.courseVisual('comet').platforms[25].locked
  };
})()`);
console.log('comet reward:', JSON.stringify({ reward: rewardResult, ...rewardState }));
if (!rewardState.opened || rewardState.charges !== 3 || rewardState.checkpoint !== 25 || !rewardState.nextStageUnlocked) {
  throw new Error('星跃宝箱没有正确恢复次数、积分检查点或解锁下一阶段');
}
if (rewardState.skyCheckpoint !== rewardResult.skyCheckpoint || rewardState.oceanCheckpoint !== rewardResult.oceanCheckpoint) {
  throw new Error('星跃存档影响了其他长关');
}

const fallCheckpoint = await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.run.checkpoints.comet;
  state.activeCourse = 'comet';
  state.run.currentCourse = 'comet';
  state.run.checkpoint = checkpoint;
  state.player.pos.set(0, -1, -30);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = false;
  return { x: checkpoint.x, z: checkpoint.z };
})()`);
await sleep(250);
const fallResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.run.checkpoints.comet;
  return {
    distance: Math.hypot(state.player.pos.x - checkpoint.x, state.player.pos.z - checkpoint.z),
    charges: state.score.courses.comet.dashCharges,
    course: state.run.currentCourse
  };
})()`);
console.log('comet fall rescue:', JSON.stringify(fallResult));
if (fallResult.course !== 'comet' || fallResult.distance > 1 || fallResult.charges !== 3) {
  throw new Error('星跃落水没有回到自己的检查点或恢复次数');
}

await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 80; i++) {
  await sleep(250);
  const loaded = await evaluate("document.getElementById('loading')?.classList.contains('hidden')");
  if (loaded) break;
}
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await sleep(1500);
const reloaded = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    activeCourse: state.activeCourse,
    charges: state.score.courses.comet.dashCharges,
    checkpoint: state.score.courses.comet.checkpointNumber,
    opened: state.beach.courseVisual('comet').rewards.filter((reward) => reward.opened).length,
    savedCharge: saved?.courses?.comet?.dashCharges
  };
})()`);
console.log('comet reload:', JSON.stringify(reloaded));
if (reloaded.activeCourse !== 'comet' || reloaded.charges !== 3 || reloaded.checkpoint !== 25 || reloaded.opened !== 1) {
  throw new Error('刷新后星跃检查点或次数没有恢复');
}

if (problems.length) {
  console.log('page problems:');
  for (const problem of [...new Set(problems)]) console.log('-', problem);
  throw new Error('页面运行时出现错误或警告');
}
console.log('page problems: none');

ws.close();
setTimeout(() => process.exit(0), 50);
