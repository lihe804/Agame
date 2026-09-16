/**
 * 登天云梯专项 CDP 检查：
 *   1. 校验 500 平台、20 个宝箱、动态平台与最高高度
 *   2. 检查旋转/浮动平台确实在移动
 *   3. 直接触发第一座阶段宝箱，核对积分、HUD 和检查点
 *   4. 输出起点、旋转区、宝箱区和终点的截图
 *
 * 用法: node tools/cdp-sky-check.mjs [url] [outPrefix]
 */
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const outPrefix = process.argv[3] || 'D:/code/Agame/.tmp/shots/sky';
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

async function shoot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = outPrefix + '_' + name + '.png';
  fs.writeFileSync(path, Buffer.from(response.data, 'base64'));
  console.log('shot ->', path);
}

async function moveViewTo(platformExpression, yaw, pitch, dist) {
  await evaluate(`(() => {
    const p = ${platformExpression};
    const state = window.__wb.state;
    state.player.pos.set(p.x, p.top, p.z);
    state.player.vel.set(0, 0, 0);
    state.player.vy = 0;
    state.player.onGround = true;
    state.rig.yaw = ${yaw};
    state.rig.pitch = ${pitch};
    state.rig.dist = ${dist};
    state.rig.initialized = false;
  })()`);
  await sleep(900);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url });
problems.length = 0;

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
await sleep(350);
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await sleep(2200);

const skyStats = await evaluate(`(() => {
  const state = window.__wb.state;
  const visual = state.beach.courseVisual('sky');
  const heightPlatforms = state.beach.courseVisual('height').platforms;
  const dynamic = visual.platforms.filter((platform) => platform.motion);
  let minDistance = Infinity;
  let maxDistance = 0;
  let maxPair = null;
  let maxRise = 0;
  const basePosition = (platform) => {
    const motion = platform.motion;
    if (!motion) return { x: platform.x, z: platform.z };
    if (motion.type === 'orbit') {
      return {
        x: motion.cx + Math.cos(motion.phase) * motion.radius,
        z: motion.cz + Math.sin(motion.phase) * motion.radius
      };
    }
    if (motion.type === 'shuttle') return { x: motion.x0, z: motion.z0 };
    return { x: platform.x, z: platform.z };
  };
  for (let i = 1; i < visual.platforms.length; i++) {
    const previous = visual.platforms[i - 1];
    const current = visual.platforms[i];
    const previousBase = basePosition(previous);
    const currentBase = basePosition(current);
    const distance = Math.hypot(currentBase.x - previousBase.x, currentBase.z - previousBase.z);
    minDistance = Math.min(minDistance, distance);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxPair = [previous.number, current.number];
    }
    maxRise = Math.max(maxRise, current.top - previous.top);
  }
  const houseConflicts = visual.platforms.filter((platform) =>
    Math.abs(platform.x - 15) < 4.5 &&
    Math.abs(platform.z - 7) < 4.5 &&
    platform.top < 20
  );
  const planarHouseCrossings = visual.platforms.filter((platform) =>
    Math.abs(platform.x - 15) < 4.5 &&
    Math.abs(platform.z - 7) < 4.5
  );
  const heightConflicts = [];
  for (const sky of visual.platforms) {
    for (const height of heightPlatforms) {
      const horizontal = Math.hypot(sky.x - height.x, sky.z - height.z);
      if (horizontal < sky.half + height.half + 0.45 && Math.abs(sky.top - height.top) < 0.8) {
        heightConflicts.push([sky.number, sky.x, sky.z, sky.top, height.x, height.z, height.top]);
      }
    }
  }
  return {
    platforms: visual.platforms.length,
    rewards: visual.rewards.length,
    dynamic: dynamic.length,
    orbit: dynamic.filter((platform) => platform.motion.type === 'orbit').length,
    lift: dynamic.filter((platform) => platform.motion.type === 'lift').length,
    shuttle: dynamic.filter((platform) => platform.motion.type === 'shuttle').length,
    maxTop: Math.max(...visual.platforms.map((platform) => platform.top)),
    minDistance,
    maxDistance,
    maxPair,
    maxRise,
    nextStageLocked: visual.platforms[25].locked,
    houseConflicts: houseConflicts.map((platform) => [platform.number, platform.x, platform.z, platform.top]),
    planarHouseCrossings: planarHouseCrossings.map((platform) => [platform.number, platform.x, platform.z, platform.top]),
    heightConflicts,
    rewardNumbers: visual.platforms.filter((platform) => platform.reward).map((platform) => platform.number)
  };
})()`);
console.log('sky stats:', JSON.stringify(skyStats));
if (skyStats.platforms !== 500) throw new Error('平台数不是 500');
if (skyStats.rewards !== 20) throw new Error('阶段宝箱数不是 20');
if (skyStats.dynamic < 100) throw new Error('动态平台数量异常');
if (skyStats.minDistance < 2.2) throw new Error('存在过近的相邻平台');
if (skyStats.maxDistance > 3.3) throw new Error('存在过远的相邻平台');
if (skyStats.maxRise > 0.65) throw new Error('存在无法跳上的高度差');
if (!skyStats.nextStageLocked) throw new Error('登天云梯没有阻止跨阶段捷径');
if (skyStats.planarHouseCrossings.length) throw new Error('云梯穿过房屋或环屋跳高区域');
if (skyStats.houseConflicts.length || skyStats.heightConflicts.length) throw new Error('云梯与房顶关卡发生碰撞');
if (skyStats.rewardNumbers.some((number, index) => number !== (index + 1) * 25)) {
  throw new Error('宝箱没有按每 25 个平台分布');
}

