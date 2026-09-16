import * as THREE from 'three';
import { CHARACTERS } from './config.js';
import { buildBeachScene, HOUSE, WATER_LEVEL, COURSES, terrainHeight } from './scene.js';
import { loadModel, normalizeModel, createInput, Player, CameraRig } from './player.js';
import { initAudio, footstep, jumpSfx, landSfx, doorSfx, goalSfx, rewardSfx, splashSfx, toggleMute } from './sfx.js';

const canvas = document.getElementById('c');
const selectUI = document.getElementById('select-ui');
const hud = document.getElementById('hud');
const hint = document.getElementById('hint');
const lockTip = document.getElementById('lock-tip');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const pixelRatioCap = () => Math.min(window.devicePixelRatio || 1, 1.5);
let renderPixelRatio = Math.max(1, pixelRatioCap());
renderer.setPixelRatio(renderPixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

let qualityElapsed = 0;
let qualityFrames = 0;
let shadowFrame = 0;
let shadowEvery = 2;
function tuneRenderResolution(dt) {
  qualityElapsed += dt;
  qualityFrames++;
  if (qualityElapsed < 1.5) return;

  const fps = qualityFrames / qualityElapsed;
  const cap = Math.max(1, pixelRatioCap());
  let next = renderPixelRatio;
  if (fps < 42) {
    next = Math.max(1, renderPixelRatio - 0.15);
    shadowEvery = fps < 28 ? 4 : 3;
  } else {
    shadowEvery = 2;
    if (fps > 57 && renderPixelRatio < cap) next = Math.min(cap, renderPixelRatio + 0.1);
  }
  qualityElapsed = 0;
  qualityFrames = 0;

  if (Math.abs(next - renderPixelRatio) < 0.04) return;
  renderPixelRatio = next;
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function renderScene(scene, sceneCamera) {
  shadowFrame++;
  renderer.shadowMap.needsUpdate = shadowFrame >= shadowEvery;
  if (renderer.shadowMap.needsUpdate) shadowFrame = 0;
  renderer.render(scene, sceneCamera);
}

// 远裁剪面 3000：天空球半径 1400（要包住潮汐远征 646m 航路，球对面最远点约 2046）
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 3000);

const scorePanel = document.getElementById('score-panel');
const scoreValueEl = document.getElementById('score-value');
const scoreStageEl = document.getElementById('score-stage');
const resetProgressButton = document.getElementById('reset-progress');
const dashStatusEl = document.getElementById('dash-status');
const courseSwitchButton = document.getElementById('course-switch');
const hudSubEl = document.getElementById('hud-sub');
const saveStatusEl = document.getElementById('save-status');
const timerEl = document.getElementById('timer');

const PROGRESS_KEY = 'wb-course-progress-v2';
const LEGACY_PROGRESS_KEY = 'wb-sky-progress-v1';
const SAVE_COURSE_IDS = COURSES.filter((course) => course.platforms.length >= 500).map((course) => course.id);
const MODE_IDS = [...SAVE_COURSE_IDS, 'free'];
const TRAINING_COURSE_IDS = ['sea', 'height'];
const COURSE_BY_ID = new Map(COURSES.map((course) => [course.id, course]));
const COURSE_STARTS = COURSES.map((course) => ({ course, start: course.platforms[0] }));
const STATIC_COURSE_GOAL_IDS = COURSES
  .filter((course) => !SAVE_COURSE_IDS.includes(course.id))
  .map((course) => course.id);
const DASH_MAX = 3;
const FREE_SPAWN = { x: 0, z: 4 };

const WORLD_LIMITS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const course of COURSES) {
    for (const platform of course.platforms) {
      let halfX = platform.half;
      let halfZ = platform.half;
      const motion = platform.motion;
      if (motion?.type === 'orbit') {
        minX = Math.min(minX, motion.cx - motion.radius - halfX);
        maxX = Math.max(maxX, motion.cx + motion.radius + halfX);
        minZ = Math.min(minZ, motion.cz - motion.radius - halfZ);
        maxZ = Math.max(maxZ, motion.cz + motion.radius + halfZ);
        continue;
      }
      if (motion?.type === 'shuttle') {
        halfX += Math.abs(motion.axisX * motion.amplitude);
        halfZ += Math.abs(motion.axisZ * motion.amplitude);
      } else if (motion?.type === 'wave') {
        halfX += Math.abs(motion.amplitudeX);
        halfZ += Math.abs(motion.amplitudeZ);
      }
      minX = Math.min(minX, platform.x - halfX);
      maxX = Math.max(maxX, platform.x + halfX);
      minZ = Math.min(minZ, platform.z - halfZ);
      maxZ = Math.max(maxZ, platform.z + halfZ);
    }
  }
  return {
    xMin: Math.floor(minX - 12),
    xMax: Math.ceil(maxX + 12),
    zMin: Math.floor(minZ - 12),
    zMax: Math.ceil(maxZ + 12)
  };
})();

