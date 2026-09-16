/**
 * 关卡切换专项 CDP 检查：
 *   1. 验证按钮和 T 键按 sky → ocean → comet → free → sky 循环
 *   2. 验证自由模式隐藏三个长关，但 sea / height 训练计时可用
 *   3. 验证自由模式不写入长关积分、宝箱、检查点或 lastCourse
 *   4. 验证三个长关存档互不覆盖，星跃切换后恢复 3 / 3 充能
 *   5. 验证移动端两个 HUD 操作按钮不重叠且不越界
 *
 * 用法: node tools/cdp-switch-check.mjs [url]
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

async function key(code, keyValue) {
  const vk = keyValue.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key: keyValue,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key: keyValue,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
}

async function waitForLoad() {
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (await evaluate("document.getElementById('loading')?.classList.contains('hidden')")) return;
  }
  throw new Error('页面加载超时');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url });
await waitForLoad();

await evaluate("localStorage.removeItem('wb-course-progress-v2'); localStorage.removeItem('wb-sky-progress-v1')");
await send('Page.reload', { ignoreCache: true });
await waitForLoad();
await evaluate("document.querySelector('.card[data-char=\"0\"]').click()");
await sleep(700);

const initial = await evaluate(`(() => {
  const state = window.__wb.state;
  const sky = state.beach.courseVisual('sky').platforms[24];
  const ocean = state.beach.courseVisual('ocean').platforms[49];
  const comet = state.beach.courseVisual('comet').platforms[74];
  state.score.points = 4321;
  state.score.courses.sky.highestStage = 1;
  state.score.courses.ocean.highestStage = 2;
  state.score.courses.comet.highestStage = 3;
  state.score.courses.comet.dashCharges = 0;
  for (const [id, checkpoint] of [['sky', sky], ['ocean', ocean], ['comet', comet]]) {
    const reward = state.beach.courseVisual(id).rewards.find((item) => item.platform === checkpoint);
    state.score.courses[id].collected.add(reward.id);
    state.beach.courseVisual(id).setRewardOpened(reward.id, false);
  }
  state.run.checkpoints.sky = sky;
  state.run.checkpoints.ocean = ocean;
  state.run.checkpoints.comet = comet;
  state.run.currentCourse = 'sky';
  state.run.checkpoint = sky;
  return {
    activeCourse: state.activeCourse,
    button: document.getElementById('course-switch').textContent,
    sky: sky.number,
    ocean: ocean.number,
    comet: comet.number
  };
})()`);
assert(initial.activeCourse === 'sky', '初始关卡不是登天云梯');
assert(initial.button === '切换：潮汐远征', '初始切换按钮文案错误');

await evaluate("document.getElementById('course-switch').click()");
await sleep(180);
const afterButton = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    activeCourse: state.activeCourse,
    checkpoint: state.run.checkpoint?.number,
    playerDistance: Math.hypot(
      state.player.pos.x - state.run.checkpoint.x,
      state.player.pos.z - state.run.checkpoint.z
    ),
    hud: document.getElementById('hud-sub').textContent,
    button: document.getElementById('course-switch').textContent,
    points: state.score.points,
    savedLastCourse: saved.lastCourse,
    saved: {
      sky: saved.courses.sky.checkpointNumber,
      ocean: saved.courses.ocean.checkpointNumber,
      comet: saved.courses.comet.checkpointNumber
    }
  };
})()`);
assert(afterButton.activeCourse === 'ocean', '按钮没有切换到潮汐远征');
assert(afterButton.checkpoint === initial.ocean && afterButton.playerDistance < 0.2, '没有回到海洋关卡检查点');
assert(afterButton.hud.includes('潮汐远征'), 'HUD 没有更新海洋关卡名称');
assert(afterButton.button === '切换：星跃追光', '海洋关切换按钮文案错误');
assert(afterButton.points === 4321, '切换关卡清空了积分');
assert(afterButton.savedLastCourse === 'ocean', '切换后没有保存 lastCourse');
assert(afterButton.saved.sky === initial.sky, '切换海洋时覆盖了天空检查点');
assert(afterButton.saved.ocean === initial.ocean, '海洋检查点保存错误');
assert(afterButton.saved.comet === initial.comet, '切换海洋时覆盖了星轨检查点');

await key('KeyT', 't');
await sleep(180);
const afterKey = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    activeCourse: state.activeCourse,
    charges: state.score.courses.comet.dashCharges,
    savedCharge: saved.courses.comet.dashCharges,
    checkpoint: state.run.checkpoint?.number,
    button: document.getElementById('course-switch').textContent,
    savedLastCourse: saved.lastCourse
  };
})()`);
assert(afterKey.activeCourse === 'comet', 'T 键没有切换到星跃追光');
assert(afterKey.charges === 3 && afterKey.savedCharge === 3, '切到星跃没有恢复 3 / 3 充能');
assert(afterKey.checkpoint === initial.comet, '没有回到星轨检查点');
assert(afterKey.button === '切换：自由模式', '星轨切换按钮文案错误');
assert(afterKey.savedLastCourse === 'comet', 'T 键切换后没有保存 lastCourse');

await key('KeyT', 't');
await sleep(180);
const afterFree = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    activeCourse: state.activeCourse,
    currentCourse: state.run.currentCourse,
    checkpoint: state.run.checkpoint,
    timerRunning: state.timer.running,
    timerHidden: document.getElementById('timer').classList.contains('hidden'),
    visibility: {
      sky: state.beach.courseVisual('sky').group.visible,
      ocean: state.beach.courseVisual('ocean').group.visible,
      comet: state.beach.courseVisual('comet').group.visible,
      sea: state.beach.courseVisual('sea').group.visible,
      height: state.beach.courseVisual('height').group.visible
    },
    button: document.getElementById('course-switch').textContent,
    stageText: document.getElementById('score-stage').textContent,
    points: state.score.points,
    savedLastCourse: saved.lastCourse
  };
})()`);
assert(afterFree.activeCourse === 'free', '切换顺序没有进入自由模式');
assert(afterFree.currentCourse === null && afterFree.checkpoint === null, '自由模式仍绑定了长关检查点');
assert(!afterFree.timerRunning && afterFree.timerHidden, '进入自由模式没有停止训练计时');
assert(
  !afterFree.visibility.sky &&
  !afterFree.visibility.ocean &&
  !afterFree.visibility.comet &&
  afterFree.visibility.sea &&
  afterFree.visibility.height,
  '自由模式没有正确隐藏长关或训练关'
);
assert(afterFree.button === '切换：登天云梯', '自由模式切换按钮文案错误');
assert(afterFree.stageText.includes('自由训练'), '自由模式 HUD 文案错误');
assert(afterFree.points === 4321, '进入自由模式后积分发生变化');
assert(afterFree.savedLastCourse === 'comet', '自由模式错误覆盖了 lastCourse');

const freeBefore = await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.courseVisual('sky').rewards.find((item) => !item.opened);
  const savedBefore = localStorage.getItem('wb-course-progress-v2');
  return {
    savedBefore,
    rewardId: reward.id,
    rewardOpened: reward.opened
  };
})()`);

await evaluate(`(() => {
  const state = window.__wb.state;
  const start = state.beach.courseVisual('sea').platforms[0];
  state.run.onStart.sea = false;
  state.player.pos.set(start.x, start.top, start.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await sleep(260);
const freeSeaTimer = await evaluate(`(() => {
  const state = window.__wb.state;
  return {
    running: state.timer.running,
    course: state.timer.course,
    activeCourse: state.activeCourse,
    visible: !document.getElementById('timer').classList.contains('hidden')
  };
})()`);
assert(
  freeSeaTimer.running &&
  freeSeaTimer.course === 'sea' &&
  freeSeaTimer.activeCourse === 'free' &&
  freeSeaTimer.visible,
  '自由模式的深海训练没有独立计时'
);

await evaluate(`(() => {
  const state = window.__wb.state;
  const start = state.beach.courseVisual('height').platforms[0];
  state.run.onStart.height = false;
  state.player.pos.set(start.x, start.top, start.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await sleep(260);
const freeHeightTimer = await evaluate(`(() => {
  const state = window.__wb.state;
  return {
    running: state.timer.running,
    course: state.timer.course,
    activeCourse: state.activeCourse
  };
})()`);
assert(
  freeHeightTimer.running &&
  freeHeightTimer.course === 'height' &&
  freeHeightTimer.activeCourse === 'free',
  '自由模式的环屋训练没有独立计时'
);

await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.courseVisual('sky').rewards.find((item) => item.id === ${JSON.stringify(freeBefore.rewardId)});
  const p = reward.platform;
  state.player.pos.set(p.x, p.top, p.z);
  state.player.vel.set(0, 0, 0);
  state.player.vy = 0;
  state.player.onGround = true;
})()`);
await sleep(220);
const freeAfter = await evaluate(`(() => {
  const state = window.__wb.state;
  const reward = state.beach.courseVisual('sky').rewards.find((item) => item.id === ${JSON.stringify(freeBefore.rewardId)});
  const savedAfter = localStorage.getItem('wb-course-progress-v2');
  return {
    activeCourse: state.activeCourse,
    rewardOpened: reward.opened,
    savedAfter,
    savedLastCourse: JSON.parse(savedAfter).lastCourse,
    checkpoints: {
      sky: state.run.checkpoints.sky?.number || null,
      ocean: state.run.checkpoints.ocean?.number || null,
      comet: state.run.checkpoints.comet?.number || null
    }
  };
})()`);
assert(freeAfter.activeCourse === 'free', '自由模式训练时切回了正式长关');
assert(!freeBefore.rewardOpened && !freeAfter.rewardOpened, '自由模式打开了长关宝箱');
assert(freeAfter.savedAfter === freeBefore.savedBefore, '自由模式写入了长关存档');
assert(freeAfter.savedLastCourse === 'comet', '自由模式覆盖了已保存的目标关卡');
assert(
  freeAfter.checkpoints.sky === initial.sky &&
  freeAfter.checkpoints.ocean === initial.ocean &&
  freeAfter.checkpoints.comet === initial.comet,
  '自由模式覆盖了长关检查点'
);

await key('KeyT', 't');
await sleep(180);
const afterLoop = await evaluate(`(() => {
  const state = window.__wb.state;
  const saved = JSON.parse(localStorage.getItem('wb-course-progress-v2'));
  return {
    activeCourse: state.activeCourse,
    points: state.score.points,
    checkpoint: state.run.checkpoint?.number,
    timerRunning: state.timer.running,
    timerHidden: document.getElementById('timer').classList.contains('hidden'),
    savedLastCourse: saved.lastCourse,
    checkpoints: {
      sky: saved.courses.sky.checkpointNumber,
      ocean: saved.courses.ocean.checkpointNumber,
      comet: saved.courses.comet.checkpointNumber
    }
  };
})()`);
assert(afterLoop.activeCourse === 'sky', '切换顺序没有回到登天云梯');
assert(afterLoop.points === 4321, '完整切换轮次后积分发生变化');
assert(afterLoop.checkpoint === initial.sky, '没有回到天空关卡检查点');
assert(afterLoop.savedLastCourse === 'sky', '切回天空后没有保存 lastCourse');
assert(!afterLoop.timerRunning && afterLoop.timerHidden, '离开自由模式后训练计时仍在运行');
assert(
  afterLoop.checkpoints.sky === initial.sky &&
  afterLoop.checkpoints.ocean === initial.ocean &&
  afterLoop.checkpoints.comet === initial.comet,
  '完整切换轮次后长关检查点互相覆盖'
);

await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true
});
await sleep(250);
const mobile = await evaluate(`(() => {
  const switchRect = document.getElementById('course-switch').getBoundingClientRect();
  const backRect = document.getElementById('back-btn').getBoundingClientRect();
  return {
    viewport: { width: innerWidth, height: innerHeight },
    switchRect: { left: switchRect.left, right: switchRect.right, top: switchRect.top, bottom: switchRect.bottom },
    backRect: { left: backRect.left, right: backRect.right, top: backRect.top, bottom: backRect.bottom },
    overlap: !(
      switchRect.right <= backRect.left ||
      backRect.right <= switchRect.left ||
      switchRect.bottom <= backRect.top ||
      backRect.bottom <= switchRect.top
    )
  };
})()`);
assert(!mobile.overlap, '移动端切换按钮与返回按钮重叠');
assert(
  mobile.switchRect.left >= 0 && mobile.switchRect.right <= mobile.viewport.width &&
  mobile.backRect.left >= 0 && mobile.backRect.right <= mobile.viewport.width,
  '移动端按钮超出屏幕'
);

if (problems.length) throw new Error(problems.join('\n'));

console.log('switch:', JSON.stringify({
  initial,
  afterButton,
  afterKey,
  afterFree,
  freeSeaTimer,
  freeHeightTimer,
  freeAfter,
  afterLoop,
  mobile
}));
console.log('page problems: none');
ws.close();
setTimeout(() => process.exit(0), 50);