const oceanStats = await evaluate(`(() => {
  const state = window.__wb.state;
  const visual = state.beach.courseVisual('ocean');
  const heightPlatforms = state.beach.courseVisual('height').platforms;
  const dynamic = visual.platforms.filter((platform) => platform.motion);
  const restricted = visual.platforms.filter((platform) => {
    const nearOldSea = platform.x > -28 && platform.x < -2 && platform.z > -56 && platform.z < 6;
    const nearHouse = platform.x > 11 && platform.x < 19 && platform.z > 3 && platform.z < 11;
    return nearOldSea || nearHouse;
  });
  let minDistance = Infinity;
  let maxDistance = 0;
  let maxRise = 0;
  let maxRisePair = null;
  const basePosition = (platform) => {
    const motion = platform.motion;
    if (!motion) return { x: platform.x, z: platform.z, top: platform.top };
    if (motion.type === 'orbit') {
      return {
        x: motion.cx,
        z: motion.cz,
        top: platform.top
      };
    }
    if (motion.type === 'shuttle') return { x: motion.x0, z: motion.z0, top: platform.top };
    if (motion.type === 'wave') return { x: motion.x0, z: motion.z0, top: motion.baseTop };
    return { x: platform.x, z: platform.z, top: motion.baseTop };
  };
  for (let i = 1; i < visual.platforms.length; i++) {
    const previous = visual.platforms[i - 1];
    const current = visual.platforms[i];
    const previousBase = basePosition(previous);
    const currentBase = basePosition(current);
    const distance = Math.hypot(currentBase.x - previousBase.x, currentBase.z - previousBase.z);
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
    const rise = Math.abs(currentBase.top - previousBase.top);
    if (rise > maxRise) {
      maxRise = rise;
      maxRisePair = [previous.number, current.number, previousBase.top, currentBase.top];
    }
  }
  const nonAdjacentOverlaps = [];
  for (let i = 0; i < visual.platforms.length; i++) {
    for (let j = i + 2; j < visual.platforms.length; j++) {
      const a = visual.platforms[i];
      const b = visual.platforms[j];
      const overlapX = Math.abs(a.x - b.x) < a.half + b.half + 0.08;
      const overlapZ = Math.abs(a.z - b.z) < a.half + b.half + 0.08;
      if (overlapX && overlapZ && Math.abs(a.top - b.top) < 1.55) {
        nonAdjacentOverlaps.push([a.number, b.number]);
      }
    }
  }
  const heightConflicts = [];
  for (const ocean of visual.platforms) {
    for (const height of heightPlatforms) {
      const distance = Math.hypot(ocean.x - height.x, ocean.z - height.z);
      if (distance < ocean.half + height.half + 0.55 && Math.abs(ocean.top - height.top) < 1.5) {
        heightConflicts.push([ocean.number, height.x, height.z]);
      }
    }
  }
  const baseXs = visual.platforms.map((platform) => {
    const motion = platform.motion;
    if (!motion) return platform.x;
    if (motion.type === 'orbit') return motion.cx;
    if (motion.type === 'shuttle') return motion.x0;
    if (motion.type === 'wave') return motion.x0;
    return platform.x;
  });
  return {
    platforms: visual.platforms.length,
    rewards: visual.rewards.length,
    dynamic: dynamic.length,
    orbit: dynamic.filter((platform) => platform.motion.type === 'orbit').length,
    lift: dynamic.filter((platform) => platform.motion.type === 'lift').length,
    shuttle: dynamic.filter((platform) => platform.motion.type === 'shuttle').length,
    wave: dynamic.filter((platform) => platform.motion.type === 'wave').length,
    restricted: restricted.length,
    seaPlatforms: visual.platforms.filter((platform) => platform.z < -3).length,
    minTop: Math.min(...visual.platforms.map((platform) => platform.top)),
    maxTop: Math.max(...visual.platforms.map((platform) => platform.top)),
    minDistance,
    maxDistance,
    maxRise,
    maxRisePair,
    nonAdjacentOverlaps,
    nextStageLocked: visual.platforms[25].locked,
    heightConflicts,
    baseXMin: Math.min(...baseXs),
    baseXMax: Math.max(...baseXs),
    endZ: visual.platforms[visual.platforms.length - 1].z,
    propKinds: [...new Set(visual.platforms.map((platform) => platform.prop))].filter(Boolean),
    rewardNumbers: visual.platforms.filter((platform) => platform.reward).map((platform) => platform.number)
  };
})()`);
console.log('ocean stats:', JSON.stringify(oceanStats));
if (oceanStats.platforms !== 500 || oceanStats.rewards !== 20) throw new Error('潮汐远征平台或宝箱数量错误');
if (oceanStats.dynamic < 150 || oceanStats.wave < 6) throw new Error('潮汐远征动态平台数量不足');
if (oceanStats.restricted !== 0) throw new Error('潮汐远征侵入旧关、房屋或北岸区域');
if (oceanStats.seaPlatforms < 350) throw new Error('潮汐远征进入海面的平台不足');
if (oceanStats.minDistance < 1.65 || oceanStats.maxDistance > 3.3) throw new Error('潮汐远征相邻距离异常');
if (oceanStats.maxRise > 0.65) throw new Error('潮汐远征高度差过大');
if (oceanStats.nonAdjacentOverlaps.length) throw new Error('潮汐远征存在非相邻平台重叠');
if (oceanStats.heightConflicts.length) throw new Error('潮汐远征影响到环屋跳高');
if (oceanStats.baseXMax - oceanStats.baseXMin < 10) throw new Error('潮汐远征缺少防止捷径的折返路线');
if (oceanStats.endZ > -180) throw new Error('潮汐远征没有向远海延伸');
if (!oceanStats.nextStageLocked) throw new Error('潮汐远征没有阻止跨阶段捷径');
if (oceanStats.rewardNumbers.some((number, index) => number !== (index + 1) * 25)) {
  throw new Error('潮汐远征宝箱没有按每 25 个平台分布');
}