function loadProgress() {
  let saved = null;
  let legacy = null;
  try {
    saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    legacy = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY));
  } catch (_) {}

  const courses = {};
  for (const id of SAVE_COURSE_IDS) {
    const source = saved?.courses?.[id] || (id === 'sky' ? legacy : null) || {};
    courses[id] = {
      collected: new Set(Array.isArray(source.collected) ? source.collected.filter((item) => typeof item === 'string') : []),
      highestStage: Math.max(0, Number(source.highestStage) || 0),
      checkpointNumber: Math.max(0, Number(source.checkpointNumber) || 0),
      dashCharges: Math.min(DASH_MAX, Math.max(0, Number(source.dashCharges ?? DASH_MAX) || 0)),
      savedAt: Math.max(0, Number(source.savedAt) || 0)
    };
  }

  const lastCourse = SAVE_COURSE_IDS.includes(saved?.lastCourse) ? saved.lastCourse : 'sky';
  return {
    points: Math.max(0, Number(saved?.points ?? legacy?.points) || 0),
    courses,
    lastCourse
  };
}

const savedProgress = loadProgress();

const state = {
  mode: 'loading',
  time: 0,
  selectScene: null,
  templates: [],
  selected: 0,
  beach: null,
  player: null,
  rig: new CameraRig(camera),
  selectOrbit: 0,
  score: savedProgress,
  activeCourse: savedProgress.lastCourse,
  timer: {
    running: false,
    start: 0,
    course: null,
    elapsed: 0,
    platform: null
  },
  run: {
    currentCourse: null,
    onStart: Object.fromEntries(COURSES.map((c) => [c.id, false])),
    checkpoint: null,
    checkpoints: Object.fromEntries(SAVE_COURSE_IDS.map((id) => [id, null]))
  }
};

function saveProgress() {
  try {
    const courses = {};
    for (const id of SAVE_COURSE_IDS) {
      const progress = state.score.courses[id];
      const checkpoint = state.run.checkpoints[id];
      courses[id] = {
        collected: [...progress.collected],
        highestStage: progress.highestStage,
        checkpointNumber: checkpoint?.number || progress.checkpointNumber || 0,
        checkpointStage: checkpoint?.stage || progress.highestStage || 0,
        checkpointTop: checkpoint?.top || 0,
        dashCharges: progress.dashCharges,
        savedAt: Date.now()
      };
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      points: state.score.points,
      courses,
      lastCourse: SAVE_COURSE_IDS.includes(state.activeCourse)
        ? state.activeCourse
        : (SAVE_COURSE_IDS.includes(state.score.lastCourse) ? state.score.lastCourse : 'sky')
    }));
  } catch (_) {}
}

let scoreBumpTimer = 0;
function updateScoreUI(bump = false) {
  scoreValueEl.textContent = state.score.points.toLocaleString('zh-CN');
  if (state.activeCourse === 'free') {
    scoreStageEl.textContent = '自由训练 · 深海 / 环屋计时可用';
    dashStatusEl.classList.add('hidden');
    saveStatusEl.textContent = '自由模式不写入三个长关存档';
    if (!bump) return;
    scorePanel.classList.remove('bump');
    void scorePanel.offsetWidth;
    scorePanel.classList.add('bump');
    clearTimeout(scoreBumpTimer);
    scoreBumpTimer = setTimeout(() => scorePanel.classList.remove('bump'), 360);
    return;
  }

  const course = COURSE_BY_ID.get(state.activeCourse);
  const progress = state.score.courses[state.activeCourse];
  const prefix = state.activeCourse === 'ocean'
    ? '潮汐阶段'
    : state.activeCourse === 'comet'
      ? '星轨阶段'
      : '登天阶段';
  scoreStageEl.textContent = prefix + ' ' + progress.highestStage + ' / 20';
  const isComet = state.activeCourse === 'comet';
  dashStatusEl.classList.toggle('hidden', !isComet);
  dashStatusEl.textContent = '星跃充能 ' + progress.dashCharges + ' / ' + DASH_MAX;
  const checkpoint = state.run.checkpoints[state.activeCourse];
  if (!checkpoint || checkpoint.number === 1) {
    saveStatusEl.textContent = (course?.name || '关卡') + '存档：起点';
  } else {
    saveStatusEl.textContent =
      (course?.name || '关卡') + '存档：第 ' + checkpoint.stage + ' 段 · ' + Math.round(checkpoint.top) + 'm';
  }
  if (!bump) return;
  scorePanel.classList.remove('bump');
  void scorePanel.offsetWidth;
  scorePanel.classList.add('bump');
  clearTimeout(scoreBumpTimer);
  scoreBumpTimer = setTimeout(() => scorePanel.classList.remove('bump'), 360);
}

