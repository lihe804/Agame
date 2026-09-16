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

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 900);

const scorePanel = document.getElementById('score-panel');
const scoreValueEl = document.getElementById('score-value');
const scoreStageEl = document.getElementById('score-stage');
const resetProgressButton = document.getElementById('reset-progress');
const dashStatusEl = document.getElementById('dash-status');
const courseSwitchButton = document.getElementById('course-switch');
const hudSubEl = document.getElementById('hud-sub');
const saveStatusEl = document.getElementById('save-status');

const PROGRESS_KEY = 'wb-course-progress-v2';
const LEGACY_PROGRESS_KEY = 'wb-sky-progress-v1';
const SAVE_COURSE_IDS = COURSES.filter((course) => course.platforms.length >= 500).map((course) => course.id);
const COURSE_BY_ID = new Map(COURSES.map((course) => [course.id, course]));
const COURSE_STARTS = COURSES.map((course) => ({ course, start: course.platforms[0] }));
const STATIC_COURSE_GOAL_IDS = COURSES
  .filter((course) => !SAVE_COURSE_IDS.includes(course.id))
  .map((course) => course.id);
const DASH_MAX = 3;

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
      lastCourse: state.activeCourse
    }));
  } catch (_) {}
}

let scoreBumpTimer = 0;
function updateScoreUI(bump = false) {
  const course = COURSE_BY_ID.get(state.activeCourse);
  const progress = state.score.courses[state.activeCourse];
  scoreValueEl.textContent = state.score.points.toLocaleString('zh-CN');
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
  const currentIndex = Math.max(0, SAVE_COURSE_IDS.indexOf(state.activeCourse));
  const nextId = SAVE_COURSE_IDS[(currentIndex + 1) % SAVE_COURSE_IDS.length];
  const nextCourse = COURSE_BY_ID.get(nextId);
  courseSwitchButton.textContent = '切换：' + (nextCourse?.name || '下一关');
  courseSwitchButton.title = '切换到' + (nextCourse?.name || '下一关') + '（T）';
}

function showHint(message, duration = 3200) {
  hint.textContent = message;
  hint.classList.remove('hidden');
  hint._showing = true;
  hint._suppressUntil = performance.now() + duration;
  clearTimeout(hint._t);
  hint._t = setTimeout(() => hint.classList.add('hidden'), duration);
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
  scene.add(state.player.group);

  state.selected = index;
  state.rig.yaw = 0;
  state.rig.pitch = 0.35;
  state.rig.dist = 6.0;
  state.rig.initialized = false;

  document.getElementById('hud-name').textContent = c.name;
  state.run.currentCourse = null;
  for (const id in state.run.onStart) state.run.onStart[id] = false;

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
    const courseId = SAVE_COURSE_IDS.includes(state.run.currentCourse) ? state.run.currentCourse : state.activeCourse;
    const checkpoint = state.run.checkpoints[courseId];
    const course = COURSE_BY_ID.get(courseId);
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
  state.mode = 'select';
  input.lockEnabled = false; // 选角页恢复鼠标
  hud.classList.add('hidden');
  lockTip.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  selectUI.classList.remove('hidden');
}

function resetAllProgress() {
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
  const currentIndex = Math.max(0, SAVE_COURSE_IDS.indexOf(state.activeCourse));
  const nextId = SAVE_COURSE_IDS[(currentIndex + 1) % SAVE_COURSE_IDS.length];
  const nextCourse = COURSE_BY_ID.get(nextId);

  respawnAtCheckpoint(
    nextId,
    '已切换至' + nextCourse.name
  );
}

function respawnAtCheckpoint(courseId = state.activeCourse, hintMessage = null) {
  const checkpoint = state.run.checkpoints[courseId];
  if (!state.player || !checkpoint) return;
  const course = COURSE_BY_ID.get(courseId);
  state.activeCourse = courseId;
  state.run.currentCourse = courseId;
  state.run.checkpoint = checkpoint;
  state.beach.setViewMode(courseId);
  if (courseId === 'comet') {
    state.score.courses.comet.dashCharges = DASH_MAX;
  }
  state.player.respawn({ x: checkpoint.x, y: checkpoint.top + 0.04, z: checkpoint.z });
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
  const sea = COURSE_BY_ID.get('sea');
  const start = sea.platforms[0];
  state.player.respawn({ x: start.x, y: start.top, z: start.z });
  state.player.group.position.copy(state.player.pos);
  state.rig.initialized = false;
  state.beach.spawnRipple(start.x, start.z);
  splashSfx();
}

function collectReward(reward) {
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
    const message = finishText + ' + ' + opened.points.toLocaleString('zh-CN') + ' 积分';
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
      const on = Math.abs(tp.x - s.x) < s.half + 0.05 && Math.abs(tp.z - s.z) < s.half + 0.05 && Math.abs(tp.y - s.top) < 0.25;
      if (on && !state.run.onStart[c.id]) {
        state.run.currentCourse = c.id;
        if (SAVE_COURSE_IDS.includes(c.id)) {
          state.activeCourse = c.id;
          state.run.checkpoint = state.run.checkpoints[c.id] || s;
          state.beach.setViewMode(c.id);
          hudSubEl.textContent = c.name + ' · 500 阶';
          updateScoreUI(false);
          updateCourseSwitchButton();
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
      respawnAtSeaStart();
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

    // 关卡终点（注册表驱动）：靠近宝箱后开箱并播放完成反馈。
    const goalCount = STATIC_COURSE_GOAL_IDS.length + 1;
    for (let i = 0; i < goalCount; i++) {
      const courseId = i === 0 ? state.activeCourse : STATIC_COURSE_GOAL_IDS[i - 1];
      const goal = state.beach.goals[courseId];
      if (!goal || goal.opened) continue;
      const p = state.player.pos;
      if (Math.hypot(p.x - goal.x, p.z - goal.z) < goal.half * 0.75 + 0.2 && Math.abs(p.y - goal.y) < 1.0) {
        goal.opened = true;
        state.beach.courseVisual(courseId).spawnConfetti();
        goalSfx();
        const course = COURSE_BY_ID.get(courseId);
        showHint('「' + course.name + '」关卡完成！宝箱已开启', 4200);
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