const moving = await evaluate(`(() => {
  const state = window.__wb.state;
  const p = state.beach.courseVisual('sky').platforms.find((platform) => platform.motion);
  return { number: p.number, x: p.x, z: p.z, top: p.top };
})()`);
await sleep(1200);
const motionDelta = await evaluate(`(() => {
  const state = window.__wb.state;
  const p = state.beach.courseVisual('sky').platforms.find((platform) => platform.number === ${moving.number});
  return { number: p.number, x: p.x, z: p.z, top: p.top };
})()`);
console.log('motion sample:', JSON.stringify({ before: moving, after: motionDelta }));
const motionDistance = Math.hypot(motionDelta.x - moving.x, motionDelta.z - moving.z);
if (motionDistance < 0.05 && Math.abs(motionDelta.top - moving.top) < 0.01) {
  throw new Error('动态平台没有移动');
}

await evaluate(`(() => {
  const state = window.__wb.state;
  state.beach.setCourseStage('sky', 1);
  const p = state.beach.courseVisual('sky').platforms.find((platform) => platform.motion?.type === 'orbit');
  state.player.pos.set(p.x, p.top, p.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await sleep(1100);
const riderDelta = await evaluate(`(() => {
  const state = window.__wb.state;
  const p = state.beach.courseVisual('sky').platforms.find((platform) => platform.motion?.type === 'orbit');
  return {
    platform: { x: p.x, z: p.z },
    player: { x: state.player.pos.x, z: state.player.pos.z },
    grounded: state.player.onGround
  };
})()`);
const riderOffset = Math.hypot(
  riderDelta.player.x - riderDelta.platform.x,
  riderDelta.player.z - riderDelta.platform.z
);
console.log('orbit rider offset:', riderOffset.toFixed(3));
if (riderOffset > 0.3 || !riderDelta.grounded) throw new Error('玩家没有随旋转平台同步移动');
await evaluate("window.__wb.state.beach.setCourseStage('sky', 0)");

await moveViewTo("window.__wb.state.beach.rewards[0].platform", 0.8, 0.2, 8);
await shoot('01_start');

await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.rewards.find((item) => item.courseId === 'sky');
  const p = reward.platform;
  state.player.pos.set(p.x, p.top, p.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await sleep(1300);
const rewardResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.rewards.find((item) => item.courseId === 'sky');
  return {
    opened: reward.opened,
    score: state.score.points,
    scoreText: document.getElementById('score-value').textContent,
    stageText: document.getElementById('score-stage').textContent,
    saveText: document.getElementById('save-status').textContent,
    checkpointStage: state.timer.checkpoint?.stage || null,
    savedCheckpoint: JSON.parse(localStorage.getItem('wb-course-progress-v2'))?.courses?.sky?.checkpointNumber || null,
    nextStageUnlocked: !state.beach.courseVisual('sky').platforms[25].locked
  };
})()`);
console.log('reward result:', JSON.stringify(rewardResult));
if (!rewardResult.opened || rewardResult.score !== 250 || rewardResult.savedCheckpoint !== 25 || !rewardResult.nextStageUnlocked) {
  throw new Error('宝箱积分或自动存档没有正确写入');
}
await shoot('02_reward');