function updateCourseSwitchButton() {
  const currentIndex = Math.max(0, MODE_IDS.indexOf(state.activeCourse));
  const nextId = MODE_IDS[(currentIndex + 1) % MODE_IDS.length];
  const nextCourse = COURSE_BY_ID.get(nextId);
  const nextName = nextId === 'free' ? '自由模式' : (nextCourse?.name || '下一关');
  courseSwitchButton.textContent = '切换：' + nextName;
  courseSwitchButton.title = '切换到' + nextName + '（T）';
}

function showHint(message, duration = 3200) {
  hint.textContent = message;
  hint.classList.remove('hidden');
  hint._showing = true;
  hint._suppressUntil = performance.now() + duration;
  clearTimeout(hint._t);
  hint._t = setTimeout(() => hint.classList.add('hidden'), duration);
}

function stopTrainingTimer() {
  const wasRunning = state.timer.running;
  const elapsed = wasRunning
    ? Math.max(0, (performance.now() - state.timer.start) / 1000)
    : state.timer.elapsed;
  state.timer.running = false;
  state.timer.course = null;
  state.timer.elapsed = elapsed;
  state.timer.platform = null;
  timerEl.classList.add('hidden');
  return wasRunning ? elapsed : null;
}

function startTrainingTimer(courseId) {
  if (!TRAINING_COURSE_IDS.includes(courseId)) return;
  state.timer.running = true;
  state.timer.course = courseId;
  state.timer.start = performance.now();
  state.timer.elapsed = 0;
  state.timer.platform = state.player?.supportPlatform?.courseId === courseId
    ? state.player.supportPlatform
    : null;
  timerEl.textContent = '0.00 秒';
  timerEl.classList.remove('hidden');
}

function updateTrainingTimer() {
  if (!state.timer.running) return;
  const player = state.player;
  if (!player) return;
  const courseId = state.timer.course;
  const support = player.supportPlatform;
  if (support?.courseId === courseId) {
    // 仍然站在本轮训练关的台面上：继续计时
    state.timer.platform = support;
  } else if (courseId === 'sea' && player.pos.y <= WATER_LEVEL + 0.04) {
    // 落水：回到远征起点并把本轮计时清零重启。此前这里只是停表 + 强制
    // onStart 标记，导致回到起点台后计时再也起不来（看起来像“无缘无故停了”）。
    respawnAtSeaStart();
    showHint('落水，「' + (COURSE_BY_ID.get(courseId)?.name || '训练关卡') + '」计时已重置', 2200);
    return;
  } else if (player.onGround && player.vy >= -0.01) {
    // 只有“真正站住了”却不在本关台面上才算离开路线（着地时 vy 会被清零，
    // 走下台沿/下落中 vy < 0）。旧实现只看 onGround，而 player.js 走过台沿
    // 时 onGround 不会立刻清零，于是刚起跳/刚下台阶就会被误判成“离开台阶”。
    const elapsed = stopTrainingTimer();
    const course = COURSE_BY_ID.get(courseId);
    if (elapsed != null) {
      const landedOnTerrain =
        player.onGround &&
        Math.abs(player.pos.y - terrainHeight(player.pos.x, player.pos.z)) < 0.15;
      showHint(
        courseId === 'height' && landedOnTerrain
          ? '落回地面，本次环屋计时已取消'
          : '已离开「' + (course?.name || '训练关卡') + '」台阶 · 用时 ' + elapsed.toFixed(2) + ' 秒',
        2600
      );
    }
    return;
  }
  state.timer.elapsed = Math.max(0, (performance.now() - state.timer.start) / 1000);
  timerEl.textContent = state.timer.elapsed.toFixed(2) + ' 秒';
}

function finishTrainingCourse(courseId) {
  if (!state.timer.running || state.timer.course !== courseId) return null;
  const elapsed = stopTrainingTimer();
  const course = COURSE_BY_ID.get(courseId);
  if (elapsed != null) {
    showHint(
      '「' + (course?.name || '训练关卡') + '」训练完成 · 用时 ' +
      elapsed.toFixed(2) + ' 秒',
      4600
    );
  }
  return elapsed;
}

const input = createInput(canvas);

// 指针锁定提示：未锁定时显示"点击锁定视角"，锁定后隐藏
input.onLockChange = (locked) => {
  if (state.mode !== 'explore') return;
  lockTip.classList.toggle('hidden', locked);
};

/* ---------------- 选角场景（暗色影棚，两位角色按真实身高同屏） ---------------- */

function buildSelectScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1016);
  scene.fog = new THREE.Fog(0x0d1016, 14, 34);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(5.7, 6.0, 0.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.62, metalness: 0.12 })
  );
  platform.position.y = -0.25;
  platform.receiveShadow = true;
  scene.add(platform);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.75, 0.035, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0xf0b848 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  const key = new THREE.DirectionalLight(0xfff6e8, 3.4);
  key.position.set(4.5, 7.5, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.001;
  scene.add(key);

  const rimL = new THREE.DirectionalLight(new THREE.Color(CHARACTERS[0].accent), 1.7);
  rimL.position.set(-7, 3.4, -5.5);
  scene.add(rimL);

  const rimR = new THREE.DirectionalLight(new THREE.Color(CHARACTERS[1].accent), 1.5);
  rimR.position.set(7, 3.0, -6);
  scene.add(rimR);

  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x14161c, 0.8));

  const models = [];
  CHARACTERS.forEach((c, i) => {
    const m = state.templates[i].clone(true);
    normalizeModel(m, c.height);
    m.rotation.y = c.modelYaw;
    m.position.x += i === 0 ? -1.35 : 1.35;
    scene.add(m);
    models.push(m);
  });

  return scene;
}

/* ---------------- 进出场景 ---------------- */

function enterExplore(index) {
  if (!state.beach) {
    const collectedByCourse = Object.fromEntries(
      SAVE_COURSE_IDS.map((id) => [id, state.score.courses[id].collected])
    );
    const highestStages = Object.fromEntries(
      SAVE_COURSE_IDS.map((id) => [id, state.score.courses[id].highestStage])
    );
    state.beach = buildBeachScene({ collectedRewardIds: collectedByCourse, highestStages });
  }
  const scene = state.beach.scene;

  if (state.player) scene.remove(state.player.group);

  const c = CHARACTERS[index];
  const model = state.templates[index].clone(true);
  normalizeModel(model, c.height);
  model.rotation.y = c.modelYaw;

  state.player = new Player(model, c.height);
  state.player.limits = { ...WORLD_LIMITS };
  scene.add(state.player.group);

  state.selected = index;
  state.rig.yaw = 0;
  state.rig.pitch = 0.35;
  state.rig.dist = 6.0;
  state.rig.initialized = false;

  document.getElementById('hud-name').textContent = c.name;
  state.run.currentCourse = null;
  for (const id in state.run.onStart) state.run.onStart[id] = false;
  stopTrainingTimer();

  for (const id of SAVE_COURSE_IDS) {
    const course = COURSE_BY_ID.get(id);
    const progress = state.score.courses[id];
    const collectedRewards = state.beach.rewards
      .filter((reward) => reward.courseId === id && reward.opened)
      .sort((a, b) => b.stage - a.stage);
    const restoredCheckpoint = progress.checkpointNumber > 1
      ? course.platforms.find((platform) => platform.number === progress.checkpointNumber)
      : null;
    const checkpoint = collectedRewards[0]?.platform || restoredCheckpoint || course.platforms[0];
    state.run.checkpoints[id] = checkpoint;
    progress.checkpointNumber = checkpoint.number;
    if (id === 'comet' && checkpoint.number > 1) progress.dashCharges = DASH_MAX;
  }
  if (!SAVE_COURSE_IDS.includes(state.activeCourse)) state.activeCourse = 'sky';
  state.score.lastCourse = state.activeCourse;
  state.run.checkpoint = state.run.checkpoints[state.activeCourse];
  const activeDefinition = COURSE_BY_ID.get(state.activeCourse);
  hudSubEl.textContent = activeDefinition.name + ' · 500 阶';
  state.beach.setViewMode(state.activeCourse);
  saveProgress();
  updateScoreUI(false);
  updateCourseSwitchButton();

  input.lockEnabled = true; // 进入场景后才允许指针锁定（选角页保持鼠标可见）

  state.mode = 'explore';
  selectUI.classList.add('hidden');
  hud.classList.remove('hidden');
  lockTip.classList.remove('hidden');
}

/* ---------------- 门口交互与音效接线 ---------------- */

function nearDoor() {
  if (!state.player || !state.beach) return false;
  const p = state.player.pos;
  return Math.hypot(p.x - HOUSE.doorX, p.z - HOUSE.doorZ) < 2.9;
}

window.addEventListener('gamepadconnected', (e) => {
  const g = e.gamepad;
  console.log('[手柄] 已连接:', g.id, '| mapping:', g.mapping, '| 轴:', g.axes.length, '| 键:', g.buttons.length,
    '| 标准布局:', g.mapping === 'standard');
  if (state.mode !== 'explore') return;
  hint.textContent = '手柄已连接：左摇杆移动 · A 跳 · LT/L1 加速 · 右摇杆视角';
  hint.classList.remove('hidden');
  clearTimeout(hint._t);
  hint._t = setTimeout(() => hint.classList.add('hidden'), 3200);
});