await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoint;
  state.player.pos.set(checkpoint.x + 3, checkpoint.top + 2, checkpoint.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyR', key: 'r', windowsVirtualKeyCode: 82 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyR', key: 'r', windowsVirtualKeyCode: 82 });
await sleep(450);
const restoreResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoint;
  return {
    distance: Math.hypot(state.player.pos.x - checkpoint.x, state.player.pos.z - checkpoint.z),
    topDelta: Math.abs(state.player.pos.y - checkpoint.top)
  };
})()`);
console.log('save restore:', JSON.stringify(restoreResult));
if (restoreResult.distance > 0.2 || restoreResult.topDelta > 0.2) {
  throw new Error('按 R 没有返回存档点');
}

await moveViewTo(
  "window.__wb.state.beach.courseVisual('ocean').rewards[0].platform",
  -0.4,
  0.18,
  8.5
);
await sleep(900);
const oceanRewardResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.courseVisual('ocean').rewards[0];
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    opened: reward.opened,
    score: state.score.points,
    stageText: document.getElementById('score-stage').textContent,
    saveText: document.getElementById('save-status').textContent,
    skyCheckpoint: saved?.courses?.sky?.checkpointNumber || null,
    oceanCheckpoint: saved?.courses?.ocean?.checkpointNumber || null,
    nextStageUnlocked: !state.beach.courseVisual('ocean').platforms[25].locked
  };
})()`);
console.log('ocean reward:', JSON.stringify(oceanRewardResult));
if (!oceanRewardResult.opened || oceanRewardResult.skyCheckpoint !== 25 || oceanRewardResult.oceanCheckpoint !== 25 || !oceanRewardResult.nextStageUnlocked) {
  throw new Error('两个长关的存档互相覆盖');
}
await shoot('04_ocean_reward');

await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoint;
  state.player.pos.set(checkpoint.x + 3, checkpoint.top + 2, checkpoint.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyR', key: 'r', windowsVirtualKeyCode: 82 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyR', key: 'r', windowsVirtualKeyCode: 82 });
await sleep(450);
const oceanRestore = await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoint;
  return {
    course: state.activeCourse,
    distance: Math.hypot(state.player.pos.x - checkpoint.x, state.player.pos.z - checkpoint.z)
  };
})()`);
console.log('ocean save restore:', JSON.stringify(oceanRestore));
if (oceanRestore.course !== 'ocean' || oceanRestore.distance > 0.2) {
  throw new Error('潮汐远征存档载入失败');
}

await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 80; i++) {
  await sleep(250);
  const loaded = await evaluate("document.getElementById('loading')?.classList.contains('hidden')");
  if (loaded) break;
}
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await sleep(1600);
const reloadSave = await evaluate(`(() => {
  const state = window.__wb.state;
  return {
    points: state.score.points,
    activeCourse: state.activeCourse,
    skyCheckpoint: state.score.courses.sky.checkpointNumber,
    oceanCheckpoint: state.score.courses.ocean.checkpointNumber,
    skyOpened: state.beach.courseVisual('sky').rewards.filter((reward) => reward.opened).length,
    oceanOpened: state.beach.courseVisual('ocean').rewards.filter((reward) => reward.opened).length
  };
})()`);
console.log('reload save:', JSON.stringify(reloadSave));
if (
  reloadSave.points !== 475 ||
  reloadSave.skyCheckpoint !== 25 ||
  reloadSave.oceanCheckpoint !== 25 ||
  reloadSave.skyOpened !== 1 ||
  reloadSave.oceanOpened !== 1
) {
  throw new Error('刷新后分关存档恢复异常');
}

const oceanRescue = await evaluate(`(() => {
  const state = window.__wb.state;
  state.timer.running = true;
  state.timer.course = 'ocean';
  state.timer.start = performance.now();
  state.player.pos.set(0, -1, -30);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = false;
  return true;
})()`);
await waitFor(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoints.ocean;
  return state.timer.course === 'ocean' &&
    Math.hypot(state.player.pos.x - checkpoint.x, state.player.pos.z - checkpoint.z) < 1;
})()`);
const oceanRescueResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const checkpoint = state.timer.checkpoints.ocean;
  return {
    distance: Math.hypot(state.player.pos.x - checkpoint.x, state.player.pos.z - checkpoint.z),
    course: state.timer.course
  };
})()`);
console.log('ocean water rescue:', JSON.stringify(oceanRescueResult));
if (!oceanRescue || oceanRescueResult.course !== 'ocean' || oceanRescueResult.distance > 1) {
  throw new Error('潮汐关落水没有回到自己的检查点');
}

const seaRescue = await evaluate(`(() => {
  const state = window.__wb.state;
  state.timer.running = true;
  state.timer.course = 'sea';
  state.timer.start = performance.now();
  state.player.pos.set(0, -1, -30);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = false;
  return true;
})()`);
await waitFor(`(() => {
  const state = window.__wb.state;
  const start = state.beach.courseVisual('sea').platforms[0];
  return state.timer.course === 'sea' &&
    Math.hypot(state.player.pos.x - start.x, state.player.pos.z - start.z) < 1;
})()`);
const seaRescueResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const start = state.beach.courseVisual('sea').platforms[0];
  return {
    distance: Math.hypot(state.player.pos.x - start.x, state.player.pos.z - start.z),
    course: state.timer.course
  };
})()`);
console.log('sea water rescue:', JSON.stringify(seaRescueResult));
if (!seaRescue || seaRescueResult.course !== 'sea' || seaRescueResult.distance > 1) {
  throw new Error('深海关落水没有回到第一关起点');
}

const idleWaterPosition = await evaluate(`(() => {
  const state = window.__wb.state;
  state.timer.running = false;
  state.timer.course = null;
  state.player.pos.set(0, -1, -30);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = false;
  return { x: state.player.pos.x, z: state.player.pos.z };
})()`);
await sleep(180);
const idleWaterResult = await evaluate(`(() => {
  const state = window.__wb.state;
  return { x: state.player.pos.x, z: state.player.pos.z };
})()`);
const idleMove = Math.hypot(idleWaterResult.x - idleWaterPosition.x, idleWaterResult.z - idleWaterPosition.z);
console.log('idle water movement:', idleMove.toFixed(2));
if (idleMove > 3) throw new Error('未开始关卡时仍触发了错误的水中传送');