window.addEventListener('keydown', (e) => {
  if (state.mode !== 'explore') return;
  if (e.code === 'KeyE') {
    if (nearDoor()) {
      const door = state.beach.door;
      door.open = !door.open;
      const list = state.beach.colliders;
      if (door.open) {
        const i = list.indexOf(state.beach.doorwayCollider);
        if (i >= 0) list.splice(i, 1);
      } else if (!list.includes(state.beach.doorwayCollider)) {
        list.push(state.beach.doorwayCollider);
      }
      doorSfx(door.open);
    }
  } else if (e.code === 'KeyR') {
    if (state.activeCourse === 'free') {
      respawnAtFreeStart('已返回自由训练起点');
      return;
    }
    const courseId = SAVE_COURSE_IDS.includes(state.run.currentCourse) ? state.run.currentCourse : state.activeCourse;
    const checkpoint = state.run.checkpoints[courseId];
    const course = COURSE_BY_ID.get(courseId);
    if (!checkpoint || !course) return;
    const start = course.platforms[0];
    const nearStart = Math.hypot(state.player.pos.x - start.x, state.player.pos.z - start.z) < 8;
    const nearCheckpoint = checkpoint && Math.hypot(
      state.player.pos.x - checkpoint.x,
      state.player.pos.z - checkpoint.z
    ) < 10;
    if (checkpoint && (state.run.currentCourse === courseId || nearStart || nearCheckpoint)) {
      respawnAtCheckpoint(courseId);
    } else {
      showHint('前往对应长关起点后按 R 载入存档', 2200);
    }
  } else if (e.code === 'KeyT') {
    switchCourse();
  } else if (e.code === 'KeyM') {
    const muted = toggleMute();
    hint.textContent = muted ? '已静音（按 M 恢复）' : '声音已开启';
    hint._suppressUntil = performance.now() + 1600;
    hint.classList.remove('hidden');
    clearTimeout(hint._t);
    hint._t = setTimeout(() => {
      if (!nearDoor()) hint.classList.add('hidden');
    }, 1600);
  }
});

function backToSelect() {
  stopTrainingTimer();
  state.mode = 'select';
  input.lockEnabled = false; // 选角页恢复鼠标
  hud.classList.add('hidden');
  lockTip.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  selectUI.classList.remove('hidden');
}

function resetAllProgress() {
  stopTrainingTimer();
  try {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
  } catch (_) {}

  state.score.points = 0;
  for (const id of SAVE_COURSE_IDS) {
    state.score.courses[id] = {
      collected: new Set(),
      highestStage: 0,
      checkpointNumber: 0,
      dashCharges: DASH_MAX,
      savedAt: 0
    };
    state.run.checkpoints[id] = null;
  }
  state.activeCourse = 'sky';
  state.score.lastCourse = 'sky';
  state.run.currentCourse = null;
  state.run.checkpoint = null;
  for (const id in state.run.onStart) state.run.onStart[id] = false;

  if (state.mode === 'explore') {
    const selected = state.selected;
    state.beach = null;
    enterExplore(selected);
    showHint('积分、宝箱和长关检查点已全部刷新', 2600);
  } else {
    updateScoreUI(false);
  }
  updateCourseSwitchButton();
}

/* ---------------- 事件 ---------------- */

document.querySelectorAll('.card').forEach((el) => {
  el.addEventListener('click', () => {
    initAudio(); // 首次用户手势解锁音频
    enterExplore(Number(el.dataset.char));
  });
});
document.getElementById('back-btn').addEventListener('click', backToSelect);
courseSwitchButton.addEventListener('click', (event) => {
  event.stopPropagation();
  switchCourse();
});
resetProgressButton.addEventListener('click', (event) => {
  event.stopPropagation();
  resetAllProgress();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderPixelRatio = Math.min(renderPixelRatio, Math.max(1, pixelRatioCap()));
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function switchCourse() {
  if (state.mode !== 'explore' || !state.player) return;
  const currentIndex = Math.max(0, MODE_IDS.indexOf(state.activeCourse));
  const nextId = MODE_IDS[(currentIndex + 1) % MODE_IDS.length];
  if (nextId === 'free') {
    enterFreeMode();
    return;
  }
  const nextCourse = COURSE_BY_ID.get(nextId);

  respawnAtCheckpoint(
    nextId,
    '已切换至' + nextCourse.name
  );
}

function enterFreeMode(hintMessage = null) {
  if (state.mode !== 'explore' || !state.player) return;
  stopTrainingTimer();
  state.activeCourse = 'free';
  state.run.currentCourse = null;
  state.run.checkpoint = null;
  for (const id in state.run.onStart) state.run.onStart[id] = false;
  state.beach.setViewMode('free');
  respawnAtFreeStart(hintMessage || '已切换至自由模式 · 三个长关已隐藏');
}

function respawnAtFreeStart(hintMessage = null) {
  if (state.mode !== 'explore' || !state.player) return;
  stopTrainingTimer();
  const y = terrainHeight(FREE_SPAWN.x, FREE_SPAWN.z) + 0.04;
  state.player.respawn({ x: FREE_SPAWN.x, y, z: FREE_SPAWN.z });
  state.player.group.position.copy(state.player.pos);
  state.rig.initialized = false;
  if (state.activeCourse === 'free') {
    state.run.currentCourse = null;
    state.run.checkpoint = null;
    hudSubEl.textContent = '自由模式 · 可自由训练';
    state.beach.setViewMode('free');
    updateScoreUI(false);
    updateCourseSwitchButton();
  }
  showHint(hintMessage || '已返回自由训练起点', 2200);
}

function respawnAtCheckpoint(courseId = state.activeCourse, hintMessage = null) {
  stopTrainingTimer();
  if (!SAVE_COURSE_IDS.includes(courseId)) return;
  const checkpoint = state.run.checkpoints[courseId];
  if (!state.player || !checkpoint) return;
  const course = COURSE_BY_ID.get(courseId);
  state.activeCourse = courseId;
  state.score.lastCourse = courseId;
  state.run.currentCourse = courseId;
  state.run.checkpoint = checkpoint;
  state.beach.setViewMode(courseId);
  if (courseId === 'comet') {
    state.score.courses.comet.dashCharges = DASH_MAX;
  }
  const terrainTop = terrainHeight(checkpoint.x, checkpoint.z);
  state.player.respawn({
    x: checkpoint.x,
    y: Math.max(checkpoint.top, terrainTop) + 0.06,
    z: checkpoint.z
  });
  state.player.group.position.copy(state.player.pos);
  state.rig.initialized = false;
  hudSubEl.textContent = course.name + ' · 500 阶';
  saveProgress();
  updateScoreUI(false);
  updateCourseSwitchButton();
  const refillText = courseId === 'comet' ? ' · 星跃充能已补满' : '';
  showHint(
    hintMessage
      ? hintMessage + refillText
      : '已载入' + course.name + '存档 · 第 ' + checkpoint.stage + ' 段' + refillText,
    2200
  );
}

function respawnAtSeaStart() {
  // 落水/重置：若本轮深海计时正在跑，回到起点台后立即从 0 重新计时，
  // 而不是把表停死（旧实现强制 onStart.sea = true，导致起点检测再也不触发）。
  const restartTiming = state.timer.running && state.timer.course === 'sea';
  const sea = COURSE_BY_ID.get('sea');
  const start = sea.platforms[0];
  state.player.respawn({ x: start.x, y: start.top + 0.02, z: start.z });
  state.player.group.position.copy(state.player.pos);
  state.rig.initialized = false;
  state.run.currentCourse = 'sea';
  state.run.onStart.sea = true;
  state.beach.spawnRipple(start.x, start.z);
  splashSfx();
  if (restartTiming) {
    startTrainingTimer('sea');
    state.timer.platform = start; // 立刻以起点台作为“是否离开路线”的比较基准
  }
}

function collectReward(reward) {
  if (!reward || !SAVE_COURSE_IDS.includes(reward.courseId) || state.activeCourse === 'free') return;
  const opened = state.beach.openReward(reward.id);
  if (!opened) return;

  const progress = state.score.courses[opened.courseId];
  state.score.points += opened.points;
  progress.collected.add(opened.id);
  progress.highestStage = Math.max(progress.highestStage, opened.stage);
  progress.checkpointNumber = opened.platform.number;
  if (opened.courseId === 'comet') progress.dashCharges = DASH_MAX;
  state.run.checkpoints[opened.courseId] = opened.platform;
  state.run.currentCourse = opened.courseId;
  state.run.checkpoint = opened.platform;
  state.activeCourse = opened.courseId;
  state.score.lastCourse = opened.courseId;
  state.beach.setViewMode(opened.courseId);
  state.beach.setCourseStage(opened.courseId, opened.stage);
  hudSubEl.textContent = COURSE_BY_ID.get(opened.courseId).name + ' · 500 阶';
  saveProgress();
  updateScoreUI(true);
  updateCourseSwitchButton();

  if (opened.final) {
    const course = COURSE_BY_ID.get(opened.courseId);
    const goal = state.beach.goals[opened.courseId];
    if (goal) goal.opened = true;
    state.beach.courseVisual(opened.courseId).spawnConfetti();
    rewardSfx(true);
    goalSfx();
    const finishText = opened.courseId === 'ocean'
      ? '抵达深海之眼！'
      : opened.courseId === 'comet'
        ? '抵达光年彼岸！'
        : '登顶成功！';
    const message = finishText + ' 终极大奖已开启 · +' + opened.points.toLocaleString('zh-CN') + ' 积分';
    showHint(message, 5600);
    return;
  }

  rewardSfx(false);
  showHint(
    '第 ' + opened.stage + ' 段 · ' + opened.stageName + ' 宝箱 + ' +
    opened.points.toLocaleString('zh-CN') + ' 积分 · 检查点已记录',
    3800
  );
}

/* ---------------- 主循环 ---------------- */

let last = performance.now();
let lastDashEmptyAt = 0;
const playerWorld = {
  colliders: [],
  dashCharges: 0,
  spawnRipple(x, z) {
    state.beach?.spawnRipple(x, z);
  },
  onFootstep(inWater) {
    footstep(inWater);
    if (!inWater && state.player && state.beach?.spawnDust) {
      state.beach.spawnDust(state.player.pos.x, state.player.pos.z);
    }
  },
  onJump: jumpSfx,
  onLand: landSfx,
  consumeDash() {
    const progress = state.score.courses.comet;
    progress.dashCharges = Math.max(0, progress.dashCharges - 1);
    saveProgress();
    updateScoreUI(true);
  },
  onDash(remaining) {
    if (remaining === 0) showHint('最后一格星跃已使用 · 落脚充能台可补满', 1900);
  },
  onDashEmpty() {
    if (performance.now() - lastDashEmptyAt < 800) return;
    lastDashEmptyAt = performance.now();
    showHint('星跃充能已耗尽 · 踩上发光充能台或打开阶段宝箱', 1900);
  }
};

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;
  state.time += dt;
  tuneRenderResolution(rawDt);

  if (state.mode === 'select' && state.selectScene) {
    state.selectOrbit = Math.sin(state.time * 0.17) * 0.62;
    const r = 6.5;
    camera.position.set(Math.sin(state.selectOrbit) * r, 2.15, Math.cos(state.selectOrbit) * r);
    camera.lookAt(0, 1.12, 0);
    renderScene(state.selectScene, camera);
  } else if (state.mode === 'explore' && state.beach) {
    input.updateGamepad(dt); // 手柄轮询（先于 consume，摇杆视角增量并入本次拖拽）
    const drag = input.consume();
    const cometProgress = state.score.courses.comet;
    playerWorld.colliders = state.beach.colliders;
    playerWorld.dashCharges = state.activeCourse === 'comet' ? cometProgress.dashCharges : 0;
    state.player.update(dt, input, state.rig.yaw, playerWorld);
    state.beach.update(state.time, dt, state.player);
    state.rig.update(dt, state.player.pos, state.player.height, drag, state.beach.occluders);
    updateTrainingTimer();

    // 星跃充能台：落到发光圆台即补满，不要求先耗尽。
    if (state.activeCourse === 'comet' && state.player.onGround && cometProgress.dashCharges < DASH_MAX) {
      const pad = state.player.supportPlatform;
      if (pad?.dashPad) {
        cometProgress.dashCharges = DASH_MAX;
        saveProgress();
        updateScoreUI(true);
        showHint('星跃充能已补满 · 3 / 3', 1500);
      }
    }

    // 关卡起跑检测：记录玩家当前进入的路线，用于独立的落水与坠落救援。
    const tp = state.player.pos;
    for (const { course: c, start: s } of COURSE_STARTS) {
      const isLongCourse = SAVE_COURSE_IDS.includes(c.id);
      // 训练关起点必须“真正踩在起点台面上”才算进入：
      // 旧实现只看几何范围（水平 ±(half+0.05)、高度 ±0.25），玩家站在低矮起点台
      // 旁边的沙地上就会误触发，随后立刻被判成“已离开台阶”，计时刚亮就灭且无法再启动。
      const on = isLongCourse
        ? Math.abs(tp.x - s.x) < s.half + 0.05 && Math.abs(tp.z - s.z) < s.half + 0.05 && Math.abs(tp.y - s.top) < 0.25
        : state.player.supportPlatform === s;
      if (on && !state.run.onStart[c.id]) {
        if (isLongCourse) {
          if (state.activeCourse !== 'free') {
            // 自由模式隐藏长关；即使测试直接移动玩家，也不得改动长关状态。
            stopTrainingTimer();
            state.run.currentCourse = c.id;
            state.activeCourse = c.id;
            state.score.lastCourse = c.id;
            state.run.checkpoint = state.run.checkpoints[c.id] || s;
            state.beach.setViewMode(c.id);
            hudSubEl.textContent = c.name + ' · 500 阶';
            updateScoreUI(false);
            updateCourseSwitchButton();
          }
        } else {
          state.run.currentCourse = c.id;
          startTrainingTimer(c.id);
        }
      }
      state.run.onStart[c.id] = on;
    }

    // 落水与坠落救援按当前路线分流；第一关和海洋关互不复用。
    const runCourse = state.run.currentCourse;
    if (runCourse === 'ocean' && tp.y < WATER_LEVEL + 0.02) {
      splashSfx();
      respawnAtCheckpoint('ocean');
    } else if (runCourse === 'comet' && tp.y < WATER_LEVEL + 0.02) {
      splashSfx();
      respawnAtCheckpoint('comet');
    } else if (runCourse === 'sea' && tp.y < WATER_LEVEL - 0.05 && tp.z < -3.2) {
      // 计时是否归零重启由 respawnAtSeaStart 内部按“本轮是否在计时”决定
      respawnAtSeaStart();
      showHint('落水，本次深海训练已重置', 2200);
    } else if (
      runCourse === 'height' &&
      state.player.onGround &&
      Math.abs(tp.y - terrainHeight(tp.x, tp.z)) < 0.15
    ) {
      const elapsed = stopTrainingTimer();
      if (elapsed != null) showHint('落回地面，本次环屋计时已取消', 2400);
    } else if (
      runCourse &&
      state.player.onGround &&
      Math.abs(tp.y - terrainHeight(tp.x, tp.z)) < 0.15
    ) {
      if (SAVE_COURSE_IDS.includes(runCourse)) {
        respawnAtCheckpoint(runCourse);
      }
    }
    if ((runCourse === 'sky' || runCourse === 'comet') && state.run.checkpoint) {
      const fallFloor = Math.max(1.0, state.run.checkpoint.top - 14);
      if (tp.y < fallFloor) respawnAtCheckpoint(runCourse);
    }

    // 门口提示
    const near = nearDoor();
    const suppressed = hint._suppressUntil && performance.now() < hint._suppressUntil;
    if (near && !suppressed) {
      const want = state.beach.door.open ? '按 E 关门' : '按 E 开门';
      if (hint.textContent !== want) hint.textContent = want;
      hint.classList.remove('hidden');
      hint._showing = true;
    } else if (!suppressed && hint._showing) {
      hint._showing = false;
      hint.classList.add('hidden');
    }

    // 阶段宝箱：每 25 台一个，打开即加分并更新对应关卡存档
    const activeRewards = state.beach.courseVisual(state.activeCourse)?.rewards;
    if (activeRewards) {
      for (const reward of activeRewards) {
        if (reward.opened) continue;
        const p = reward.platform;
        if (
          Math.hypot(tp.x - p.x, tp.z - p.z) < p.half * 0.76 + 0.24 &&
          Math.abs(tp.y - p.top) < 0.9
        ) {
          collectReward(reward);
          break;
        }
      }
    }

    // 关卡终点：长关只给完成反馈，sea / height 训练关显示本次用时。
    const goalIds = SAVE_COURSE_IDS.includes(state.activeCourse)
      ? [state.activeCourse, ...STATIC_COURSE_GOAL_IDS]
      : STATIC_COURSE_GOAL_IDS;
    for (const courseId of goalIds) {
      const goal = state.beach.goals[courseId];
      if (!goal) continue;
      const p = state.player.pos;
      const goalDistance = Math.hypot(p.x - goal.x, p.z - goal.z);
      if (TRAINING_COURSE_IDS.includes(courseId) && goal.opened && goalDistance > goal.half + 1.5) {
        // 训练关可以反复挑战：离开终点后重新武装，否则第二次跑完全程不会结算用时
        goal.opened = false;
      }
      if (goal.opened) continue;
      if (goalDistance < goal.half * 0.75 + 0.2 && Math.abs(p.y - goal.y) < 1.0) {
        goal.opened = true;
        state.beach.courseVisual(courseId).spawnConfetti();
        goalSfx();
        const course = COURSE_BY_ID.get(courseId);
        if (TRAINING_COURSE_IDS.includes(courseId)) {
          finishTrainingCourse(courseId);
        } else {
          showHint('「' + course.name + '」终极大奖已开启！', 4200);
        }
      }
    }

    renderScene(state.beach.scene, camera);
  }
}

/* ---------------- 启动 ---------------- */

async function boot() {
  try {
    loadingText.textContent = '正在加载角色模型…';
    const loaded = await Promise.all(CHARACTERS.map((c) => loadModel(c.model)));
    state.templates = loaded;

    loadingText.textContent = '正在搭建场景…';
    state.selectScene = buildSelectScene();

    loading.classList.add('hidden');
    state.mode = 'select';
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    loadingText.textContent = '加载失败：' + (err && err.message ? err.message : err);
  }
}

boot();

// 测试钩子（CDP 端到端验证用）
window.__wb = { state, enterExplore, camera, renderer };