const oceanMotionExpression = `window.__wb.state.beach.courseVisual('ocean').platforms.find((p) => p.motion?.type === 'wave')`;
await moveViewTo(oceanMotionExpression, 0.3, 0.16, 11);
await shoot('05_ocean_wave');

const rotorExpression = `window.__wb.state.beach.courseVisual('sky').platforms.find((p) => p.motion?.type === 'orbit')`;
await moveViewTo(rotorExpression, 1.1, 0.18, 11.5);
await shoot('03_sky_rotor');

const finalExpression = `window.__wb.state.beach.rewards[window.__wb.state.beach.rewards.filter((r) => r.courseId === 'sky').length - 1].platform`;
await moveViewTo(finalExpression, 0.7, 0.15, 12);
await shoot('06_sky_final');

const oceanFinalExpression = `window.__wb.state.beach.courseVisual('ocean').rewards[window.__wb.state.beach.courseVisual('ocean').rewards.length - 1].platform`;
await moveViewTo(oceanFinalExpression, 0.5, 0.15, 12);
await shoot('07_ocean_final');

const fps = await evaluate(`new Promise((resolve) => {
  let frames = 0;
  const start = performance.now();
  const tick = (now) => {
    frames++;
    if (now - start >= 1000) resolve(frames);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`);
console.log('headless fps sample:', fps);
const renderStats = await evaluate(`(() => {
  const render = window.__wb.renderer.info.render;
  return { calls: render.calls, triangles: render.triangles, geometries: window.__wb.renderer.info.memory.geometries };
})()`);
console.log('render stats:', JSON.stringify(renderStats));

await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true
});
await evaluate("document.getElementById('timer').classList.remove('hidden')");
await sleep(500);
const mobileLayout = await evaluate(`(() => {
  const score = document.getElementById('score-panel').getBoundingClientRect();
  const timer = document.getElementById('timer').getBoundingClientRect();
  const lock = document.getElementById('lock-tip').getBoundingClientRect();
  const overlap = !(score.right <= timer.left || score.left >= timer.right || score.bottom <= timer.top || score.top >= timer.bottom);
  const lockOverlap = !(score.right <= lock.left || score.left >= lock.right || score.bottom <= lock.top || score.top >= lock.bottom);
  return {
    score: { left: score.left, top: score.top, right: score.right, bottom: score.bottom },
    timer: { left: timer.left, top: timer.top, right: timer.right, bottom: timer.bottom },
    lock: { left: lock.left, top: lock.top, right: lock.right, bottom: lock.bottom },
    overlap,
    lockOverlap,
    lockFits: lock.left >= 0 && lock.right <= innerWidth
  };
})()`);
console.log('mobile HUD:', JSON.stringify(mobileLayout));
if (mobileLayout.overlap) throw new Error('移动端积分面板与计时器重叠');
if (mobileLayout.lockOverlap || !mobileLayout.lockFits) throw new Error('移动端锁定提示与 HUD 重叠或越界');
await shoot('08_mobile');

await evaluate("document.getElementById('reset-progress').click()");
await sleep(1800);
const resetResult = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    points: state.score.points,
    scoreText: document.getElementById('score-value').textContent,
    skyStage: state.score.courses.sky.highestStage,
    oceanStage: state.score.courses.ocean.highestStage,
    skyOpened: state.beach.courseVisual('sky').rewards.filter((reward) => reward.opened).length,
    oceanOpened: state.beach.courseVisual('ocean').rewards.filter((reward) => reward.opened).length,
    savedPoints: saved?.points
  };
})()`);
console.log('reset all points:', JSON.stringify(resetResult));
if (
  resetResult.points !== 0 ||
  resetResult.skyStage !== 0 ||
  resetResult.oceanStage !== 0 ||
  resetResult.skyOpened !== 0 ||
  resetResult.oceanOpened !== 0 ||
  resetResult.savedPoints !== 0
) {
  throw new Error('一键刷新积分没有清空全部积分和宝箱进度');
}

if (problems.length) {
  console.log('page problems:');
  for (const problem of [...new Set(problems)]) console.log('-', problem);
} else {
  console.log('page problems: none');
}

ws.close();
setTimeout(() => process.exit(0), 50);
