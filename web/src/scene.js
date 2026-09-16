import * as THREE from 'three';
import { PALETTE } from './config.js';

export const WATER_LEVEL = 0;
export const SHORE_Z = -3;

/* 房子常量（地形、碰撞、门口提示共用）。房屋直接着地、实心不可进入，平屋顶可站立。 */
export const HOUSE = {
  x: 15,
  z: 7,
  half: 3,
  base: 1.5,          // 地基找平后的地面高度
  deckTop: 1.8,       // 地板面高度 = base + 基座 0.3
  roofTop: 5.15,      // 平屋顶面高度 = deckTop + 墙 3.1 + 屋面板 0.25
  doorX: 15,          // 门口世界坐标
  doorZ: 3.7
};

/* ================= 登天云梯生成器 =================
 * 500 个平台分为 20 段，每段 24 个挑战台 + 1 个宝箱检查台。
 * 运动平台使用 x/z/top 的每帧净值更新，player.js 会沿同一注册表做碰撞。 */

const SKY_PLATFORM_TOTAL = 500;
const SKY_REWARD_INTERVAL = 25;
const SKY_HOUSE_CLEAR = {
  minX: 4,
  maxX: 35,
  minZ: -2,
  maxZ: 24
};

function insideSkyHouseClear(x, z) {
  return x > SKY_HOUSE_CLEAR.minX && x < SKY_HOUSE_CLEAR.maxX &&
    z > SKY_HOUSE_CLEAR.minZ && z < SKY_HOUSE_CLEAR.maxZ;
}

function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSkyCourse() {
  const rnd = makeSeededRandom(0x51c0ffee);
  const platforms = [];
  const rotors = [];
  const stageNames = [
    '离岸阶梯', '逆风回旋', '浮动断层', '云端转盘', '折返刃脊',
    '双旋翼', '侧风浮桥', '无栏窄桥', '浮升矩阵', '天幕十字',
    '风暴走廊', '回响环带', '失重阶梯', '银色回廊', '交错齿轮',
    '云海孤岛', '逐风长桥', '风暴眼', '最后百米', '天穹王座'
  ];
  const themeNames = ['dawn', 'ice', 'storm', 'copper', 'aurora'];
  const themes = {
    dawn: { deck: 0x6f8796, trim: 0xf08a5d },
    ice: { deck: 0x6e9db2, trim: 0xc8eff3 },
    storm: { deck: 0x657184, trim: 0xb8c4d9 },
    copper: { deck: 0x8b7764, trim: 0xe1ad63 },
    aurora: { deck: 0x668c86, trim: 0x9ce1c4 }
  };

  const startX = 37.0;
  const startZ = 34.0;
  const pose = {
    x: startX,
    z: startZ,
    top: terrainHeight(startX, startZ) + 0.22,
    heading: -2.35
  };
  let firstPlatform = true;

  const clampPoseToMap = () => {
    if (pose.x < -37) { pose.x = -37; pose.heading = Math.PI - pose.heading; }
    if (pose.x > 37) { pose.x = 37; pose.heading = Math.PI - pose.heading; }
    if (pose.z < -49) { pose.z = -49; pose.heading = -pose.heading; }
    if (pose.z > 35) { pose.z = 35; pose.heading = -pose.heading; }
  };

  const advance = (turn = 0, step = 2.82, rise = 0.43) => {
    pose.heading += turn;
    const desired = pose.heading;
    let chosen = null;
    for (let i = 0; i < 33; i++) {
      const offset = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 16;
      const angle = desired + offset;
      const x = pose.x + Math.cos(angle) * step;
      const z = pose.z + Math.sin(angle) * step;
      const inBounds = x >= -38 && x <= 38 && z >= -50 && z <= 36;
      if (inBounds && !insideSkyHouseClear(x, z)) {
        chosen = { x, z, angle };
        break;
      }
    }
    if (!chosen) {
      const away = Math.atan2(pose.z - HOUSE.z, pose.x - HOUSE.x);
      chosen = {
        x: pose.x + Math.cos(away) * step,
        z: pose.z + Math.sin(away) * step,
        angle: away
      };
    }
    pose.x = chosen.x;
    pose.z = chosen.z;
    pose.heading = chosen.angle;
    pose.top += rise;
  };

  const addPlatform = (stage, x, z, top, extra = {}) => {
    if (insideSkyHouseClear(x, z)) {
      throw new Error(
        '登天云梯侵入房屋禁飞区: #' + (platforms.length + 1) +
        ' stage ' + (stage + 1) + ' @ ' + x.toFixed(2) + ', ' + z.toFixed(2) +
        ' prev ' + (platforms.length ? platforms[platforms.length - 1].x.toFixed(2) + ', ' + platforms[platforms.length - 1].z.toFixed(2) : 'none')
      );
    }
    const number = platforms.length + 1;
    const theme = themeNames[stage % themeNames.length];
    const texture = themes[theme];
    const isReward = number % SKY_REWARD_INTERVAL === 0;
    const stageProgress = stage / (stageNames.length - 1);
    const half = extra.half ?? Math.max(0.44, 0.67 - stageProgress * 0.13 + (rnd() - 0.5) * 0.08);
    const p = {
      id: 'sky-' + number,
      number,
      stage: stage + 1,
      stageName: stageNames[stage],
      theme,
      deckColor: texture.deck,
      trimColor: isReward ? 0xffc94a : texture.trim,
      x,
      z,
      top,
      half: isReward ? 0.98 : half,
      ...extra
    };

    if (isReward) {
      delete p.motion;
      p.reward = {
        id: 'sky-stage-' + (stage + 1),
        stage: stage + 1,
        stageName: stageNames[stage],
        points: 200 + (stage + 1) * 50,
        final: number === SKY_PLATFORM_TOTAL
      };
      p.half = number === SKY_PLATFORM_TOTAL ? 2.8 : 0.98;
      p.isGoal = number === SKY_PLATFORM_TOTAL;
    }

    platforms.push(p);
    return p;
  };

  const place = (stage, extra = {}, step = 2.82, turn = 0, rise = 0.43) => {
    if (!firstPlatform) advance(turn, step, rise);
    firstPlatform = false;
    const resolvedExtra = typeof extra === 'function' ? extra(pose) : extra;
    return addPlatform(stage, pose.x, pose.z, pose.top, resolvedExtra);
  };

  const appendZigzag = (stage, count, strong = false) => {
    for (let i = 0; i < count; i++) {
      const sway = strong ? 0.72 : 0.48;
      const turn = (i % 2 === 0 ? sway : -sway) + Math.sin((stage + i) * 0.7) * 0.12;
      place(stage, {}, strong ? 2.94 : 2.82, turn, 0.4 + rnd() * 0.12);
    }
  };

  const appendHelix = (stage, count, reverse = false) => {
    for (let i = 0; i < count; i++) {
      const turn = (reverse ? -1 : 1) * (0.24 + Math.sin(i * 0.65) * 0.1);
      place(stage, {}, 2.72 + rnd() * 0.14, turn, 0.38 + rnd() * 0.13);
    }
  };

  const appendSwitchback = (stage, count) => {
    for (let i = 0; i < count; i++) {
      const turn = i % 6 === 0 ? (i % 12 === 0 ? 2.2 : -2.2) : Math.sin(i * 0.9) * 0.2;
      place(stage, {}, 2.78 + rnd() * 0.12, turn, 0.39 + rnd() * 0.12);
    }
  };

  const appendNarrow = (stage, count) => {
    for (let i = 0; i < count; i++) {
      const half = i % 5 === 0 ? 0.54 : 0.42 + rnd() * 0.07;
      place(stage, (next) => ({
        half,
        ...(i % 4 === 1
          ? { motion: { type: 'lift', baseTop: next.top, amplitude: 0.07, speed: 1.15 + (i % 3) * 0.12, phase: i * 1.7 } }
          : {})
      }), i % 6 === 0 ? 3.08 : 2.88, Math.sin(i * 1.15) * 0.28, 0.4 + rnd() * 0.1);
    }
  };

  const appendShuttle = (stage, count) => {
    for (let i = 0; i < count; i++) {
      place(stage, (next) => {
        const perpendicular = next.heading + Math.PI / 2;
        return {
          half: 0.48 + rnd() * 0.08,
          ...(i % 3 === 1
            ? {
                motion: {
                  type: 'shuttle',
                  x0: next.x,
                  z0: next.z,
                  axisX: Math.cos(perpendicular),
                  axisZ: Math.sin(perpendicular),
                  amplitude: 0.62 + (i % 2) * 0.12,
                  speed: 0.82 + (stage % 3) * 0.08,
                  phase: i * 1.3
                }
              }
            : {})
        };
      }, i % 3 === 1 ? 3.12 : 2.82, Math.sin(i * 0.8) * 0.18, 0.39 + rnd() * 0.12);
    }
  };

  const appendRotor = (stage, count, reverse = false) => {
    let remaining = count;
    while (remaining >= 6) {
      const radius = 2.44;
      const entryDistance = 2.74;
      const speed = (reverse ? -1 : 1) * (0.38 + (stage % 3) * 0.045);
      const armCount = 5;
      let layout = null;

      for (let attempt = 0; attempt < 10; attempt++) {
        const dirX = Math.cos(pose.heading);
        const dirZ = Math.sin(pose.heading);
        const cx = pose.x + dirX * (entryDistance + radius);
        const cz = pose.z + dirZ * (entryDistance + radius);
        const startAngle = pose.heading + Math.PI;
        const arms = [];
        for (let arm = 0; arm < armCount; arm++) {
          const angle = startAngle + (reverse ? -1 : 1) * arm * Math.PI * 2 / armCount;
          arms.push({
            angle,
            x: cx + Math.cos(angle) * radius,
            z: cz + Math.sin(angle) * radius,
            top: pose.top + 0.38 * (arm + 1)
          });
        }
        const last = arms[arms.length - 1];
        const outX = last.x - cx;
        const outZ = last.z - cz;
        const outLen = Math.hypot(outX, outZ) || 1;
        const exit = {
          x: last.x + outX / outLen * entryDistance,
          z: last.z + outZ / outLen * entryDistance,
          top: pose.top + 0.38 * (armCount + 1)
        };
        const candidates = [...arms, exit];
        const inBounds = candidates.every((candidate) =>
          candidate.x >= -38 && candidate.x <= 38 && candidate.z >= -50 && candidate.z <= 36
        );
        if (inBounds && candidates.every((candidate) => !insideSkyHouseClear(candidate.x, candidate.z))) {
          layout = { cx, cz, startAngle, arms, exit };
          break;
        }
        pose.heading += (attempt % 2 === 0 ? 0.72 : -0.46);
      }

      if (!layout) {
        appendZigzag(stage, remaining);
        return;
      }

      const { cx, cz, startAngle, arms, exit } = layout;
      let lastX = pose.x;
      let lastZ = pose.z;

      for (let arm = 0; arm < armCount; arm++) {
        const { angle, x, z, top } = arms[arm];
        addPlatform(stage, x, z, top, {
          half: arm === 0 ? 0.55 : 0.5,
          motion: {
            type: 'orbit',
            cx,
            cz,
            radius,
            speed,
            phase: angle
          }
        });
        lastX = x;
        lastZ = z;
      }

      const exitX = exit.x;
      const exitZ = exit.z;
      const exitTop = exit.top;
      addPlatform(stage, exitX, exitZ, exitTop, { half: 0.62 });

      rotors.push({
        x: cx,
        z: cz,
        radius,
        minTop: pose.top + 0.2,
        maxTop: exitTop + 0.12,
        speed,
        phase: startAngle
      });

      pose.x = exitX;
      pose.z = exitZ;
      pose.top = exitTop;
      const outX = lastX - cx;
      const outZ = lastZ - cz;
      pose.heading = Math.atan2(outZ, outX) + (reverse ? -0.28 : 0.28);
      clampPoseToMap();
      remaining -= 6;
    }

    if (remaining > 0) appendZigzag(stage, remaining);
  };

  const appendLiftMatrix = (stage, count) => {
    for (let i = 0; i < count; i++) {
      const turn = i % 6 < 3 ? 0.5 : -0.55;
      place(stage, (next) => ({
        half: 0.45 + rnd() * 0.1,
        ...(i % 3 !== 0
          ? { motion: { type: 'lift', baseTop: next.top, amplitude: 0.075, speed: 1.05 + (i % 4) * 0.08, phase: i * 1.4 } }
          : {})
      }), 2.88, turn, 0.41);
    }
  };

  const appendCrosswind = (stage, count) => {
    for (let i = 0; i < count; i++) {
      const turn = Math.sin(i * 1.45) * 0.78 + (i % 4 === 0 ? 0.45 : -0.16);
      place(stage, { half: 0.46 + rnd() * 0.12 }, 2.92 + rnd() * 0.12, turn, 0.38 + rnd() * 0.13);
    }
  };

  for (let stage = 0; stage < stageNames.length; stage++) {
    const pattern = stage % 10;
    if (pattern === 0) appendZigzag(stage, 24, stage >= 10);
    else if (pattern === 1) appendRotor(stage, 24, false);
    else if (pattern === 2) appendLiftMatrix(stage, 24);
    else if (pattern === 3) appendHelix(stage, 24, false);
    else if (pattern === 4) appendSwitchback(stage, 24);
    else if (pattern === 5) appendRotor(stage, 24, true);
    else if (pattern === 6) appendShuttle(stage, 24);
    else if (pattern === 7) appendNarrow(stage, 24);
    else if (pattern === 8) appendCrosswind(stage, 24);
    else appendHelix(stage, 24, true);

    while ((platforms.length + 1) % SKY_REWARD_INTERVAL !== 0) {
      appendZigzag(stage, 1);
    }
    advance(Math.sin(stage * 0.7) * 0.24, 2.82, 0.42);
    addPlatform(stage, pose.x, pose.z, pose.top, { half: 0.98 });
  }

  if (platforms.length !== SKY_PLATFORM_TOTAL) {
    throw new Error('登天云梯平台数错误: ' + platforms.length + ', 预期 ' + SKY_PLATFORM_TOTAL);
  }

  return { platforms, rotors };
}

const SKY_COURSE_DATA = makeSkyCourse();
const SKY_LAST_PLATFORM = SKY_COURSE_DATA.platforms[SKY_COURSE_DATA.platforms.length - 1];

/* ================= 潮汐远征生成器 =================
 * 500 台分为 20 个玩法段，每段 24 个挑战台 + 1 个宝箱台。
 * 主航道使用宽幅折返而不是重复 S 曲线；每段再叠加不同的洋流运动，
 * 包含潮门升降、浮标横漂、浪涌、海沟列车与真正的旋转跳台阵列。 */

const OCEAN_PLATFORM_TOTAL = 500;
const OCEAN_REWARD_INTERVAL = 25;
const OCEAN_FIXED_START_PLATFORMS = 2;
const OCEAN_MIN_X = 28;
const OCEAN_MAX_X = 70;
const OCEAN_MIN_Z = -3000;
const OCEAN_SHORTCUT_CLEARANCE = 4.35;
const OCEAN_PLATFORM_GAP = 0.2;
const OCEAN_TURN_MARGIN = 10.2;

function makeOceanCurrentCourse() {
  const themeNames = ['reef', 'tide', 'wreck', 'shell', 'deep'];
  const themes = {
    reef: { deck: 0x5f927b, trim: 0x9de3b2 },
    tide: { deck: 0x5f849f, trim: 0x78d9ea },
    wreck: { deck: 0x8d7057, trim: 0xe1a863 },
    shell: { deck: 0x947d89, trim: 0xf0c5ad },
    deep: { deck: 0x506b86, trim: 0x73b9da }
  };
  const stagePlans = [
    {
      name: '潮汐码头', kind: 'weave', runs: [7, 8, 6],
      half: [0.56, 0.62, 0.54], topBase: 1.18, topWave: 0.18,
      props: ['buoy', 'lamp', 'crate', 'gate']
    },
    {
      name: '浮标迷阵', kind: 'slalom', runs: [5, 4, 6],
      half: [0.48, 0.46, 0.52], topBase: 1.25, topWave: 0.14,
      props: ['buoy', 'buoy', 'gate', 'lily']
    },
    {
      name: '珊瑚折线', kind: 'switchback', runs: [3, 4, 3],
      half: [0.44, 0.48, 0.45], topBase: 1.34, topWave: 0.2,
      props: ['coral', 'coral', 'shell', 'gate']
    },
    {
      name: '沉船肋骨', kind: 'ribs', runs: [6, 5, 7],
      half: [0.43, 0.61, 0.47], topBase: 1.16, topWave: 0.3,
      props: ['wreck', 'crate', 'wreck', 'shell']
    },
    {
      name: '海风转盘', kind: 'carousel', runs: [5, 6, 5],
      half: [0.46, 0.49, 0.52], topBase: 1.3, topWave: 0.16,
      props: ['gate', 'lamp', 'whale', 'buoy']
    },
    {
      name: '潮门节拍', kind: 'lifts', runs: [5, 7, 6],
      half: [0.47, 0.52, 0.48], topBase: 1.42, topWave: 0.22,
      props: ['gate', 'lamp', 'gate', 'crate']
    },
    {
      name: '漂流信标', kind: 'drift', runs: [8, 7, 9],
      half: [0.48, 0.52, 0.5], topBase: 1.28, topWave: 0.26,
      props: ['lamp', 'lily', 'buoy', 'gate']
    },
    {
      name: '贝壳跳岛', kind: 'shells', runs: [3, 5, 4],
      half: [0.39, 0.42, 0.47], topBase: 1.35, topWave: 0.2,
      props: ['shell', 'coral', 'lily', 'shell']
    },
    {
      name: '灯塔横风', kind: 'crosswind', runs: [8, 6, 7],
      half: [0.45, 0.49, 0.46], topBase: 1.48, topWave: 0.28,
      props: ['lamp', 'gate', 'lamp', 'shell']
    },
    {
      name: '海沟列车', kind: 'tram', runs: [10, 9, 11],
      half: [0.5, 0.55, 0.48], topBase: 1.3, topWave: 0.18,
      props: ['crate', 'wreck', 'lamp', 'gate']
    },
    {
      name: '蓝洞环线', kind: 'bluehole', runs: [5, 4, 5],
      half: [0.46, 0.49, 0.52], topBase: 1.46, topWave: 0.2,
      props: ['gate', 'lamp', 'whale', 'lily']
    },
    {
      name: '风暴脉冲', kind: 'rhythm', runs: [6, 5, 6],
      half: [0.44, 0.5, 0.47], topBase: 1.38, topWave: 0.32,
      props: ['gate', 'lamp', 'buoy', 'wreck']
    },
    {
      name: '岔流回廊', kind: 'rapids', runs: [4, 5, 3],
      half: [0.46, 0.54, 0.48], topBase: 1.32, topWave: 0.24,
      props: ['gate', 'coral', 'crate', 'buoy']
    },
    {
      name: '鲸骨回旋', kind: 'leviathan', runs: [6, 7, 5],
      half: [0.43, 0.5, 0.46], topBase: 1.45, topWave: 0.26,
      props: ['whale', 'wreck', 'whale', 'shell']
    },
    {
      name: '月池星阵', kind: 'moons', runs: [5, 6, 4],
      half: [0.46, 0.49, 0.51], topBase: 1.36, topWave: 0.2,
      props: ['lily', 'lamp', 'gate', 'shell']
    },
    {
      name: '海藻迷宫', kind: 'maze', runs: [3, 4, 3],
      half: [0.4, 0.44, 0.47], topBase: 1.24, topWave: 0.22,
      props: ['lily', 'coral', 'lily', 'crate']
    },
    {
      name: '深眼涡壁', kind: 'eye', runs: [6, 7, 5],
      half: [0.45, 0.49, 0.52], topBase: 1.5, topWave: 0.3,
      props: ['whale', 'gate', 'coral', 'lamp']
    },
    {
      name: '逆潮折返', kind: 'riptide', runs: [7, 5, 6],
      half: [0.44, 0.52, 0.47], topBase: 1.36, topWave: 0.24,
      props: ['buoy', 'gate', 'buoy', 'crate']
    },
    {
      name: '海渊门扉', kind: 'gates', runs: [6, 8, 7],
      half: [0.46, 0.51, 0.48], topBase: 1.52, topWave: 0.28,
      props: ['gate', 'gate', 'lamp', 'wreck']
    },
    {
      name: '归潮之心', kind: 'heart', runs: [5, 6, 4],
      half: [0.45, 0.5, 0.54], topBase: 1.42, topWave: 0.34,
      props: ['whale', 'gate', 'lamp', 'coral']
    }
  ];

  const rnd = makeSeededRandom(0x0cea7e);
  const platforms = [];
  const rotors = [];
  const startX = 47;
  const startZ = 4;
  const pose = {
    x: startX,
    z: startZ,
    top: terrainHeight(startX, startZ) + 0.22,
    heading: -0.14
  };
  let firstPlatform = true;
  let laneDirection = 1;
  let laneRun = 8;
  let laneRunIndex = 0;
  let turnArc = null;
  let turnIndex = 0;
  let ignoreTailCount = 1;
  let forcedHeading = null;
  let forcedSteps = 0;
  let exitRotorGroup = null;

  const planAt = (stage) => stagePlans[stage];

  const chooseLaneRun = (stage) => {
    const runs = planAt(stage).runs;
    const next = runs[laneRunIndex++ % runs.length];
    return Math.max(8, Math.min(10, next + (rnd() < 0.34 ? -1 : 0)));
  };

  const makeTurnArc = (direction) => direction > 0
    ? [
        { heading: -1.57, length: 2.9 },
        { heading: -1.95, length: 2.9 },
        { heading: -2.3, length: 2.9 },
        { heading: -2.65, length: 2.9 }
      ]
    : [
        { heading: -1.57, length: 2.9 },
        { heading: -1.2, length: 2.9 },
        { heading: -0.85, length: 2.9 },
        { heading: -0.5, length: 2.9 }
      ];

  const clampTop = (value) => Math.max(0.62, Math.min(2.08, value));

  const canTurnAtNextPlatform = () =>
    pose.x + OCEAN_TURN_MARGIN * laneDirection <= OCEAN_MIN_X ||
    pose.x + OCEAN_TURN_MARGIN * laneDirection >= OCEAN_MAX_X;

  const horizontalBounds = (platform) => {
    if (platform.rotorCenter) {
      return {
        minX: platform.rotorCenter.x - platform.rotorRadius - platform.half,
        maxX: platform.rotorCenter.x + platform.rotorRadius + platform.half,
        minZ: platform.rotorCenter.z - platform.rotorRadius - platform.half,
        maxZ: platform.rotorCenter.z + platform.rotorRadius + platform.half
      };
    }
    const motion = platform.motion;
    if (!motion) {
      return {
        minX: platform.x - platform.half,
        maxX: platform.x + platform.half,
        minZ: platform.z - platform.half,
        maxZ: platform.z + platform.half
      };
    }
    if (motion.type === 'orbit') {
      return {
        minX: motion.cx - motion.radius - platform.half,
        maxX: motion.cx + motion.radius + platform.half,
        minZ: motion.cz - motion.radius - platform.half,
        maxZ: motion.cz + motion.radius + platform.half
      };
    }
    if (motion.type === 'shuttle') {
      const xReach = Math.abs(motion.axisX * motion.amplitude);
      const zReach = Math.abs(motion.axisZ * motion.amplitude);
      return {
        minX: motion.x0 - xReach - platform.half,
        maxX: motion.x0 + xReach + platform.half,
        minZ: motion.z0 - zReach - platform.half,
        maxZ: motion.z0 + zReach + platform.half
      };
    }
    if (motion.type === 'wave') {
      return {
        minX: motion.x0 - Math.abs(motion.amplitudeX) - platform.half,
        maxX: motion.x0 + Math.abs(motion.amplitudeX) + platform.half,
        minZ: motion.z0 - Math.abs(motion.amplitudeZ) - platform.half,
        maxZ: motion.z0 + Math.abs(motion.amplitudeZ) + platform.half
      };
    }
    return {
      minX: platform.x - platform.half,
      maxX: platform.x + platform.half,
      minZ: platform.z - platform.half,
      maxZ: platform.z + platform.half
    };
  };

  const conflictsWithPlatform = (candidate, platform, index, options = {}) => {
    if (options.ignoreRotorGroup && platform.rotorGroup === options.ignoreRotorGroup) return false;

    const a = horizontalBounds(candidate);
    const b = horizontalBounds(platform);
    const overlaps =
      a.minX < b.maxX + OCEAN_PLATFORM_GAP &&
      a.maxX > b.minX - OCEAN_PLATFORM_GAP &&
      a.minZ < b.maxZ + OCEAN_PLATFORM_GAP &&
      a.maxZ > b.minZ - OCEAN_PLATFORM_GAP;
    if (overlaps) return true;

    const ignoredForShortcut =
      (options.ignoreRecent && index >= platforms.length - options.ignoreRecent) ||
      (
        options.ignoreSameRotor &&
        candidate.rotorGroup &&
        platform.rotorGroup === candidate.rotorGroup
      );
    if (ignoredForShortcut) return false;

    const centerDistance = Math.hypot(candidate.x - platform.x, candidate.z - platform.z);
    return Math.abs(candidate.top - platform.top) < 1.05 && centerDistance < OCEAN_SHORTCUT_CLEARANCE;
  };

  const candidateConflicts = (candidate, options = {}) =>
    platforms.some((platform, index) => conflictsWithPlatform(candidate, platform, index, options));

  const routeProfile = (kind) => {
    if (kind === 'weave') return { z: -0.72, sway: 0.42, frequency: 0.72 };
    if (kind === 'slalom') return { z: -0.82, sway: 0.72, frequency: 1.45 };
    if (kind === 'switchback') return { z: -0.78, sway: 0.34, frequency: 0.8 };
    if (kind === 'ribs') return { z: -0.68, sway: 0.68, frequency: 0.92 };
    if (kind === 'carousel') return { z: -0.76, sway: 0.5, frequency: 0.65 };
    if (kind === 'lifts') return { z: -0.64, sway: 0.46, frequency: 0.85 };
    if (kind === 'drift') return { z: -0.94, sway: 0.5, frequency: 0.58 };
    if (kind === 'shells') return { z: -0.72, sway: 0.82, frequency: 1.1 };
    if (kind === 'crosswind') return { z: -0.8, sway: 0.68, frequency: 1.2 };
    if (kind === 'tram') return { z: -0.58, sway: 0.26, frequency: 0.45 };
    if (kind === 'bluehole') return { z: -0.74, sway: 0.44, frequency: 0.72 };
    if (kind === 'rhythm') return { z: -0.72, sway: 0.62, frequency: 1.65 };
    if (kind === 'rapids') return { z: -0.88, sway: 0.92, frequency: 1.46 };
    if (kind === 'leviathan') return { z: -0.66, sway: 0.5, frequency: 0.7 };
    if (kind === 'moons') return { z: -0.7, sway: 0.42, frequency: 0.62 };
    if (kind === 'maze') return { z: -0.78, sway: 0.78, frequency: 1.28 };
    if (kind === 'eye') return { z: -0.6, sway: 0.38, frequency: 0.6 };
    if (kind === 'riptide') return { z: -0.9, sway: 0.96, frequency: 1.18 };
    if (kind === 'gates') return { z: -0.62, sway: 0.3, frequency: 0.55 };
    return { z: -0.7, sway: 0.64, frequency: 0.84 };
  };

  const baseCandidate = (stage, step, x, z, top, extra) => {
    const candidate = {
      x,
      z,
      top,
      half: extra.half ?? 0.5,
      rotorGroup: extra.rotorGroup,
      rotorCenter: extra.rotorCenter,
      rotorRadius: extra.rotorRadius
    };
    if (extra.motionType) {
      candidate.motion = motionFor(extra.motionType, candidate, stage, step);
    } else if (extra.motion) {
      candidate.motion = extra.motion;
    }
    return candidate;
  };

  const advanceBase = (stage, step, extra = {}) => {
    const plan = planAt(stage);
    const profile = routeProfile(plan.kind);
    if (
      forcedSteps === 0 &&
      !turnArc &&
      (
        pose.x + OCEAN_TURN_MARGIN * laneDirection < OCEAN_MIN_X ||
        pose.x + OCEAN_TURN_MARGIN * laneDirection > OCEAN_MAX_X
      )
    ) {
      laneRun = 0;
    }
    if (forcedSteps === 0 && !turnArc && laneRun <= 0) {
      if (canTurnAtNextPlatform()) {
        turnArc = makeTurnArc(laneDirection);
        turnIndex = 0;
      } else {
        laneRun = 2;
      }
    }

    const turnPoint = turnArc ? turnArc[turnIndex] : null;
    const preferredZ = profile.z + Math.sin((platforms.length + stage * 5) * profile.frequency) * profile.sway;
    const preferredHeading = forcedSteps > 0
      ? forcedHeading
      : turnPoint
        ? turnPoint.heading
        : Math.atan2(preferredZ, 2.8 * laneDirection);
    const normalHeading = forcedSteps > 0
      ? forcedHeading
      : Math.atan2(preferredZ, 2.8 * laneDirection);
    const angleOffsets = [
      0, 0.12, -0.12, 0.24, -0.24, 0.38, -0.38, 0.55, -0.55,
      0.76, -0.76, 1.02, -1.02, 1.35, -1.35, 1.7, -1.7, 2.1, -2.1
    ];
    const stepScales = [1, 0.96, 1.04, 0.92, 1.08, 0.84, 1.14];
    const targetTop = plan.topBase + Math.sin((platforms.length + stage * 4) * 0.17) * plan.topWave;
    const rejectedCandidates = [];
    const findCandidate = (baseHeading, stepLength) => {
      rejectedCandidates.length = 0;
      for (const offset of angleOffsets) {
        for (const scale of stepScales) {
          const heading = baseHeading + offset;
          const length = stepLength * scale;
          const x = pose.x + Math.cos(heading) * length;
          const z = pose.z + Math.sin(heading) * length;
          if (x < OCEAN_MIN_X || x > OCEAN_MAX_X || z > 12 || z < OCEAN_MIN_Z) continue;
          const deltaX = x - pose.x;
          const deltaZ = z - pose.z;
          if (deltaZ > (turnArc ? -1.8 : -0.35)) continue;
          if (!turnArc && forcedSteps === 0 && deltaX * laneDirection < 0.45) continue;
          const topStep = Math.max(-0.42, Math.min(0.42, targetTop - pose.top));
          const top = clampTop(pose.top + topStep);
          const candidate = baseCandidate(stage, step, x, z, top, extra);
          if (!candidateConflicts(candidate, {
            ignoreRecent: turnArc ? 4 : ignoreTailCount,
            ignoreSameRotor: Boolean(candidate.rotorGroup),
            ignoreRotorGroup: exitRotorGroup
          })) {
            return { x, z, top, heading };
          }
          const blocker = platforms.find((platform, index) =>
            conflictsWithPlatform(candidate, platform, index, {
              ignoreRecent: turnArc ? 4 : ignoreTailCount,
              ignoreSameRotor: Boolean(candidate.rotorGroup),
              ignoreRotorGroup: exitRotorGroup
            })
          );
          rejectedCandidates.push({
            heading: Number(heading.toFixed(3)),
            scale,
            x: Number(x.toFixed(2)),
            z: Number(z.toFixed(2)),
            blockedBy: blocker?.number ?? null,
            distance: blocker
              ? Number(Math.hypot(candidate.x - blocker.x, candidate.z - blocker.z).toFixed(2))
              : null
          });
        }
      }
      return null;
    };

    let chosen = findCandidate(preferredHeading, turnPoint?.length ?? 2.86);
    let usedTurnStep = Boolean(turnPoint && chosen);
    if (!chosen && turnPoint) {
      chosen = findCandidate(normalHeading, 2.86);
    }

    if (!chosen) {
      throw new Error(
        '潮汐远征布点失败: 第 ' + (platforms.length + 1) + ' 台 / 第 ' + (stage + 1) + ' 段 ' +
        JSON.stringify({
          pose: { x: pose.x, z: pose.z, top: pose.top, heading: pose.heading },
          laneDirection,
          laneRun,
          turnArc,
          rejectedCandidates: rejectedCandidates.slice(0, 12),
          recent: platforms.slice(-6).map((platform) => ({
            number: platform.number,
            x: platform.x,
            z: platform.z,
            top: platform.top,
            half: platform.half,
            motion: platform.motion?.type || null
          })),
          nearby: platforms
            .filter((platform) => Math.hypot(platform.x - pose.x, platform.z - pose.z) < 9)
            .map((platform) => ({
              number: platform.number,
              x: platform.x,
              z: platform.z,
              top: platform.top,
              half: platform.half,
              motion: platform.motion?.type || null,
              rotorGroup: platform.rotorGroup || null
            }))
        })
      );
    }

    if (platforms.length < OCEAN_FIXED_START_PLATFORMS) {
      chosen.top = Math.max(chosen.top, terrainHeight(chosen.x, chosen.z) + 0.22);
    }

    pose.x = chosen.x;
    pose.z = chosen.z;
    pose.top = chosen.top;
    pose.heading = chosen.heading;

    if (turnArc && usedTurnStep) {
      turnIndex++;
      if (turnIndex >= turnArc.length) {
        turnArc = null;
        turnIndex = 0;
        laneDirection *= -1;
        laneRun = chooseLaneRun(stage);
      }
    } else if (turnArc) {
      turnArc = null;
      turnIndex = 0;
      laneRun = chooseLaneRun(stage);
    } else {
      laneRun--;
      if (laneRun <= 0 && !canTurnAtNextPlatform()) {
        laneRun = 2;
      }
    }
    if (forcedSteps > 0) {
      forcedSteps--;
      if (forcedSteps === 0) {
        forcedHeading = null;
        exitRotorGroup = null;
      }
    }
    if (ignoreTailCount > 1) ignoreTailCount--;
  };

  const addPlatform = (stage, x, z, top, extra = {}) => {
    const number = platforms.length + 1;
    const plan = planAt(stage);
    const theme = themeNames[stage % themeNames.length];
    const texture = themes[theme];
    const isReward = number % OCEAN_REWARD_INTERVAL === 0;
    const previous = platforms[platforms.length - 1];
    const routeYaw = previous
      ? Math.atan2(z - previous.z, x - previous.x)
      : pose.heading;
    const p = {
      id: 'ocean-' + number,
      number,
      stage: stage + 1,
      stageName: plan.name,
      stageMechanic: plan.kind,
      theme,
      prop: extra.prop,
      deckColor: texture.deck,
      trimColor: isReward ? 0xffca62 : texture.trim,
      x,
      z,
      top,
      half: isReward ? 1.02 : Math.max(0.37, extra.half ?? 0.5),
      routeYaw
    };

    if (previous) previous.routeYaw = routeYaw;
    if (extra.rotorGroup) {
      p.rotorGroup = extra.rotorGroup;
      p.rotorCenter = extra.rotorCenter;
      p.rotorRadius = extra.rotorRadius;
    }
    if (extra.mechanic) p.mechanic = extra.mechanic;
    if (!isReward && extra.motion) p.motion = extra.motion;

    if (isReward) {
      p.reward = {
        id: 'ocean-stage-' + (stage + 1),
        stage: stage + 1,
        stageName: plan.name,
        points: 180 + (stage + 1) * 45,
        final: number === OCEAN_PLATFORM_TOTAL
      };
      p.half = number === OCEAN_PLATFORM_TOTAL ? 1.85 : 1.02;
      p.isGoal = number === OCEAN_PLATFORM_TOTAL;
      delete p.motion;
    }

    platforms.push(p);
    return p;
  };

  const motionFor = (type, p, stage, step) => {
    const tangentX = Math.cos(pose.heading);
    const tangentZ = Math.sin(pose.heading);
    const sideX = -tangentZ;
    const sideZ = tangentX;
    const direction = step % 2 === 0 ? 1 : -1;

    if (type === 'lift') {
      return {
        type,
        baseTop: p.top,
        amplitude: 0.13 + (step % 3) * 0.045,
        speed: 0.88 + (stage % 5) * 0.055,
        phase: step * 1.17 + stage * 0.6
      };
    }
    if (type === 'shuttle') {
      const flow = planAt(stage).kind === 'tram' || planAt(stage).kind === 'leviathan';
      const axisX = flow ? tangentX : sideX;
      const axisZ = flow ? tangentZ : sideZ;
      return {
        type,
        x0: p.x,
        z0: p.z,
        axisX,
        axisZ,
        amplitude: flow ? 0.62 : 0.5 + (step % 3) * 0.06,
        speed: 0.72 + (stage % 4) * 0.06,
        phase: step * 0.82 + stage * 0.45
      };
    }
    if (type === 'wave') {
      const amplitude = 0.22 + (step % 3) * 0.045;
      return {
        type,
        x0: p.x,
        z0: p.z,
        baseTop: p.top,
        amplitudeX: sideX * amplitude,
        amplitudeZ: sideZ * amplitude,
        amplitudeY: 0.08 + (step % 2) * 0.035,
        speed: 0.86 + (stage % 5) * 0.055,
        phase: step * 0.93 + stage * 0.4
      };
    }
    return {
      type: 'orbit',
      cx: p.x,
      cz: p.z,
      radius: 0.58 + (step % 3) * 0.07,
      speed: direction * (0.42 + (stage % 4) * 0.055),
      phase: step * 1.31 + stage * 0.5
    };
  };

  const placeBase = (stage, step, extra = {}) => {
    const plan = planAt(stage);
    const half = extra.half ?? plan.half[step % plan.half.length] ?? 0.5;
    if (!firstPlatform) {
      advanceBase(stage, step, {
        half,
        motionType: extra.motionType,
        rotorGroup: extra.rotorGroup,
        rotorCenter: extra.rotorCenter,
        rotorRadius: extra.rotorRadius
      });
    }
    firstPlatform = false;
    const mechanic = extra.mechanic || plan.kind;
    const p = addPlatform(stage, pose.x, pose.z, pose.top, {
      half,
      mechanic,
      prop: extra.prop ?? plan.props[step % plan.props.length],
      rotorGroup: extra.rotorGroup,
      rotorCenter: extra.rotorCenter,
      rotorRadius: extra.rotorRadius
    });
    if (!p.reward && extra.motionType) {
      p.motion = motionFor(extra.motionType, p, stage, step);
    }
    return p;
  };

  const regularPattern = (stage, step) => {
    const kind = planAt(stage).kind;
    if (kind === 'weave') return ['static', 'wave', 'static', 'shuttle'][step % 4];
    if (kind === 'slalom') return step % 4 === 3 ? 'static' : 'shuttle';
    if (kind === 'switchback') return step % 5 === 4 ? 'lift' : 'static';
    if (kind === 'ribs') return ['static', 'lift', 'wave'][step % 3];
    if (kind === 'carousel') return ['orbit', 'wave'][step % 2];
    if (kind === 'lifts') return step % 4 === 3 ? 'static' : 'lift';
    if (kind === 'drift') return step % 5 === 4 ? 'static' : 'wave';
    if (kind === 'shells') return step % 6 === 5 ? 'lift' : 'static';
    if (kind === 'crosswind') return step % 5 === 4 ? 'static' : 'wave';
    if (kind === 'tram') return step % 4 === 3 ? 'static' : 'shuttle';
    if (kind === 'bluehole') return ['orbit', 'wave', 'lift'][step % 3];
    if (kind === 'rhythm') return ['lift', 'lift', 'wave', 'static', 'lift'][step % 5];
    if (kind === 'rapids') return ['shuttle', 'static', 'wave', 'static'][step % 4];
    if (kind === 'leviathan') return step % 4 === 3 ? 'static' : 'shuttle';
    if (kind === 'moons') return ['orbit', 'orbit', 'wave'][step % 3];
    if (kind === 'maze') return step % 5 === 4 ? 'lift' : 'static';
    if (kind === 'eye') return ['orbit', 'lift', 'wave', 'static'][step % 4];
    if (kind === 'riptide') return ['shuttle', 'static', 'lift', 'shuttle'][step % 4];
    if (kind === 'gates') return ['lift', 'wave', 'wave', 'lift', 'static'][step % 5];
    return ['static', 'orbit', 'wave', 'lift', 'static', 'shuttle'][step % 6];
  };

  const appendRegular = (stage, count, offset = 0) => {
    for (let i = 0; i < count; i++) {
      const step = offset + i;
      const motionType = platforms.length < OCEAN_FIXED_START_PLATFORMS
        ? 'static'
        : regularPattern(stage, step);
      placeBase(stage, step, {
        motionType: motionType === 'static' ? null : motionType,
        half: planAt(stage).half[step % planAt(stage).half.length]
      });
    }
  };

  const appendRotorCluster = (stage, armCount, radius, reverse = false) => {
    const entryDistance = 2.86;
    const exitDistance = 2.86;
    const direction = reverse ? -1 : 1;
    const rotorGroup = 'ocean-rotor-' + (stage + 1) + '-' + rotors.length;
    const routeHeading = -Math.PI / 2 + Math.sin(stage * 1.31 + rotors.length * 0.83) * 0.42;
    const headingOffsets = [
      0, 0.24, -0.24, 0.5, -0.5, 0.82, -0.82, 1.08, -1.08,
      1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.45, -2.45, 2.8, -2.8, 3.14
    ];
    const radiusScales = [1, 0.9, 1.1, 0.82, 1.18, 0.74, 1.26];
    const phaseOffsets = [0, 0.34, -0.34, 0.68, -0.68];
    let layout = null;

    for (const headingOffset of headingOffsets) {
      const heading = routeHeading + headingOffset;
      const dirX = Math.cos(heading);
      const dirZ = Math.sin(heading);
      for (const radiusScale of radiusScales) {
        const ringRadius = radius * radiusScale;
        const cx = pose.x + dirX * (entryDistance + ringRadius);
        const cz = pose.z + dirZ * (entryDistance + ringRadius);
        const speed = direction * (0.38 + (stage % 4) * 0.04);

        for (const phaseOffset of phaseOffsets) {
          const startAngle = heading + Math.PI + phaseOffset;
          const arms = [];
          for (let arm = 0; arm < armCount; arm++) {
            const angle = startAngle + direction * arm * Math.PI * 2 / armCount;
            const x = cx + Math.cos(angle) * ringRadius;
            const z = cz + Math.sin(angle) * ringRadius;
            const top = pose.top + (arm % 2 === 0 ? -0.06 : 0.16);
            const motion = {
              type: 'orbit',
              cx,
              cz,
              radius: ringRadius,
              speed,
              phase: angle
            };
            const candidate = baseCandidate(stage, 0, x, z, top, {
              half: 0.48,
              motion,
              rotorGroup,
              rotorCenter: { x: cx, z: cz },
              rotorRadius: ringRadius
            });
            arms.push({ angle, x, z, top, motion, candidate });
          }

          const last = arms[arms.length - 1];
          const outX = (last.x - cx) / ringRadius;
          const outZ = (last.z - cz) / ringRadius;
          const exit = {
            x: last.x + outX * exitDistance,
            z: last.z + outZ * exitDistance,
            top: last.top + 0.18
          };
          if (exit.z > pose.z - 1.8) continue;
          const exitCandidate = baseCandidate(stage, 0, exit.x, exit.z, exit.top, { half: 0.6 });

          const inBounds = [...arms.map((arm) => arm.candidate), exitCandidate].every((candidate) => {
            const bounds = horizontalBounds(candidate);
            return (
              bounds.minX >= OCEAN_MIN_X &&
              bounds.maxX <= OCEAN_MAX_X &&
              bounds.maxZ <= 12 &&
              bounds.minZ >= OCEAN_MIN_Z
            );
          });
          if (!inBounds) continue;

          const armsClear = arms.every((arm) =>
            !candidateConflicts(arm.candidate, {
              ignoreRecent: 1,
              ignoreSameRotor: true
            })
          );
          if (!armsClear) continue;
          if (candidateConflicts(exitCandidate, { ignoreRecent: 1 })) continue;

          const exitClear = arms.every((arm, index) => {
            const distance = Math.hypot(exit.x - arm.x, exit.z - arm.z);
            return index === arms.length - 1 || distance > 3.05;
          });
          if (!exitClear) continue;

          layout = {
            cx,
            cz,
            ringRadius,
            speed,
            arms,
            exit,
            exitCandidate
          };
          break;
        }
        if (layout) break;
      }
      if (layout) break;
    }

    if (!layout) {
      throw new Error(
        '潮汐远征旋转区布点失败: 第 ' + (stage + 1) + ' 段 ' +
        JSON.stringify({
          pose: { x: pose.x, z: pose.z, top: pose.top, heading: pose.heading },
          armCount,
          radius,
          recent: platforms.slice(-10).map((platform) => ({
            number: platform.number,
            x: platform.x,
            z: platform.z,
            top: platform.top,
            half: platform.half,
            motion: platform.motion?.type || null
          }))
        })
      );
    }

    let lastX = pose.x;
    let lastZ = pose.z;
    for (const arm of layout.arms) {
      addPlatform(stage, arm.x, arm.z, arm.top, {
        half: 0.48,
        mechanic: 'rotor',
        motion: arm.motion,
        rotorGroup,
        rotorCenter: { x: layout.cx, z: layout.cz },
        rotorRadius: layout.ringRadius
      });
      lastX = arm.x;
      lastZ = arm.z;
    }
    addPlatform(stage, layout.exit.x, layout.exit.z, layout.exit.top, {
      half: 0.6,
      mechanic: 'rotor-exit',
      prop: 'gate'
    });

    rotors.push({
      stage,
      x: layout.cx,
      z: layout.cz,
      radius: layout.ringRadius,
      minTop: Math.min(...layout.arms.map((arm) => arm.top)) - 0.18,
      maxTop: Math.max(...layout.arms.map((arm) => arm.top), layout.exit.top) + 0.2,
      speed: layout.speed,
      phase: layout.arms[0].angle
    });

    pose.x = layout.exit.x;
    pose.z = layout.exit.z;
    pose.top = layout.exit.top;
    const outHeading = Math.atan2(layout.exit.z - layout.cz, layout.exit.x - layout.cx);
    laneDirection = Math.cos(outHeading) >= 0 ? 1 : -1;
    pose.heading = outHeading;
    forcedHeading = outHeading;
    forcedSteps = 2;
    exitRotorGroup = rotorGroup;
    firstPlatform = false;
    turnArc = null;
    turnIndex = 0;
    laneRun = chooseLaneRun(stage);
    ignoreTailCount = armCount + 7;
  };

  const appendStage = (stage) => {
    const kind = planAt(stage).kind;
    if (kind === 'carousel') {
      appendRotorCluster(stage, 6, 2.65, false);
      appendRegular(stage, 17, 7);
    } else if (kind === 'bluehole') {
      appendRotorCluster(stage, 8, 3.75, false);
      appendRegular(stage, 15, 9);
    } else if (kind === 'moons') {
      appendRotorCluster(stage, 8, 3.4, false);
      appendRegular(stage, 15, 9);
    } else if (kind === 'eye') {
      appendRotorCluster(stage, 5, 2.5, true);
      appendRegular(stage, 18, 6);
    } else if (kind === 'heart') {
      appendRotorCluster(stage, 8, 3.75, true);
      appendRegular(stage, 15, 9);
    } else {
      appendRegular(stage, 24);
    }
  };

  for (let stage = 0; stage < stagePlans.length; stage++) {
    if (platforms.length !== stage * OCEAN_REWARD_INTERVAL) {
      throw new Error('潮汐远征分段起点错误: 第 ' + (stage + 1) + ' 段, ' + platforms.length);
    }
    appendStage(stage);
    if (platforms.length !== stage * OCEAN_REWARD_INTERVAL + 24) {
      throw new Error('潮汐远征挑战台数量错误: 第 ' + (stage + 1) + ' 段, ' + platforms.length);
    }
    placeBase(stage, 24, {
      half: 1.02,
      mechanic: 'reward',
      prop: 'gate',
      motionType: null
    });
  }

  if (platforms.length !== OCEAN_PLATFORM_TOTAL) {
    throw new Error('潮汐远征平台数错误: ' + platforms.length + ', 预期 ' + OCEAN_PLATFORM_TOTAL);
  }
  for (let number = OCEAN_REWARD_INTERVAL; number <= OCEAN_PLATFORM_TOTAL; number += OCEAN_REWARD_INTERVAL) {
    if (!platforms[number - 1]?.reward) {
      throw new Error('潮汐远征宝箱位置错误: ' + number);
    }
  }
  return { platforms, rotors };
}

const OCEAN_COURSE_DATA = makeOceanCurrentCourse();
const OCEAN_LAST_PLATFORM = OCEAN_COURSE_DATA.platforms[OCEAN_COURSE_DATA.platforms.length - 1];

/* ================= 星跃追光生成器 =================
 * 500 台分布在西侧远海高空星轨：短台用于调整落点，7 段长间隔必须用星跃冲刺跨越。
 * 发光充能台补充冲刺次数，阶段宝箱同时补满并解锁下一段。 */

const COMET_PLATFORM_TOTAL = 500;
const COMET_REWARD_INTERVAL = 25;

function makeCometCourse() {
  const stageNames = [
    '星港起航', '借光一跃', '碎星横渡', '辉光折线', '彗尾回廊',
    '银砂断桥', '极光跳台', '远星信标', '重力涟漪', '蓝焰航道',
    '天琴回旋', '陨石雨隙', '孤独灯塔', '星尘长跃', '银河裂隙',
    '流星追尾', '光环矩阵', '深空静默', '最后星门', '光年彼岸'
  ];
  const themeNames = ['cyan', 'brass', 'coral', 'violet', 'frost'];
  const curveCycles = 17;
  const themes = {
    cyan: { deck: 0x3f7380, trim: 0x7ff1dc },
    brass: { deck: 0x807052, trim: 0xf2c56b },
    coral: { deck: 0x84665f, trim: 0xff9b79 },
    violet: { deck: 0x655d7e, trim: 0xc7a6ff },
    frost: { deck: 0x617b88, trim: 0xd4f5ff }
  };

  const curvePoint = (t) => {
    const angle = -Math.PI * curveCycles * 2 * t;
    const spin = Math.PI * 2 * 2 * t;
    const radius = 17.6 + Math.cos(spin) * 2.4;
    const radiusRate = -Math.sin(spin) * Math.PI * 2 * 2 * 2.4;
    const angularRate = Math.PI * curveCycles * 2;
    const centerX = -65 - 20 * t;
    const centerZ = 10 - 82 * t;
    return {
      x: centerX + Math.cos(angle) * radius,
      z: centerZ + Math.sin(angle) * radius,
      dx: -20 + Math.cos(angle) * radiusRate - Math.sin(angle) * radius * angularRate,
      dz: -82 + Math.sin(angle) * radiusRate + Math.cos(angle) * radius * angularRate
    };
  };

  // 每个阶段 24 次落点间隔；长间隔由星跃冲刺负责，短间隔仍保留普通跳跃节奏。
  const intervals = [
    2.9, 3.05, 5.8, 2.8, 3.1, 5.9, 2.75, 3.05,
    5.7, 2.8, 3.1, 5.8, 2.75, 2.95, 5.6, 2.8,
    3.05, 5.85, 2.75, 3.1, 2.9, 5.7, 2.8, 3.05
  ];
  const chargeSlots = new Set([3, 9, 15, 21]);
  const platforms = [];
  const rotors = [];
  let routeLength = 0;

  for (let number = 1; number <= COMET_PLATFORM_TOTAL; number++) {
    const stage = Math.floor((number - 1) / COMET_REWARD_INTERVAL);
    const slot = (number - 1) % COMET_REWARD_INTERVAL;
    const previous = platforms[platforms.length - 1];
    const previousGap = number === 1 ? 0 : (slot === 0 ? 3.15 : intervals[slot - 1]);
    let point;
    let t = 0;

    if (previous) {
      let lowIndex = Math.min(12000, Math.max(0, Math.ceil(previous.t * 12000)));
      let highIndex = -1;
      for (let i = lowIndex; i <= 12000; i++) {
        const sampleT = i / 12000;
        const sample = curvePoint(sampleT);
        if (Math.hypot(sample.x - previous.x, sample.z - previous.z) >= previousGap) {
          highIndex = i;
          break;
        }
      }
      if (highIndex < 0) {
        throw new Error('星跃追光路线长度不足，无法放置第 ' + number + ' 个平台');
      }

      let lowT = Math.max(previous.t, (highIndex - 1) / 12000);
      let highT = highIndex / 12000;
      for (let i = 0; i < 48; i++) {
        const midT = (lowT + highT) * 0.5;
        const mid = curvePoint(midT);
        if (Math.hypot(mid.x - previous.x, mid.z - previous.z) >= previousGap) {
          highT = midT;
        } else {
          lowT = midT;
        }
      }
      t = highT;
      point = curvePoint(t);
      routeLength += previousGap;
    } else {
      point = curvePoint(0);
    }

    const progress = (number - 1) / (COMET_PLATFORM_TOTAL - 1);
    const theme = themeNames[stage % themeNames.length];
    const texture = themes[theme];
    const isReward = number % COMET_REWARD_INTERVAL === 0;
    const isDashLanding = !isReward && previousGap > 4.5;
    const isChargePad = chargeSlots.has(slot) && !isReward;
    const idealTop = 1.55 + (number - 1) * 0.155 + Math.sin(number * 0.33) * 0.2;
    const top = previous
      ? Math.max(previous.top - 0.2, Math.min(previous.top + 0.46, idealTop))
      : 1.55;
    const half = isReward
      ? (number === COMET_PLATFORM_TOTAL ? 1.65 : 0.98)
      : isChargePad
        ? 0.8
        : isDashLanding
          ? 0.72
          : Math.max(0.48, 0.6 - progress * 0.08 + (slot % 3) * 0.018);
    const p = {
      id: 'comet-' + number,
      number,
      stage: stage + 1,
      stageName: stageNames[stage],
      theme,
      deckColor: texture.deck,
      trimColor: isReward ? 0xffdb72 : isChargePad ? 0x7bf3df : texture.trim,
      x: point.x,
      z: point.z,
      t,
      top,
      half,
      dashPad: isChargePad,
      dashRim: isDashLanding
    };

    if (!isReward && !isChargePad && slot % 11 === 5) {
      p.motion = {
        type: 'lift',
        baseTop: top,
        amplitude: 0.055,
        speed: 0.95 + (stage % 3) * 0.09,
        phase: slot * 1.17
      };
    }

    if (isReward) {
      p.reward = {
        id: 'comet-stage-' + (stage + 1),
        stage: stage + 1,
        stageName: stageNames[stage],
        points: 240 + (stage + 1) * 55,
        final: number === COMET_PLATFORM_TOTAL
      };
      p.isGoal = number === COMET_PLATFORM_TOTAL;
    }

    if (previous) {
      previous.routeYaw = Math.atan2(point.z - previous.z, point.x - previous.x);
    }
    p.routeYaw = previous?.routeYaw || Math.atan2(point.dz, point.dx);
    platforms.push(p);
  }

  if (platforms.length !== COMET_PLATFORM_TOTAL) {
    throw new Error('星跃追光平台数错误: ' + platforms.length + ', 预期 ' + COMET_PLATFORM_TOTAL);
  }
  return { platforms, rotors, pathLength: routeLength };
}

const COMET_COURSE_DATA = makeCometCourse();
const COMET_LAST_PLATFORM = COMET_COURSE_DATA.platforms[COMET_COURSE_DATA.platforms.length - 1];

/* ================= 关卡注册表 =================
 * 新增关卡：往 COURSES 里加一个对象即可——碰撞、落地、奖励和交互自动接入。
 *
 * 字段说明：
 *   id        唯一标识
 *   name      显示名称（通关提示用）
 *   style     视觉样式：'sea'  = 桩柱浮台（放在海面）
 *                       'float'= 悬空台（陆地/高空，三种台面样式轮换）
 *                       'sky'  = 500 阶登天云梯（含动态台、阶段宝箱与检查点）
 *                       'ocean'= 500 阶潮汐远征（宽幅折返、旋转阵列与阶段宝箱）
 *                       'comet'= 500 阶星跃追光（有限冲刺、充能台与阶段宝箱）
 *   platforms 平台数组 [{x, z, top, half, prop?}]；platforms[0] 为起点台
 *             motion:{type:'orbit'|'lift'|'shuttle'|'wave'} 可让平台沿轨道/高度/横向/波浪运动
 *             reward 标记宝箱平台，打开后奖励积分并自动成为关卡检查点
 *             prop:'palm' 表示该平台用棕榈树冠跳台替代木台
 *   goal      终点 {x, z, top, half}（靠近宝箱即通关）
 *
 * 布点约束：相邻平台中心距 ≥2.8（台宽 1.4，防重叠）且 ≤3.2（间隙 ≤1.8，步行跳可过）；
 * 每级升幅 ≤0.65；终点 half>2 时自动使用金边观景台样式。 */
export const COURSES = [
  {
    id: 'sea',
    name: '深海远征',
    style: 'sea',
    platforms: [
      // S 弯进入深海
      { x: -14.0, z: -2.2,  top: 0.55, half: 0.85 },  // 起点台
      { x: -15.6, z: -4.6,  top: 0.62, half: 0.85 },
      { x: -13.4, z: -6.9,  top: 0.70, half: 0.85 },
      { x: -15.9, z: -9.2,  top: 0.78, half: 0.85 },
      { x: -13.6, z: -11.5, top: 0.86, half: 0.85 },
      // 窄台精准跳（半宽 0.6，落点要求更准）
      { x: -15.5, z: -13.9, top: 0.92, half: 0.6 },
      { x: -13.8, z: -16.2, top: 0.98, half: 0.6 },
      // 强制助跑跳：2.7m 间隙，步行跳(2.3m)够不着，必须按 Shift 助跑
      { x: -15.9, z: -19.8, top: 1.04, half: 0.85 },
      { x: -14.0, z: -22.4, top: 1.10, half: 0.85 },
      { x: -16.3, z: -24.8, top: 1.16, half: 0.85 },
      // 窄台下坡段（节奏连跳）
      { x: -14.4, z: -27.0, top: 1.10, half: 0.6 },
      { x: -16.5, z: -29.2, top: 1.16, half: 0.6 },
      { x: -14.6, z: -31.4, top: 1.22, half: 0.6 },
      // 深海延伸段（S 弯继续扎向远方）
      { x: -16.3, z: -34.0, top: 1.30, half: 0.7 },
      { x: -15.2, z: -37.0, top: 1.36, half: 0.7 },
      { x: -17.4, z: -39.6, top: 1.42, half: 0.7 },
      { x: -15.4, z: -42.2, top: 1.48, half: 0.7 },
      { x: -17.6, z: -44.8, top: 1.54, half: 0.7 },
      { x: -15.6, z: -47.4, top: 1.60, half: 0.7 },
      { x: -17.8, z: -50.0, top: 1.66, half: 0.7 },
      // 终点宝箱岛
      { x: -16.2, z: -53.2, top: 1.78, half: 2.4 }
    ],
    goal: { x: -16.2, z: -53.2, top: 1.78, half: 2.4 }
  },
  {
    id: 'height',
    name: '环屋跳高',
    style: 'float',
    platforms: (() => {
      const pts = [
        // A 段：沿南岸向西（起点在东侧远处海滨）
        [34.0, 2.2], [30.95, 2.3], [27.9, 2.2], [24.85, 2.4], [21.8, 2.2], [18.75, 2.4],
        [15.7, 2.2], [12.65, 2.4], [9.6, 2.6],
        // B 段：偏折北上（房子西侧）
        [9.3, 5.55], [9.2, 8.5], [9.3, 11.45], [9.6, 14.4], [10.1, 17.3], [10.9, 20.1],
        // C 段：偏折东行（绕到房子北侧高空）
        [13.6, 21.2], [16.4, 22.0], { p: [19.4, 22.4], prop: 'palm' }, [22.4, 22.2], [25.3, 21.4],
        { p: [27.9, 20.1], prop: 'palm' }, [29.9, 17.8], [29.9, 15.0], [29.5, 12.1],
        // D 段：南下贴房，从东南收进终点观景台
        [28.2, 9.4], [27.4, 6.5], [25.0, 4.6], [22.2, 3.6], [19.2, 3.1], [16.2, 3.05]
      ];
      const top0 = 1.6, topN = 12.2;
      const platforms = pts.map((e, i) => {
        const arr = Array.isArray(e) ? e : e.p;
        return { x: arr[0], z: arr[1], top: top0 + (topN - top0) * i / (pts.length - 1), half: 0.7, prop: Array.isArray(e) ? null : e.prop };
      });
      platforms.push({ x: HOUSE.x, z: HOUSE.z, top: topN, half: 2.6 }); // 终点观景平台（不算台阶）
      return platforms;
    })(),
    goal: { x: HOUSE.x, z: HOUSE.z, top: 12.2, half: 2.6 }
  },
  {
    id: 'sky',
    name: '登天云梯',
    style: 'sky',
    platforms: SKY_COURSE_DATA.platforms,
    rotors: SKY_COURSE_DATA.rotors,
    goal: {
      x: SKY_LAST_PLATFORM.x,
      z: SKY_LAST_PLATFORM.z,
      top: SKY_LAST_PLATFORM.top,
      half: SKY_LAST_PLATFORM.half,
      rewardId: SKY_LAST_PLATFORM.reward.id,
      points: SKY_LAST_PLATFORM.reward.points
    }
  },
  {
    id: 'ocean',
    name: '潮汐远征',
    style: 'ocean',
    platforms: OCEAN_COURSE_DATA.platforms,
    rotors: OCEAN_COURSE_DATA.rotors,
    goal: {
      x: OCEAN_LAST_PLATFORM.x,
      z: OCEAN_LAST_PLATFORM.z,
      top: OCEAN_LAST_PLATFORM.top,
      half: OCEAN_LAST_PLATFORM.half,
      rewardId: OCEAN_LAST_PLATFORM.reward.id,
      points: OCEAN_LAST_PLATFORM.reward.points
    }
  },
  {
    id: 'comet',
    name: '星跃追光',
    style: 'comet',
    platforms: COMET_COURSE_DATA.platforms,
    rotors: COMET_COURSE_DATA.rotors,
    goal: {
      x: COMET_LAST_PLATFORM.x,
      z: COMET_LAST_PLATFORM.z,
      top: COMET_LAST_PLATFORM.top,
      half: COMET_LAST_PLATFORM.half,
      rewardId: COMET_LAST_PLATFORM.reward.id,
      points: COMET_LAST_PLATFORM.reward.points
    }
  }
];

/* ---------------- 平台空间索引 ----------------
 * 长关合计超过 1500 台。逐帧扫描全部平台会造成无意义的碰撞与地面查询，
 * 因此静态平台按 AABB 覆盖的网格分桶，动态平台保留小列表单独检查。 */

const PLATFORM_GRID_CELL = 4;
const STATIC_PLATFORM_GRID = new Map();
const DYNAMIC_PLATFORM_GRID = new Map();
const DYNAMIC_PLATFORMS_BY_COURSE = new Map();
const LONG_COURSE_IDS = new Set(
  COURSES.filter((course) => course.platforms.length >= 500).map((course) => course.id)
);
let activePlatformCourse = 'sky';
let platformQueryToken = 0;

function addPlatformToGrid(grid, p, minX, maxX, minZ, maxZ) {
  const cellMinX = Math.floor(minX / PLATFORM_GRID_CELL);
  const cellMaxX = Math.floor(maxX / PLATFORM_GRID_CELL);
  const cellMinZ = Math.floor(minZ / PLATFORM_GRID_CELL);
  const cellMaxZ = Math.floor(maxZ / PLATFORM_GRID_CELL);
  for (let ix = cellMinX; ix <= cellMaxX; ix++) {
    for (let iz = cellMinZ; iz <= cellMaxZ; iz++) {
      const key = ix + ',' + iz;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(p);
    }
  }
}

function dynamicPlatformBounds(p) {
  const motion = p.motion;
  let minX = p.x - p.half;
  let maxX = p.x + p.half;
  let minZ = p.z - p.half;
  let maxZ = p.z + p.half;

  if (motion.type === 'orbit') {
    minX = motion.cx - motion.radius - p.half;
    maxX = motion.cx + motion.radius + p.half;
    minZ = motion.cz - motion.radius - p.half;
    maxZ = motion.cz + motion.radius + p.half;
  } else if (motion.type === 'shuttle') {
    const offsetX = Math.abs(motion.axisX * motion.amplitude);
    const offsetZ = Math.abs(motion.axisZ * motion.amplitude);
    minX = motion.x0 - offsetX - p.half;
    maxX = motion.x0 + offsetX + p.half;
    minZ = motion.z0 - offsetZ - p.half;
    maxZ = motion.z0 + offsetZ + p.half;
  } else if (motion.type === 'wave') {
    minX = motion.x0 - motion.amplitudeX - p.half;
    maxX = motion.x0 + motion.amplitudeX + p.half;
    minZ = motion.z0 - motion.amplitudeZ - p.half;
    maxZ = motion.z0 + motion.amplitudeZ + p.half;
  }

  return { minX, maxX, minZ, maxZ };
}

for (const course of COURSES) {
  const courseDynamics = [];
  DYNAMIC_PLATFORMS_BY_COURSE.set(course.id, courseDynamics);
  for (const p of course.platforms) {
    p.courseId = course.id;
    if (p.motion) {
      courseDynamics.push(p);
      const bounds = dynamicPlatformBounds(p);
      addPlatformToGrid(
        DYNAMIC_PLATFORM_GRID,
        p,
        bounds.minX,
        bounds.maxX,
        bounds.minZ,
        bounds.maxZ
      );
      continue;
    }
    addPlatformToGrid(
      STATIC_PLATFORM_GRID,
      p,
      p.x - p.half,
      p.x + p.half,
      p.z - p.half,
      p.z + p.half
    );
  }
}

function isPlatformInActiveView(p) {
  return !LONG_COURSE_IDS.has(p.courseId) || p.courseId === activePlatformCourse;
}

function collectPlatformGrid(grid, minX, maxX, minZ, maxZ, token, out) {
  for (let ix = minX; ix <= maxX; ix++) {
    for (let iz = minZ; iz <= maxZ; iz++) {
      const cell = grid.get(ix + ',' + iz);
      if (!cell) continue;
      for (const p of cell) {
        if (p._platformQueryToken === token || !isPlatformInActiveView(p)) continue;
        p._platformQueryToken = token;
        out.push(p);
      }
    }
  }
}

/**
 * 收集指定位置附近可能相交的平台。静态平台走网格，动态平台只有长关中的
 * 少量移动台，因此不需要每帧重建索引。
 */
export function collectNearbyPlatforms(x, z, padding, out) {
  out.length = 0;
  const token = ++platformQueryToken;
  const minX = Math.floor((x - padding) / PLATFORM_GRID_CELL);
  const maxX = Math.floor((x + padding) / PLATFORM_GRID_CELL);
  const minZ = Math.floor((z - padding) / PLATFORM_GRID_CELL);
  const maxZ = Math.floor((z + padding) / PLATFORM_GRID_CELL);
  collectPlatformGrid(STATIC_PLATFORM_GRID, minX, maxX, minZ, maxZ, token, out);
  collectPlatformGrid(DYNAMIC_PLATFORM_GRID, minX, maxX, minZ, maxZ, token, out);
  return out;
}

const GROUND_QUERY_SCRATCH = [];

/* ---------------- 地形高度场（角色落地与地形网格共用同一函数） ---------------- */

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function terrainHeight(x, z) {
  let h;

  if (z < -4) {
    h = (z + 4) * 0.05 - 0.05;
  } else if (z < 9) {
    const t = (z + 4) / 13;
    h = -0.05 + t * 1.25;
  } else {
    h = 1.2 + Math.min((z - 9) * 0.07, 1.3);
  }

  // 近水区减弱起伏，避免海岸线出现锯齿
  const amp = 0.05 + 0.11 * smoothstep(-2, 8, z);
  h += (Math.sin(x * 0.17) * 0.5 + Math.cos(z * 0.21) * 0.3 + Math.sin((x + z) * 0.055) * 0.7) * amp * 1.6;

  // 海岸线自然弯曲（只在水线附近生效）
  const shoreK = 1 - smoothstep(2, 13, z);
  h += (Math.sin(x * 0.05) * 0.22 + Math.sin(x * 0.017 + 1.7) * 0.34) * shoreK;

  // 房子地基找平
  const d = Math.hypot(x - 15, z - 7);
  if (d < 10) {
    const k = smoothstep(10, 4, d);
    h = h * (1 - k) + 1.5 * k;
  }
  return h;
}

/** 玩家脚下的实际地面：房屋区域取地板/实心屋顶高度，关卡平台取台面高度（单向），其余取地形 */
export function groundAt(x, z, refY = Infinity, supportOut = null, candidates = null) {
  if (supportOut) supportOut.platform = null;
  let h = terrainHeight(x, z);
  if (Math.abs(x - HOUSE.x) < HOUSE.half + 0.05 && Math.abs(z - HOUSE.z) < HOUSE.half + 0.05) {
    h = Math.max(h, HOUSE.deckTop);
    if (refY >= HOUSE.roofTop - 0.3) h = Math.max(h, HOUSE.roofTop); // 实心屋顶可站立
  }
  const nearby = candidates || collectNearbyPlatforms(x, z, 0, GROUND_QUERY_SCRATCH);
  for (const p of nearby) {
    if (p.locked) continue;
    if (Math.abs(x - p.x) < p.half && Math.abs(z - p.z) < p.half && refY >= p.top - 0.3 && p.top > h) {
      h = p.top;
      if (supportOut) supportOut.platform = p;
    }
  }
  return h;
}

/* ---------------- 天空 ---------------- */

function makeSky() {
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2e73c4) },
      midColor: { value: new THREE.Color(0x9cc9e8) },
      bottomColor: { value: new THREE.Color(0xdfeaf2) }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 c = mix(bottomColor, midColor, smoothstep(-0.01, 0.07, h));
        c = mix(c, topColor, smoothstep(0.05, 0.42, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `
  });
  return new THREE.Mesh(geo, mat);
}

/* ---------------- 地形（顶点色：湿沙 → 干沙 → 草地） ---------------- */

/** 草地噪点贴图：打破高处俯瞰时的大色块单调感 */
function makeGrassTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#8fbc7d';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2800; i++) {
    const g = 120 + Math.random() * 60;
    ctx.fillStyle = `rgb(${(g * 0.72) | 0},${g | 0},${(g * 0.58) | 0})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 65);
  return tex;
}

function makeTerrain() {
  const W = 640, D = 520, SEG_W = 240, SEG_D = 200;
  const geo = new THREE.PlaneGeometry(W, D, SEG_W, SEG_D);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const wet = new THREE.Color(PALETTE.sandWet);
  const dry = new THREE.Color(PALETTE.sandDry);
  const grass = new THREE.Color(PALETTE.grass);
  const grassDark = new THREE.Color(PALETTE.grassDark);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    const wetK = 1 - smoothstep(-3.5, 3, z);
    const grassK = smoothstep(8, 12.5, z);

    tmp.copy(dry).lerp(wet, wetK);
    const g = grass.clone().lerp(grassDark, Math.min(1, Math.max(0, Math.sin(x * 0.4 + z * 0.3) * 0.5 + 0.5)));
    tmp.lerp(g, grassK);

    const n = 0.94 + Math.sin(x * 0.9) * 0.03 + Math.cos(z * 1.1) * 0.03;
    colors[i * 3] = tmp.r * n;
    colors[i * 3 + 1] = tmp.g * n;
    colors[i * 3 + 2] = tmp.b * n;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeGrassTexture(),
    roughness: 0.94,
    metalness: 0
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/* ---------------- 海面 ---------------- */

function makeWater() {
  const geo = new THREE.PlaneGeometry(2400, 1600, 64, 40);
  geo.rotateX(-Math.PI / 2);
  const base = Float32Array.from(geo.attributes.position.array);
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.water,
    roughness: 0.72,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, WATER_LEVEL, -800);
  mesh.receiveShadow = false;
  mesh.userData.base = base;
  return mesh;
}

function updateWater(water, t) {
  if (water.userData.nextUpdate !== undefined && t < water.userData.nextUpdate) return;
  water.userData.nextUpdate = t + 1 / 30;
  const pos = water.geometry.attributes.position;
  const base = water.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const z = base[i * 3 + 2];
    const y = Math.sin(x * 0.09 + t * 1.15) * 0.16 + Math.sin(z * 0.13 + t * 0.85) * 0.13 + Math.sin((x + z) * 0.05 + t * 0.6) * 0.1;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  // 法线计算较贵，每 3 帧更新一次（视觉差异不可感知）
  water.userData.frame = (water.userData.frame || 0) + 1;
  if (water.userData.frame % 3 === 0) water.geometry.computeVertexNormals();
}

function makeFoam() {
  const geo = new THREE.PlaneGeometry(230, 5.5, 48, 3);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.foam,
    roughness: 1,
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, WATER_LEVEL + 0.05, SHORE_Z + 0.6);
  return mesh;
}

/* ---------------- 房子 ---------------- */

function box(w, h, d, color, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.8, metalness: 0 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.castShadow !== false;
  m.receiveShadow = true;
  return m;
}

function makeHouse(x, z) {
  const g = new THREE.Group();
  const y = HOUSE.base;

  // 直接着地：0.3m 木地板基座（无吊脚）
  const floorY = 0.3;
  const slab = box(7, 0.3, 7, PALETTE.wood);
  slab.position.y = 0.15;
  g.add(slab);

  /* ---- 四面墙（前墙留门洞，门可开合进入）---- */
  const WH = 3.1;   // 墙高
  const WT = 0.22;  // 墙厚
  const wallY = floorY + WH / 2;
  const occluders = []; // 相机防穿墙射线检测体

  // 前墙左右两段（中间 1.4 宽门洞）
  for (const cx of [-1.85, 1.85]) {
    const seg = box(2.3, WH, WT, PALETTE.wood);
    seg.position.set(cx, wallY, -3 + WT / 2);
    g.add(seg);
    occluders.push(seg);
  }
  // 门洞上方横梁
  const lintel = box(1.4, WH - 2.15, WT, PALETTE.wood);
  lintel.position.set(0, floorY + 2.15 + (WH - 2.15) / 2, -3 + WT / 2);
  g.add(lintel);
  occluders.push(lintel);

  // 后墙与左右墙
  const back = box(6, WH, WT, PALETTE.wood);
  back.position.set(0, wallY, 3 - WT / 2);
  g.add(back);
  occluders.push(back);
  for (const cx of [-3 + WT / 2, 3 - WT / 2]) {
    const side = box(WT, WH, 6 - WT * 2, PALETTE.wood);
    side.position.set(cx, wallY, 0);
    g.add(side);
    occluders.push(side);
  }

  // 平屋顶（实体，可从关卡落上站立）+ 四面女儿墙
  const roofY = floorY + WH;
  const roofSlab = box(6.4, 0.25, 6.4, PALETTE.woodDark);
  roofSlab.position.y = roofY + 0.125;
  g.add(roofSlab);
  occluders.push(roofSlab);
  for (const [rx, rz, rw, rd] of [[0, -3.08, 6.4, 0.25], [0, 3.08, 6.4, 0.25], [-3.08, 0, 0.25, 6.4], [3.08, 0, 0.25, 6.4]]) {
    const parapet = box(rw, 0.45, rd, PALETTE.wood);
    parapet.position.set(rx, roofY + 0.25 + 0.225, rz);
    g.add(parapet);
  }

  /* ---- 门（可绕左侧门轴旋转）---- */
  const doorPivot = new THREE.Group();
  doorPivot.userData.animated = true;
  doorPivot.position.set(-0.7, floorY, -3.02);
  const door = box(1.4, 2.1, 0.1, PALETTE.woodDark);
  door.position.set(0.7, 1.05, 0);
  doorPivot.add(door);
  occluders.push(door);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.35, metalness: 0.6 })
  );
  knob.position.set(1.22, 1.02, -0.08);
  doorPivot.add(knob);
  g.add(doorPivot);

  // 前墙窗（微微发光）
  for (const cx of [-1.85, 1.85]) {
    const win = box(1.1, 0.95, 0.1, 0xbde2f2);
    win.material.roughness = 0.3;
    win.material.metalness = 0.15;
    win.material.emissive = new THREE.Color(0xffd9a0);
    win.material.emissiveIntensity = 0.55;
    win.position.set(cx, floorY + 1.85, -3.04);
    g.add(win);
  }

  // 门口台阶
  const step = box(2.4, 0.35, 1.2, PALETTE.wood);
  step.position.set(0, 0.15, -3.6);
  g.add(step);

  const chimney = box(0.75, 2.0, 0.75, 0x9c6b52);
  chimney.position.set(2.2, roofY + 1.0, 1.4);
  g.add(chimney);

  /* ---- 室内布置 ---- */
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 28),
    new THREE.MeshStandardMaterial({ color: 0xc25b45, roughness: 0.95 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, floorY + 0.02, 0.5);
  rug.receiveShadow = true;
  g.add(rug);

  const tableTop = box(1.35, 0.08, 0.85, PALETTE.wood);
  tableTop.position.set(-1.4, floorY + 0.62, 1.3);
  g.add(tableTop);
  const tableLeg = box(0.12, 0.62, 0.12, PALETTE.woodDark);
  tableLeg.position.set(-1.4, floorY + 0.31, 1.3);
  g.add(tableLeg);
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.5 })
  );
  cup.position.set(-1.35, floorY + 0.72, 1.25);
  g.add(cup);

  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.26, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xe8c98a, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xffb347, emissiveIntensity: 0.7 })
  );
  lampShade.position.set(0, floorY + 2.55, 0);
  g.add(lampShade);

  const lampBulb = new THREE.PointLight(0xffc879, 1.5, 9, 1.6);
  lampBulb.position.set(0, floorY + 2.3, 0);
  lampBulb.castShadow = true;
  lampBulb.shadow.mapSize.set(512, 512);
  g.add(lampBulb);

  g.position.set(x, y, z);
  return { group: g, doorPivot, occluders };
}

/* ---------------- 棕榈树 ---------------- */

function makePalm(x, z, scale = 1, rot = 0) {
  const g = new THREE.Group();
  const trunkH = 5.2 * scale;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, trunkH, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 0.9 })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({
    color: PALETTE.palmLeaf,
    roughness: 0.8,
    side: THREE.DoubleSide,
    flatShading: true
  });

  const leafCount = 9;
  for (let i = 0; i < leafCount; i++) {
    const len = 3.6 * scale;
    const geo = new THREE.PlaneGeometry(0.8 * scale, len, 1, 4);
    geo.translate(0, len / 2, 0);
    const leaf = new THREE.Mesh(geo, leafMat);
    const a = (i / leafCount) * Math.PI * 2 + 0.35;
    leaf.position.set(0, trunkH + 0.08 * scale, 0);
    leaf.rotateY(a);
    leaf.rotateX(-0.62 - (i % 3) * 0.14);
    leaf.castShadow = true;
    g.add(leaf);
  }

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(0.42 * scale, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4b2f, roughness: 0.9 })
  );
  crown.position.y = trunkH + 0.1 * scale;
  g.add(crown);

  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = rot;
  return g;
}

/* ---------------- 石头 / 灌木 / 杂物 ---------------- */

function makeRock(x, z, r, yOverride) {
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const pos = geo.attributes.position;
  // 确定性位置噪声：IcosahedronGeometry 是非索引几何体（顶点按面复制），
  // 逐顶点独立随机会把共享棱撕开（石头"散架"）。相同坐标必须得到相同位移。
  const jitter = (x0, y0, z0) => {
    const s = Math.sin(x0 * 12.9898 + y0 * 78.233 + z0 * 37.719) * 43758.5453;
    return s - Math.floor(s); // [0, 1)
  };
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i), y0 = pos.getY(i), z0 = pos.getZ(i);
    const k = 0.82 + jitter(x0, y0, z0) * 0.36;
    pos.setXYZ(i, x0 * k, y0 * k * 0.8, z0 * k);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.rock, roughness: 0.95, flatShading: true }));
  const y = yOverride !== undefined ? yOverride : terrainHeight(x, z) + r * 0.45;
  mesh.position.set(x, y, z);
  mesh.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.3);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBush(x, z, s) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.grass).clone().offsetHSL(0, 0.02, -0.06),
    roughness: 0.92,
    flatShading: true
  });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s * (0.7 + Math.random() * 0.4), 0), mat);
    b.position.set((Math.random() - 0.5) * s * 0.9, s * 0.55, (Math.random() - 0.5) * s * 0.9);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }
  g.position.set(x, terrainHeight(x, z), z);
  return g;
}

function makeUmbrella(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.6 })
  );
  pole.position.y = 1.25;
  pole.castShadow = true;
  g.add(pole);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(1.75, 0.75, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.umbrella, roughness: 0.75, flatShading: true })
  );
  canopy.position.y = 2.45;
  canopy.castShadow = true;
  g.add(canopy);

  const towel = box(1.6, 0.09, 1.1, 0x5fa8d3);
  towel.position.set(1.5, 0.05, 0.9);
  towel.rotation.y = 0.3;
  g.add(towel);

  g.position.set(x, terrainHeight(x, z), z);
  return g;
}

function makeCrate(x, z, s, rot) {
  const c = box(s, s, s, PALETTE.crate + 0);
  c.material.color = new THREE.Color(PALETTE.crate);
  c.position.set(x, terrainHeight(x, z) + s / 2, z);
  c.rotation.y = rot;
  return c;
}

function makeBall(x, z) {
  const b = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.55 })
  );
  b.position.set(x, terrainHeight(x, z) + 0.45, z);
  b.castShadow = true;
  return b;
}

function makeSign(x, z) {
  const g = new THREE.Group();
  const post = box(0.16, 2.1, 0.16, PALETTE.woodDark);
  post.position.y = 1.05;
  g.add(post);
  const board = box(1.9, 0.8, 0.12, 0xe9d3a6);
  board.position.y = 2.0;
  g.add(board);
  const board2 = box(1.9, 0.8, 0.12, PALETTE.wood);
  board2.position.set(0, 2.0, 0.13);
  board2.scale.set(0.86, 0.7, 1);
  g.add(board2);
  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = 0.5;
  return g;
}

function makeFence(x0, z0, x1, z1, count) {
  const g = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.85 });
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 7), railMat);
    post.position.set(px, terrainHeight(px, pz) + 0.75, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);
  }
  return g;
}

/* ---------------- 低多边形云 ---------------- */

function makeCloud(x, y, z, s) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const r = s * (0.55 + Math.random() * 0.5);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    b.position.set(
      (i - n / 2) * s * 0.95 + (Math.random() - 0.5) * s * 0.4,
      (Math.random() - 0.5) * s * 0.35,
      (Math.random() - 0.5) * s * 0.6
    );
    b.scale.y = 0.55 + Math.random() * 0.15;
    g.add(b);
  }
  g.position.set(x, y, z);
  g.userData.speed = 0.25 + Math.random() * 0.35;
  return g;
}

/* ---------------- 沙滩细节：贝壳 / 海星 / 小石子 ---------------- */

function makeBeachDetail(x, z) {
  const g = new THREE.Group();
  const kind = Math.random();
  if (kind < 0.4) {
    // 扇贝：压扁五棱锥
    const s = 0.09 + Math.random() * 0.05;
    const shell = new THREE.Mesh(
      new THREE.ConeGeometry(s, s * 0.6, 5),
      new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0xf2e4d0 : 0xe8c8b8, roughness: 0.75 })
    );
    shell.scale.y = 0.45;
    shell.rotation.y = Math.random() * Math.PI;
    shell.castShadow = true;
    g.add(shell);
  } else if (kind < 0.72) {
    // 海星：橙色五角小凸台
    const s = 0.1 + Math.random() * 0.05;
    const star = new THREE.Mesh(
      new THREE.ConeGeometry(s, s * 0.5, 5),
      new THREE.MeshStandardMaterial({ color: 0xe2836b, roughness: 0.85, flatShading: true })
    );
    star.scale.y = 0.5;
    star.rotation.y = Math.random() * Math.PI;
    star.castShadow = true;
    g.add(star);
  } else {
    // 小石子
    const s = 0.05 + Math.random() * 0.04;
    const pebble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 0),
      new THREE.MeshStandardMaterial({ color: 0xb9a98e, roughness: 0.95, flatShading: true })
    );
    pebble.scale.y = 0.6;
    pebble.castShadow = true;
    g.add(pebble);
  }
  g.position.set(x, terrainHeight(x, z) + 0.02, z);
  return g;
}

/* ---------------- 草丛（草地上的小簇） ---------------- */

function makeGrassTuft(x, z) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const h = 0.3 + Math.random() * 0.25;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, h, 4),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x6da35c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06),
        roughness: 0.9, flatShading: true
      })
    );
    blade.position.set((Math.random() - 0.5) * 0.28, h / 2, (Math.random() - 0.5) * 0.28);
    blade.rotation.z = (Math.random() - 0.5) * 0.5;
    blade.rotation.x = (Math.random() - 0.5) * 0.5;
    blade.castShadow = true;
    g.add(blade);
  }
  g.position.set(x, terrainHeight(x, z), z);
  return g;
}

/* ---------------- 沙堡 ---------------- */

function makeSandcastle(x, z) {
  const g = new THREE.Group();
  const sand = new THREE.MeshStandardMaterial({ color: 0xe6c896, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.5, 8), sand);
  base.position.y = 0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  for (const [tx, tz, tr] of [[0, 0, 0.5], [-0.55, 0.42, 0.32], [0.55, 0.42, 0.32]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(tr * 0.78, tr, 0.85, 8), sand);
    t.position.set(tx, 0.92, tz);
    t.castShadow = true;
    g.add(t);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(tr * 1.15, 0.38, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a86c, roughness: 0.9, flatShading: true })
    );
    roof.position.set(tx, 1.54, tz);
    roof.castShadow = true;
    g.add(roof);
  }
  // 主塔小红旗
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5),
    new THREE.MeshStandardMaterial({ color: 0x8a5f3a, roughness: 0.8 })
  );
  pole.position.set(0, 1.95, 0);
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.13),
    new THREE.MeshStandardMaterial({ color: 0xe2504a, side: THREE.DoubleSide, roughness: 0.7 })
  );
  flag.position.set(0.11, 2.1, 0);
  g.add(flag);
  g.position.set(x, terrainHeight(x, z), z);
  g.rotation.y = 0.4;
  return g;
}

/* ---------------- 海鸥（绕圈飞行，翅膀扇动） ---------------- */

function makeGull() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.8, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 5), mat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), mat);
  wl.position.x = -0.3;
  g.add(wl);
  const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), mat);
  wr.position.x = 0.3;
  g.add(wr);
  g.userData.wings = [wl, wr];
  return g;
}

/* ---------------- 小螃蟹（沙滩横行） ---------------- */

function makeCrab(x, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd95f43, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat);
  body.scale.set(1.4, 0.65, 1);
  body.castShadow = true;
  g.add(body);
  for (const s of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat);
    claw.position.set(s * 0.23, 0.02, 0.1);
    claw.scale.set(1.2, 0.8, 1.4);
    claw.castShadow = true;
    g.add(claw);
  }
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 0.16),
        new THREE.MeshStandardMaterial({ color: 0xc04f36, roughness: 0.85 })
      );
      leg.position.set(s * 0.16, -0.02, -0.08 + i * 0.08);
      leg.rotation.y = s * 0.5;
      g.add(leg);
    }
  }
  g.position.set(x, terrainHeight(x, z) + 0.09, z);
  g.userData = { x0: x, baseY: g.position.y, range: 0.9 + Math.random() * 0.8, speed: 0.4 + Math.random() * 0.35, phase: Math.random() * 6 };
  return g;
}

/* ---------------- 海面小木船（随波轻摇） ---------------- */

function makeBoat(x, z) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.85 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 2.2), wood);
  hull.castShadow = true;
  g.add(hull);
  const cavity = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.18, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x8a5f3a, roughness: 0.9 })
  );
  cavity.position.y = 0.1;
  g.add(cavity);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.18), wood);
  bench.position.y = 0.2;
  g.add(bench);
  for (const s of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0x9c6b52, roughness: 0.85 }));
    oar.position.set(s * 0.42, 0.16, 0.25);
    oar.rotation.y = s * 0.35;
    g.add(oar);
  }
  g.position.set(x, WATER_LEVEL + 0.08, z);
  g.rotation.y = 0.7;
  return g;
}

/* ---------------- 太阳（本体 + 光晕贴图） ---------------- */

function makeSun() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(11, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff7d6, fog: false })
  );
  g.add(core);

  // 径向渐变光晕贴图（加色混合，越远越透）
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,246,205,0.95)');
  grad.addColorStop(0.22, 'rgba(255,228,150,0.55)');
  grad.addColorStop(0.55, 'rgba(255,212,120,0.16)');
  grad.addColorStop(1, 'rgba(255,205,115,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true
  }));
  glow.scale.set(160, 160, 1);
  g.add(glow);

  g.position.set(212, 262, 167); // 与主光方向一致
  return g;
}

/* ---------------- 远景：海岛与山脉剪影（填满地平线） ---------------- */

function makeIslands() {
  const g = new THREE.Group();
  const sand = new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 1, flatShading: true });
  const green = new THREE.MeshStandardMaterial({ color: 0x6f9c5c, roughness: 1, flatShading: true });
  const defs = [
    { x: -180, z: -330, r: 46, h: 16 },
    { x: 60, z: -400, r: 60, h: 22 },
    { x: 240, z: -300, r: 40, h: 13 },
    { x: -320, z: -240, r: 34, h: 10 }
  ];
  for (const d of defs) {
    const base = new THREE.Mesh(new THREE.ConeGeometry(d.r, d.h, 7), sand);
    base.position.set(d.x, d.h / 2 - 3, d.z);
    g.add(base);
    const top = new THREE.Mesh(new THREE.ConeGeometry(d.r * 0.55, d.h * 0.5, 7), green);
    top.position.set(d.x, d.h - 1, d.z);
    g.add(top);
  }
  return g;
}

function makeFarMountains() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9fb2c4, roughness: 1, flatShading: true });
  const defs = [
    { x: -450, z: -160, r: 90, h: 70 },
    { x: 460, z: -200, r: 100, h: 85 }
  ];
  for (let i = 0; i < 9; i++) {
    defs.push({ x: -420 + i * 105 + (i % 2) * 30, z: -460 - (i % 3) * 40, r: 70 + (i % 4) * 22, h: 55 + (i % 3) * 28 });
  }
  for (const d of defs) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(d.r, d.h, 6), mat);
    m.position.set(d.x, d.h / 2 - 6, d.z);
    g.add(m);
  }
  return g;
}

/* ---------------- 炊烟（烟囱缓升） ---------------- */

function makeSmoke(x, y, z) {
  const puffs = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 + i * 0.05, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0xdadad4, transparent: true, opacity: 0.4, roughness: 1 })
    );
    m.userData = { t: i / 5, x0: x, y0: y, z0: z };
    m.userData.animated = true;
    puffs.push(m);
  }
  return puffs;
}

/* ---------------- 蝴蝶（草丛上空游荡） ---------------- */

function makeButterfly(x, z) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf0b848, side: THREE.DoubleSide });
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), mat);
  wl.position.x = -0.08;
  g.add(wl);
  const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), mat);
  wr.position.x = 0.08;
  g.add(wr);
  g.userData = { wings: [wl, wr], x0: x, z0: z, y0: terrainHeight(x, z) + 1.0, phase: Math.random() * 6.28, animated: true };
  return g;
}

/* ---------------- 脚步扬尘（沙地行走反馈） ---------------- */

function makeDustPool() {
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xead9b6, transparent: true, opacity: 0, roughness: 1 })
    );
    m.visible = false;
    m.userData = { t: 1, animated: true };
    pool.push(m);
  }
  return pool;
}

/* ---------------- 屋顶观景台灯柱 ---------------- */

function makeLantern(x, y, z) {
  const g = new THREE.Group();
  const pole = box(0.09, 0.95, 0.09, PALETTE.woodDark);
  pole.position.y = y + 0.475;
  g.add(pole);
  const lamp = box(0.17, 0.2, 0.17, 0xffe2a8);
  lamp.material.emissive = new THREE.Color(0xffc879);
  lamp.material.emissiveIntensity = 1.3;
  lamp.position.y = y + 1.05;
  g.add(lamp);
  const cap = box(0.24, 0.05, 0.24, PALETTE.woodDark);
  cap.position.y = y + 1.18;
  g.add(cap);
  return g;
}

/* ---------------- 水波涟漪 ---------------- */

function makeRipples() {
  const pool = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.34, 26),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.userData.t = 1;
    pool.push(m);
  }
  return pool;
}

/* ---------------- 500 台长关视觉（InstancedMesh 保性能） ---------------- */

function makeSkyChest(def, p, index) {
  const ocean = def.style === 'ocean';
  const comet = def.style === 'comet';
  const lidPivot = new THREE.Group();
  lidPivot.userData.animated = true;
  const beam = new THREE.Object3D();
  beam.material = { opacity: p.isGoal ? 0.2 : 0.14 };
  beam.scale.y = 1;
  const beamColor = comet
    ? (p.isGoal ? 0xffdf8a : 0x7df4e4)
    : ocean
      ? (p.isGoal ? 0xb8fff1 : 0x72e6d5)
      : (p.isGoal ? 0xffe59a : 0xffc85a);

  return {
    id: p.reward.id,
    courseId: def.id,
    stage: p.reward.stage,
    stageName: p.reward.stageName,
    points: p.reward.points,
    final: p.reward.final,
    platform: p,
    angle: (index * 0.73) % (Math.PI * 2),
    chestScale: p.isGoal ? 1.18 : 0.86,
    lidPivot,
    beam,
    beamColor,
    beamHeightAtRest: p.isGoal ? 4.8 : 2.8,
    opened: false,
    openT: -1
  };
}

function addSkyChestInstances(group, rewards) {
  const count = rewards.length;
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const quatX = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const pos = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const pedestal = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.76, 0.84, 1, 18),
    new THREE.MeshStandardMaterial({
      color: 0x7d5d28,
      roughness: 0.45,
      metalness: 0.45,
      emissive: 0x3b2808,
      emissiveIntensity: 0.35
    }),
    count
  );
  const body = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.8 }),
    count
  );
  const lock = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshStandardMaterial({
      color: 0xffcf58,
      roughness: 0.24,
      metalness: 0.78,
      emissive: 0x6b4308,
      emissiveIntensity: 0.4
    }),
    count
  );
  const bands = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.78 }),
    count * 2
  );
  const lids = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshStandardMaterial({ color: 0xd6a33b, roughness: 0.42, metalness: 0.32 }),
    count
  );
  const beamGeometry = new THREE.CylinderGeometry(0.12, 0.24, 1, 12, 1, true);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const beams = new THREE.InstancedMesh(beamGeometry, beamMaterial, count);
  lids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const setPartMatrix = (mesh, index, reward, localX, localY, localZ, sx, sy, sz) => {
    const { platform } = reward;
    const s = reward.chestScale;
    quat.setFromAxisAngle(yAxis, reward.angle);
    offset.set(localX, localY, localZ).multiplyScalar(s).applyQuaternion(quat);
    pos.set(platform.x + offset.x, platform.top + offset.y, platform.z + offset.z);
    scale.set(sx * s, sy * s, sz * s);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(index, matrix);
  };

  rewards.forEach((reward, index) => {
    const { platform } = reward;
    setPartMatrix(pedestal, index, reward, 0, 0.04, 0, platform.half, 0.1, platform.half);
    setPartMatrix(body, index, reward, 0, 0.27, 0, 0.94, 0.5, 0.66);
    setPartMatrix(lock, index, reward, 0, 0.5, 0.35, 0.13, 0.17, 0.06);
    setPartMatrix(bands, index * 2, reward, -0.34, 0.27, 0, 0.055, 0.51, 0.69);
    setPartMatrix(bands, index * 2 + 1, reward, 0.34, 0.27, 0, 0.055, 0.51, 0.69);
    beams.setColorAt(index, color.setHex(reward.beamColor));
  });

  pedestal.instanceMatrix.needsUpdate = true;
  body.instanceMatrix.needsUpdate = true;
  lock.instanceMatrix.needsUpdate = true;
  bands.instanceMatrix.needsUpdate = true;
  beams.instanceColor.needsUpdate = true;
  pedestal.receiveShadow = true;
  group.add(pedestal, body, lock, bands, lids, beams);

  return () => {
    rewards.forEach((reward, index) => {
      const { platform } = reward;
      const s = reward.chestScale;
      quatX.setFromAxisAngle(xAxis, reward.lidPivot.rotation.x);
      offset.set(0, 0.085, 0.33).applyQuaternion(quatX);
      offset.y += 0.52;
      offset.z -= 0.33;
      offset.multiplyScalar(s).applyQuaternion(quat.setFromAxisAngle(yAxis, reward.angle));
      pos.set(platform.x + offset.x, platform.top + offset.y, platform.z + offset.z);
      scale.set(0.94 * s, 0.17 * s, 0.66 * s);
      quatX.setFromAxisAngle(xAxis, reward.lidPivot.rotation.x);
      quat.setFromAxisAngle(yAxis, reward.angle).multiply(quatX);
      matrix.compose(pos, quat, scale);
      lids.setMatrixAt(index, matrix);

      const beamVisible = reward.beam.visible !== false && !reward.opened;
      const pulse = Math.max(0.01, reward.beam.scale.y || 1);
      offset.set(0, reward.beamHeightAtRest / 2, 0).applyQuaternion(
        quat.setFromAxisAngle(yAxis, reward.angle)
      );
      pos.set(platform.x + offset.x, platform.top + offset.y, platform.z + offset.z);
      scale.set(
        platform.isGoal ? 1.42 : 1,
        beamVisible ? reward.beamHeightAtRest * pulse : 0.001,
        platform.isGoal ? 1.42 : 1
      );
      matrix.compose(pos, quat, scale);
      beams.setMatrixAt(index, matrix);
    });
    lids.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  };
}

function addSkyStaticInstances(group, entries) {
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.34 });
  const decks = new THREE.InstancedMesh(unitBox, deckMat, entries.length);
  const trims = new THREE.InstancedMesh(unitBox, trimMat, entries.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const refresh = () => {
    entries.forEach(({ p, yaw }, i) => {
      const size = p.locked ? 0.72 : 1;
      quat.setFromEuler(new THREE.Euler(0, yaw, 0));
      pos.set(p.x, p.top - 0.12, p.z);
      scale.set(p.half * 2 * size, 0.24, p.half * 2 * size);
      matrix.compose(pos, quat, scale);
      decks.setMatrixAt(i, matrix);
      decks.setColorAt(i, color.setHex(p.locked ? 0x4b5560 : (p.dashPad ? 0x397f82 : p.deckColor)));

      pos.set(p.x, p.top + 0.015, p.z);
      scale.set(
        Math.max(0.2, (p.half * 2 - 0.07) * size),
        0.05,
        Math.max(0.2, (p.half * 2 - 0.07) * size)
      );
      matrix.compose(pos, quat, scale);
      trims.setMatrixAt(i, matrix);
      trims.setColorAt(i, color.setHex(p.locked ? 0x6d7883 : p.trimColor));
    });
    decks.instanceMatrix.needsUpdate = true;
    trims.instanceMatrix.needsUpdate = true;
    decks.instanceColor.needsUpdate = true;
    trims.instanceColor.needsUpdate = true;
  };

  refresh();

  decks.instanceMatrix.needsUpdate = true;
  trims.instanceMatrix.needsUpdate = true;
  decks.receiveShadow = true;
  trims.receiveShadow = true;
  group.add(decks, trims);
  return refresh;
}

function addSkyDynamicInstances(group, entries) {
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.34 });
  const spineMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.8 });
  const decks = new THREE.InstancedMesh(unitBox, deckMat, entries.length);
  const trims = new THREE.InstancedMesh(unitBox, trimMat, entries.length);
  const spines = new THREE.InstancedMesh(unitBox, spineMat, entries.length);
  decks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trims.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  spines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  let lastVisualTime = -Infinity;
  let colorDirty = false;

  const update = (time, force = false) => {
    if (!force && time - lastVisualTime < 1 / 30) return;
    lastVisualTime = time;
    entries.forEach(({ p }, index) => {
      const yaw = p.motion.type === 'orbit'
        ? -time * p.motion.speed + p.motion.phase * 0.18
        : Math.sin(time * 0.9 + p.number * 0.3) * 0.08;
      quat.setFromAxisAngle(yAxis, yaw);
      const size = p.locked ? 0.72 : 1;

      pos.set(p.x, p.top - 0.12, p.z);
      scale.set(p.half * 2 * size, 0.24, p.half * 2 * size);
      matrix.compose(pos, quat, scale);
      decks.setMatrixAt(index, matrix);

      pos.set(p.x, p.top + 0.015, p.z);
      scale.set(
        Math.max(0.2, (p.half * 2 - 0.07) * size),
        0.05,
        Math.max(0.2, (p.half * 2 - 0.07) * size)
      );
      matrix.compose(pos, quat, scale);
      trims.setMatrixAt(index, matrix);

      pos.set(p.x, p.top - 0.4, p.z);
      scale.set(0.1, 0.34, 0.1);
      matrix.compose(pos, quat, scale);
      spines.setMatrixAt(index, matrix);
      if (p._visualLocked !== p.locked || p._visualDashPad !== p.dashPad) {
        decks.setColorAt(index, color.setHex(p.locked ? 0x4b5560 : (p.dashPad ? 0x397f82 : p.deckColor)));
        trims.setColorAt(index, color.setHex(p.locked ? 0x6d7883 : p.trimColor));
        p._visualLocked = p.locked;
        p._visualDashPad = p.dashPad;
        colorDirty = true;
      }
    });
    decks.instanceMatrix.needsUpdate = true;
    trims.instanceMatrix.needsUpdate = true;
    spines.instanceMatrix.needsUpdate = true;
    if (colorDirty) {
      decks.instanceColor.needsUpdate = true;
      trims.instanceColor.needsUpdate = true;
      colorDirty = false;
    }
  };

  update(0, true);
  decks.receiveShadow = true;
  trims.receiveShadow = true;
  group.add(decks, trims, spines);
  return update;
}

function addSkyRotorInstances(group, rotors, style = 'sky') {
  if (!rotors.length) return;

  const cage = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 24, 4, true),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.13,
      depthWrite: false
    }),
    rotors.length
  );
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, 0.075, 1, 10),
    new THREE.MeshStandardMaterial({ color: 0x667381, roughness: 0.52, metalness: 0.5 }),
    rotors.length
  );
  const caps = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.16, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    rotors.length
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  rotors.forEach((rotor, index) => {
    const centerY = (rotor.minTop + rotor.maxTop) / 2;
    const height = Math.max(0.8, rotor.maxTop - rotor.minTop);
    const accent = style === 'comet'
      ? (rotor.speed < 0 ? 0xff9b79 : 0x7ff1dc)
      : style === 'ocean'
        ? (rotor.speed < 0 ? 0x73ddd7 : 0x8ee2bd)
        : (rotor.speed < 0 ? 0x79c8ff : 0xffae70);

    pos.set(rotor.x, centerY, rotor.z);
    quat.identity();
    scale.set(rotor.radius, height, rotor.radius);
    matrix.compose(pos, quat, scale);
    cage.setMatrixAt(index, matrix);
    cage.setColorAt(index, color.setHex(accent));

    const poleHeight = height + 0.45;
    scale.set(1, poleHeight, 1);
    matrix.compose(pos, quat, scale);
    poles.setMatrixAt(index, matrix);

    pos.set(rotor.x, centerY + height / 2 + 0.22, rotor.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    caps.setMatrixAt(index, matrix);
    caps.setColorAt(index, color.setHex(accent));
  });

  cage.instanceMatrix.needsUpdate = true;
  cage.instanceColor.needsUpdate = true;
  poles.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  caps.instanceColor.needsUpdate = true;
  group.add(cage, poles, caps);
}

function addOceanProps(group, platforms) {
  const entries = [];
  const supportItems = [];
  const markerItems = [];
  const byKind = new Map();
  for (const p of platforms) {
    if (p.motion || p.reward) continue;
    entries.push(p);
    if (p.prop !== 'whale') supportItems.push(p);
    if (p.number % 5 === 1) markerItems.push(p);
    if (!byKind.has(p.prop)) byKind.set(p.prop, []);
    byKind.get(p.prop).push(p);
  }

  const makeGeometry = (kind) => {
    if (kind === 'buoy') return new THREE.CylinderGeometry(0.13, 0.19, 0.42, 10);
    if (kind === 'lily') return new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14);
    if (kind === 'coral') return new THREE.ConeGeometry(0.18, 0.48, 7);
    if (kind === 'crate') return new THREE.BoxGeometry(0.3, 0.28, 0.3);
    if (kind === 'wreck') return new THREE.BoxGeometry(0.62, 0.16, 0.3);
    if (kind === 'whale') return new THREE.SphereGeometry(0.3, 9, 7);
    if (kind === 'gate') return new THREE.TorusGeometry(0.26, 0.035, 6, 14);
    if (kind === 'lamp') return new THREE.CylinderGeometry(0.035, 0.05, 0.72, 8);
    return new THREE.SphereGeometry(0.18, 8, 6);
  };
  const propColors = {
    buoy: [0xef6b57, 0xf2e6c9],
    lily: [0x67b87d, 0x93d18e],
    coral: [0xef8a68, 0xe7b56d],
    crate: [0x9b714b, 0xb98957],
    wreck: [0x7b5e47, 0x9a7656],
    shell: [0xe9c9ad, 0xf4e4d0],
    whale: [0x5d8097, 0x79a1b3],
    gate: [0x7ddccc, 0xe8c765],
    lamp: [0xe7c46a, 0x9de3d4]
  };
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  for (const [kind, items] of byKind) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: kind === 'gate' || kind === 'lamp' ? 0.38 : 0.05,
      side: kind === 'gate' ? THREE.DoubleSide : THREE.FrontSide
    });
    const mesh = new THREE.InstancedMesh(makeGeometry(kind), material, items.length);
    const palette = propColors[kind] || [0xb8c4d2, 0xdbe4ea];
    items.forEach((p, index) => {
      const angle = p.number * 1.71;
      const offset = p.half * 0.55;
      const propY = kind === 'lily' ? 0.04 : kind === 'gate' ? 0.32 : kind === 'lamp' ? 0.36 : 0.22;
      quat.setFromAxisAngle(yAxis, angle * 0.7);
      pos.set(p.x + Math.cos(angle) * offset, p.top + propY, p.z + Math.sin(angle) * offset);
      scale.set(1, kind === 'whale' ? 0.58 : 1, kind === 'whale' ? 1.55 : 1);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.setHex(palette[index % palette.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const supportMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6f5946, roughness: 0.9 }),
    supportItems.length
  );
  supportItems.forEach((p, index) => {
    const height = Math.max(0.35, p.top + 0.32);
    quat.identity();
    pos.set(p.x, p.top - height / 2, p.z);
    scale.set(0.075, height, 0.075);
    matrix.compose(pos, quat, scale);
    supportMesh.setMatrixAt(index, matrix);
  });
  supportMesh.instanceMatrix.needsUpdate = true;
  supportMesh.receiveShadow = true;
  group.add(supportMesh);

  const markerMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.13, 0.34, 3),
    new THREE.MeshBasicMaterial({ color: 0xffdf7a }),
    markerItems.length
  );
  markerItems.forEach((p, index) => {
    euler.set(Math.PI / 2, p.routeYaw || 0, 0, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(p.x, p.top + 0.16, p.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    markerMesh.setMatrixAt(index, matrix);
  });
  markerMesh.instanceMatrix.needsUpdate = true;
  group.add(markerMesh);
}

function addCometProps(group, platforms) {
  const chargePads = [];
  const gateItems = [];
  const sparkItems = [];
  const arrowItems = [];
  for (const p of platforms) {
    if (p.reward) continue;
    if (p.dashPad) chargePads.push(p);
    if (p.number % 4 === 2) gateItems.push(p);
    if (p.number % 3 === 1) sparkItems.push(p);
    if (p.number % 5 === 1) arrowItems.push(p);
  }
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  const padMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.62, 0.72, 0.08, 20),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.68,
      emissive: 0x174e52,
      emissiveIntensity: 0.75
    }),
    chargePads.length
  );
  chargePads.forEach((p, index) => {
    quat.identity();
    pos.set(p.x, p.top + 0.07, p.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    padMesh.setMatrixAt(index, matrix);
    padMesh.setColorAt(index, color.setHex(index % 2 ? 0x83f4df : 0x68cfe2));
  });
  padMesh.instanceMatrix.needsUpdate = true;
  padMesh.instanceColor.needsUpdate = true;
  padMesh.receiveShadow = true;
  group.add(padMesh);

  const padRing = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.72, 0.045, 6, 22),
    new THREE.MeshBasicMaterial({ color: 0xb9fff2, transparent: true, opacity: 0.82, depthWrite: false }),
    chargePads.length
  );
  chargePads.forEach((p, index) => {
    quat.setFromAxisAngle(xAxis, Math.PI / 2);
    pos.set(p.x, p.top + 0.12, p.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    padRing.setMatrixAt(index, matrix);
  });
  padRing.instanceMatrix.needsUpdate = true;
  group.add(padRing);

  const gateMesh = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.64, 0.04, 6, 18),
    new THREE.MeshBasicMaterial({
      color: 0xf3d176,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    }),
    gateItems.length
  );
  gateItems.forEach((p, index) => {
    euler.set(0, Math.PI / 2 - (p.routeYaw || 0), 0, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(p.x, p.top + 0.92, p.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    gateMesh.setMatrixAt(index, matrix);
    gateMesh.setColorAt(index, color.setHex(index % 2 ? 0xf3d176 : 0x9eeedc));
  });
  gateMesh.instanceMatrix.needsUpdate = true;
  gateMesh.instanceColor.needsUpdate = true;
  group.add(gateMesh);

  const sparkMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.075, 0),
    new THREE.MeshBasicMaterial({ color: 0xbffdf2, transparent: true, opacity: 0.9, depthWrite: false }),
    sparkItems.length
  );
  sparkItems.forEach((p, index) => {
    const phase = p.number * 1.37;
    quat.setFromAxisAngle(yAxis, phase);
    pos.set(
      p.x + Math.cos(phase) * p.half * 0.55,
      p.top + 0.5 + Math.sin(phase * 1.8) * 0.18,
      p.z + Math.sin(phase) * p.half * 0.55
    );
    const s = 0.82 + (p.number % 3) * 0.25;
    scale.setScalar(s);
    matrix.compose(pos, quat, scale);
    sparkMesh.setMatrixAt(index, matrix);
  });
  sparkMesh.instanceMatrix.needsUpdate = true;
  group.add(sparkMesh);

  const arrowMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.12, 0.38, 3),
    new THREE.MeshBasicMaterial({ color: 0x8ff4df }),
    arrowItems.length
  );
  arrowItems.forEach((p, index) => {
    euler.set(Math.PI / 2, p.routeYaw || 0, 0, 'YXZ');
    quat.setFromEuler(euler);
    pos.set(p.x, p.top + 0.16, p.z);
    scale.set(1, 1, 1);
    matrix.compose(pos, quat, scale);
    arrowMesh.setMatrixAt(index, matrix);
  });
  arrowMesh.instanceMatrix.needsUpdate = true;
  group.add(arrowMesh);
}

function makeLongConfetti(group) {
  const count = 42;
  const colors = [0xffd66b, 0xff8f6b, 0x79c8ff, 0x9ce1c4, 0xf3efe2];
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.11, 0.08),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false
    }),
    count
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const pieces = Array.from({ length: count }, (_, index) => ({
    active: false,
    t: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0
  }));

  matrix.makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.setHex(colors[i % colors.length]));
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  group.add(mesh);

  return {
    spawn(reward, amount = count) {
      const activeCount = Math.min(count, amount);
      for (let i = 0; i < count; i++) {
        const piece = pieces[i];
        piece.active = i < activeCount;
        piece.t = 0;
        if (!piece.active) continue;
        piece.x = reward.platform.x;
        piece.y = reward.platform.top + 0.65;
        piece.z = reward.platform.z;
        piece.vx = (Math.random() - 0.5) * 3.2;
        piece.vy = 2.7 + Math.random() * 2.8;
        piece.vz = (Math.random() - 0.5) * 3.2;
        piece.rx = Math.random() * 3;
        piece.ry = Math.random() * 3;
        piece.rz = Math.random() * 3;
        piece.spinX = 6;
        piece.spinY = 5;
        piece.spinZ = 4.5;
      }
      mesh.visible = activeCount > 0;
    },
    update(dt) {
      if (!mesh.visible) return;
      let alive = 0;
      for (let i = 0; i < count; i++) {
        const piece = pieces[i];
        if (piece.active) {
          piece.t += dt;
          piece.vy -= 5.4 * dt;
          piece.x += piece.vx * dt;
          piece.y += piece.vy * dt;
          piece.z += piece.vz * dt;
          piece.rx += piece.spinX * dt;
          piece.ry += piece.spinY * dt;
          piece.rz += piece.spinZ * dt;
          if (piece.t > 2) piece.active = false;
        }
        if (piece.active) {
          alive++;
          const fade = piece.t > 1.15 ? Math.max(0, 1 - (piece.t - 1.15) / 0.85) : 1;
          euler.set(piece.rx, piece.ry, piece.rz, 'YXZ');
          quat.setFromEuler(euler);
          pos.set(piece.x, piece.y, piece.z);
          scale.setScalar(fade);
          matrix.compose(pos, quat, scale);
        } else {
          matrix.makeScale(0, 0, 0);
        }
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (!alive) mesh.visible = false;
    }
  };
}

/* ================= 终极大奖（每关终点的惊喜） =================
 * 每关终点不再放普通宝箱，而是一个“会憋大招”的巨型惊喜礼盒：
 *   待机 → 缓慢呼吸、缎带微亮、光环低速旋转
 *   蓄力 → 玩家进入约 11m 内开始颤抖、向上冒金色火星、光环加速（给足惊喜预兆）
 *   揭晓 → 盒盖掀开，金色大奖从盒中升起，光柱冲天、冲击波扩散、
 *          三波烟花在四周炸开；之后大奖悬浮旋转、光柱常亮
 * 配色按关卡 id（sea / height / sky / ocean / comet）区分。 */

const PRIZE_PALETTES = {
  sea: { accent: 0x7fe3ff, prize: 0xffe9a8, burst: [0x9ff0ff, 0x6fd0ff, 0xfff3c4, 0xffffff] },
  height: { accent: 0xffd166, prize: 0xffd166, burst: [0xffd166, 0xff9f6b, 0xfff3c4, 0xff7a5c] },
  sky: { accent: 0xffc94a, prize: 0xffd76b, burst: [0xffd76b, 0x9ecbff, 0xfff3c4, 0xffe59a] },
  ocean: { accent: 0x8ee2bd, prize: 0xd9ffe9, burst: [0x8ee2bd, 0x73ddd7, 0xf6ffe0, 0xffffff] },
  comet: { accent: 0xb9a2ff, prize: 0xd9c8ff, burst: [0xb9a2ff, 0x8ef1ff, 0xffd6f6, 0xffffff] }
};

/** 加色混合的光晕贴图（光柱根部的“灯泡”） */
function makePrizeGlowSprite(color, size = 5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  // 直接用十六进制分量拼 CSS 颜色，避免 THREE.Color 的色彩空间换算把颜色压暗
  const rgb = ((color >> 16) & 255) + ',' + ((color >> 8) & 255) + ',' + (color & 255);
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.3, 'rgba(' + rgb + ',0.5)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false
  }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** 揭晓时向外扩散的冲击波环（复用 3 个环，轮流触发） */
function makePrizeShockRings(group, accent) {
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.04, 42),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.userData = { active: false, t: 0 };
    group.add(ring);
    rings.push(ring);
  }
  let cursor = 0;
  return {
    fire(y = 0.4) {
      const ring = rings[cursor];
      cursor = (cursor + 1) % rings.length;
      ring.userData.active = true;
      ring.userData.t = 0;
      ring.position.y = y;
      ring.visible = true;
    },
    update(dt) {
      for (const ring of rings) {
        const u = ring.userData;
        if (!u.active) continue;
        u.t += dt;
        const k = u.t / 1.05;
        if (k >= 1) {
          u.active = false;
          ring.visible = false;
          continue;
        }
        const s = 0.5 + k * 8.5;
        ring.scale.set(s, s, s);
        ring.material.opacity = 0.55 * (1 - k) * (1 - k);
      }
    }
  };
}

/** 烟花粒子池（一个 InstancedMesh，蓄力火星与揭晓烟花共用） */
function makePrizeFireworks(group, count = 170) {
  const mesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.085, 0),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    }),
    count
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;
  group.add(mesh);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const axis = new THREE.Vector3(0.62, 1, 0.34).normalize();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const parts = Array.from({ length: count }, () => ({
    active: false, t: 0, life: 1,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    spin: 0, size: 1
  }));
  matrix.makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color.setHex(0xffffff));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  let cursor = 0;
  return {
    burst(x, y, z, palette, amount = 40, power = 4.8) {
      for (let k = 0; k < amount; k++) {
        const index = cursor;
        cursor = (cursor + 1) % count;
        const part = parts[index];
        part.active = true;
        part.t = 0;
        part.life = 1.4 + Math.random() * 0.9;
        part.x = x;
        part.y = y;
        part.z = z;
        // 球面均匀方向，略微上偏，像烟花散开
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const speed = power * (0.5 + Math.random() * 0.6);
        part.vx = Math.cos(a) * r * speed;
        part.vy = u * speed * 0.85 + 1.1;
        part.vz = Math.sin(a) * r * speed;
        part.spin = (Math.random() - 0.5) * 10;
        part.size = 0.7 + Math.random() * 0.95;
        mesh.setColorAt(index, color.setHex(palette[(Math.random() * palette.length) | 0]));
      }
      mesh.instanceColor.needsUpdate = true;
      mesh.visible = true;
    },
    update(dt) {
      if (!mesh.visible) return;
      let alive = 0;
      for (let i = 0; i < count; i++) {
        const part = parts[i];
        if (part.active) {
          part.t += dt;
          if (part.t >= part.life) {
            part.active = false;
          } else {
            const drag = Math.min(1, 1.9 * dt);
            part.vx -= part.vx * drag;
            part.vz -= part.vz * drag;
            part.vy -= 3.4 * dt + part.vy * drag * 0.5;
            part.x += part.vx * dt;
            part.y += part.vy * dt;
            part.z += part.vz * dt;
          }
        }
        if (part.active) {
          alive++;
          const k = part.t / part.life;
          const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
          quat.setFromAxisAngle(axis, part.spin * part.t);
          pos.set(part.x, part.y, part.z);
          scale.setScalar(Math.max(0.001, part.size * fade));
          matrix.compose(pos, quat, scale);
        } else {
          matrix.makeScale(0, 0, 0);
        }
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (!alive) mesh.visible = false;
    }
  };
}

/**
 * 终极大奖：终点台上的惊喜礼盒。对外暴露 group / lidPivot（交给通用开箱动画）/ reveal()。
 * 未揭晓时只占一个礼盒 + 光环；靠近才会“憋大招”，揭晓后升起金色大奖并放烟花。
 */
function makeGrandPrize(def, platform) {
  const palette = PRIZE_PALETTES[def.id] || PRIZE_PALETTES.sky;
  const accent = palette.accent;
  const group = new THREE.Group();
  group.userData.animated = true; // 必须：否则会被静态矩阵冻结
  group.position.set(platform.x, platform.top, platform.z);
  const fit = Math.min(1.35, Math.max(0.9, platform.half * 0.52));
  group.scale.setScalar(fit);

  /* —— 基座 —— */
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.22, 0.34, 22),
    new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.6, metalness: 0.42 })
  );
  plinth.position.y = 0.17;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);
  const plinthRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.04, 0.055, 6, 30),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, depthWrite: false })
  );
  plinthRing.rotation.x = Math.PI / 2;
  plinthRing.position.y = 0.35;
  group.add(plinthRing);

  /* —— 礼盒（未开封的“惊喜”） —— */
  const boxH = 1.0;
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x9c2f2f, roughness: 0.42, metalness: 0.16 });
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.26,
    metalness: 0.6,
    emissive: new THREE.Color(accent).multiplyScalar(0.35),
    emissiveIntensity: 0.7
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.46, boxH, 1.46), boxMat);
  box.position.y = 0.34 + boxH / 2;
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);
  for (const ry of [0, Math.PI / 2]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.52, boxH + 0.06, 0.18), ribbonMat);
    band.position.copy(box.position);
    band.rotation.y = ry;
    band.castShadow = true;
    group.add(band);
  }

  /* —— 盒盖：lidPivot 由通用开箱动画从 0 → -1.9 掀开 —— */
  const lidPivot = new THREE.Group();
  lidPivot.userData.animated = true;
  lidPivot.position.set(0, 0.34 + boxH, -0.73);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.16, 1.58), boxMat);
  lid.position.set(0, 0.08, 0.73);
  lid.castShadow = true;
  lidPivot.add(lid);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 8, 18), ribbonMat);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.2, 0.73);
  lidPivot.add(bow);
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.048, 8, 16), ribbonMat);
    loop.position.set(s * 0.21, 0.26, 0.73);
    loop.rotation.set(Math.PI / 2, 0, s * 0.55);
    lidPivot.add(loop);
  }
  group.add(lidPivot);

  /* —— 盒中大奖：金色奖杯，开盒后升起 —— */
  const goldMat = new THREE.MeshStandardMaterial({
    color: palette.prize,
    roughness: 0.16,
    metalness: 0.92,
    emissive: new THREE.Color(palette.prize).multiplyScalar(0.25),
    emissiveIntensity: 0.85
  });
  const prize = new THREE.Group();
  const prizeStartY = 0.34 + boxH * 0.4;
  const prizeRestY = prizeStartY + 1.5;
  prize.position.set(0, prizeStartY, 0);
  prize.visible = false;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.11, 18), goldMat);
  foot.position.y = 0.055;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.28, 12), goldMat);
  stem.position.y = 0.25;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.22, 0.5, 22, 1, true), goldMat);
  cup.position.y = 0.63;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 6, 26), goldMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.88;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), goldMat);
  gem.position.y = 1.06;
  gem.scale.set(1, 1.4, 1);
  prize.add(foot, stem, cup, lip, gem);
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 8, 16, Math.PI * 1.05), goldMat);
    handle.position.set(s * 0.47, 0.66, 0);
    handle.rotation.y = s * 1.35;
    prize.add(handle);
  }
  prize.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(prize);

  /* —— 光环 / 光柱 / 光晕 / 冲击波 / 烟花 —— */
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.98, 0.035, 8, 44),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75, depthWrite: false })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 1.95;
  group.add(halo);

  const beamMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 34, 18, 1, true), beamMat);
  beam.position.y = 17;
  beam.visible = false;
  group.add(beam);
  const glow = makePrizeGlowSprite(accent, 5);
  glow.position.y = 1.1;
  glow.visible = false;
  group.add(glow);

  const shock = makePrizeShockRings(group, accent);
  const fireworks = makePrizeFireworks(group);

  let opened = false;
  let openT = -1;
  let shake = 0;
  let volley = 0;
  let volleyTimer = 0;
  let sparkTimer = 0;

  function reveal(silent) {
    if (opened) return;
    opened = true;
    openT = silent ? 999 : 0;
    prize.visible = true;
    beam.visible = true;
    glow.visible = true;
    if (silent) {
      // 读档直接定格在“已揭晓”：大奖升到位、光柱常亮，不放烟花
      prize.position.y = prizeRestY;
      prize.scale.setScalar(1);
      beamMat.opacity = 0.22;
    } else {
      volley = 3;
      volleyTimer = 0;
      shock.fire(0.35);
    }
  }

  return {
    group,
    lidPivot,
    platform,
    isGrandPrize: true,
    get opened() { return opened; },
    reveal,
    update(dt, time = 0, player = null) {
      const near = player
        ? Math.hypot(player.pos.x - platform.x, player.pos.z - platform.z)
        : 999;
      const charging = !opened && near < 11;
      shake += ((charging ? 1 : 0.18) - shake) * Math.min(1, 3.4 * dt);

      // 光环：待机慢转，蓄力加速，揭晓后放大高转
      const breathe = Math.sin(time * (charging ? 10 : 2.1));
      halo.rotation.z += dt * (opened ? 2.6 : charging ? 1.9 : 0.5);
      halo.scale.setScalar((opened ? 1.3 : 1) + breathe * (charging ? 0.11 : 0.04));
      halo.position.y = 1.95 + (opened ? 0.15 : 0) + breathe * 0.05;

      // 蓄力颤抖：整组轻抖 + 缎带发光脉动
      group.position.x = platform.x + (charging ? Math.sin(time * 47) * 0.035 : 0);
      group.position.z = platform.z + (charging ? Math.cos(time * 41) * 0.035 : 0);
      group.position.y = platform.top + (charging ? Math.abs(Math.sin(time * 7.5)) * 0.04 : 0);
      ribbonMat.emissiveIntensity = charging ? 0.95 + breathe * 0.45 : 0.7;

      if (!opened) {
        // 蓄力时从盒顶向上冒金色火星，诱惑玩家靠近
        if (charging) {
          sparkTimer -= dt;
          if (sparkTimer <= 0) {
            sparkTimer = 0.22;
            fireworks.burst(
              (Math.random() - 0.5) * 1.1,
              1.5,
              (Math.random() - 0.5) * 1.1,
              palette.burst,
              5,
              1.5
            );
          }
        }
      } else {
        openT += dt;
        const k = Math.min(1, openT / 1.2);
        const ease = 1 - Math.pow(1 - k, 3);
        prize.position.y = prizeStartY + (prizeRestY - prizeStartY) * ease;
        prize.scale.setScalar(0.4 + ease * 0.6);
        prize.rotation.y += dt * 1.5;
        beamMat.opacity = 0.1 + 0.12 * Math.abs(Math.sin(time * 2.3)) + (1 - k) * 0.4;
        glow.material.opacity = 0.45 + 0.2 * Math.sin(time * 3.2);
        const glowSize = 4.6 + Math.sin(time * 3.2) * 0.5 + (1 - k) * 3.5;
        glow.scale.set(glowSize, glowSize, 1);

        // 三波烟花 + 冲击波，越放越远越高
        if (volley > 0) {
          volleyTimer -= dt;
          if (volleyTimer <= 0) {
            volleyTimer = 0.5;
            const a = volley * 2.2 + time * 0.4;
            const radius = 3.4 + volley * 1.4;
            // 粒子在 group 的局部坐标系里（group 已缩放/平移），这里给相对大奖中心的偏移
            fireworks.burst(
              Math.cos(a) * radius,
              3.2 + volley * 1.2,
              Math.sin(a) * radius,
              palette.burst,
              44,
              5.2
            );
            shock.fire(0.5 + volley * 0.3);
            volley--;
          }
        }
      }

      fireworks.update(dt);
      shock.update(dt);
    }
  };
}

function makeLongCourseVisual(def) {
  const group = new THREE.Group();
  const staticEntries = [];
  const dynamicEntries = [];
  const rewards = [];
  const chestRewards = []; // 阶段宝箱（实例化绘制）；终点改为终极大奖，不再放宝箱

  def.platforms.forEach((p, index) => {
    if (p.motion) dynamicEntries.push({ p });
    else staticEntries.push({ p, yaw: ((index * 0.47) % 0.18) - 0.09 });

    if (p.reward) {
      const reward = makeSkyChest(def, p, index);
      rewards.push(reward);
      if (!reward.final) chestRewards.push(reward);
    }
  });

  const refreshStaticLocks = addSkyStaticInstances(group, staticEntries);
  const updateDynamicVisuals = addSkyDynamicInstances(group, dynamicEntries);
  if (def.style === 'ocean') addOceanProps(group, def.platforms);
  if (def.style === 'comet') addCometProps(group, def.platforms);
  addSkyRotorInstances(group, def.rotors || [], def.style);
  const updateChestVisuals = addSkyChestInstances(group, chestRewards);
  updateChestVisuals();

  const rewardConfetti = makeLongConfetti(group);

  const finalReward = rewards.find((r) => r.final) || rewards[rewards.length - 1];
  const goalPlatform = finalReward.platform;
  // 终极大奖：替换掉原先放在终点台上的宝箱
  const grandPrize = makeGrandPrize(def, goalPlatform);
  group.add(grandPrize.group);
  const flagPivot = new THREE.Group();
  flagPivot.position.set(goalPlatform.x, goalPlatform.top, goalPlatform.z);
  const flagPole = box(0.08, 4.4, 0.08, PALETTE.woodDark);
  flagPole.position.set(goalPlatform.half * 0.72, 2.2, goalPlatform.half * 0.72);
  flagPivot.add(flagPole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 0.72, 1, 3),
    new THREE.MeshStandardMaterial({ color: 0xf1c85b, side: THREE.DoubleSide, roughness: 0.58, emissive: 0x62410b, emissiveIntensity: 0.24 })
  );
  flag.position.set(goalPlatform.half * 0.72 + 0.7, 3.72, goalPlatform.half * 0.72);
  flag.userData.animated = true;
  flagPivot.add(flag);
  group.add(flagPivot);

  const goal = {
    x: goalPlatform.x,
    y: goalPlatform.top,
    z: goalPlatform.z,
    half: goalPlatform.half,
    rewardId: finalReward.id
  };
  Object.defineProperty(goal, 'opened', {
    enumerable: true,
    get: () => finalReward.opened,
    set: (value) => { finalReward.opened = value; }
  });

  return {
    group,
    longCourse: true,
    platforms: def.platforms,
    rewards,
    lidPivot: grandPrize.lidPivot,
    grandPrize,
    flag,
    goal,
    setRewardOpened(id, animate = true) {
      const reward = rewards.find((r) => r.id === id);
      if (!reward || reward.opened) return false;
      reward.opened = true;
      reward.openT = 0;
      if (reward.final) {
        // 终点：揭晓终极大奖（读档恢复时直接定格在已揭晓状态，不放烟花）
        grandPrize.reveal(!animate);
        if (!animate) grandPrize.lidPivot.rotation.x = -1.9;
        return true;
      }
      if (!animate) {
        reward.lidPivot.rotation.x = -1.9;
        reward.beam.visible = false;
      }
      if (animate) rewardConfetti.spawn(reward, 20);
      return true;
    },
    setCourseStage(stage) {
      for (const p of def.platforms) {
        p.locked = p.stage > stage + 1;
      }
      refreshStaticLocks();
      updateDynamicVisuals(0, true);
    },
    spawnConfetti() {
      grandPrize.reveal(false);
      rewardConfetti.spawn(finalReward, 42);
    },
    update(dt, time = 0, player = null) {
      updateDynamicVisuals(time);

      for (const reward of chestRewards) {
        const target = reward.opened ? -1.9 : 0;
        reward.lidPivot.rotation.x += (target - reward.lidPivot.rotation.x) * Math.min(1, 7 * dt);
        const pulse = 0.75 + Math.sin(time * 2.1 + reward.stage) * 0.18;
        reward.beam.material.opacity = reward.opened ? 0.04 : 0.14 * pulse;
        reward.beam.scale.set(1, pulse, 1);
        if (reward.openT >= 0) reward.openT += dt;
      }
      updateChestVisuals();

      grandPrize.update(dt, time, player);
      rewardConfetti.update(dt);
    }
  };
}

/* ================= 关卡视觉构建（注册表驱动） =================
 * makeCourseVisual(def) 依据 COURSES 中的关卡定义生成全部视觉物：
 *   平台：'sea' 桩柱浮台 | 'float' 悬空台三样式轮换 | 500 台长关使用实例化视觉
 *   终点：终极大奖（惊喜礼盒 → 金色大奖 + 光柱 + 烟花）+ 旗子 + 彩带池；
 *        float 样式附灯柱，sea 样式终点岛附棕榈树
 * 新增关卡无需修改此函数——只往 COURSES 加定义即可。 */

function makeCourseVisual(def) {
  if (def.style === 'sky' || def.style === 'ocean' || def.style === 'comet') {
    return makeLongCourseVisual(def);
  }

  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.85 });

  let stepIdx = 0;
  for (const p of def.platforms) {
    const pg = new THREE.Group();

    if (p.prop === 'palm') {
      // 道具跳台：棕榈树冠（树顶木盘是实打实的落脚面）
      const ground = terrainHeight(p.x, p.z);
      const trunkH = p.top - ground - 0.55;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.24, trunkH, 8),
        new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 0.9 })
      );
      trunk.position.y = ground + trunkH / 2;
      trunk.castShadow = true;
      pg.add(trunk);
      const leafMat = new THREE.MeshStandardMaterial({ color: PALETTE.palmLeaf, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
      for (let k = 0; k < 8; k++) {
        const len = 2.6;
        const geo = new THREE.PlaneGeometry(0.65, len, 1, 3);
        geo.translate(0, len / 2, 0);
        const leaf = new THREE.Mesh(geo, leafMat);
        leaf.position.y = p.top - 0.75;
        leaf.rotateY((k / 8) * Math.PI * 2 + 0.3);
        leaf.rotateX(-0.55 - (k % 3) * 0.12);
        leaf.castShadow = true;
        pg.add(leaf);
      }
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 16), woodMat);
      disc.position.y = p.top - 0.05;
      disc.castShadow = true;
      pg.add(disc);
    } else if (def.style === 'sea') {
      // 海面桩柱浮台：台板 + 防滑条 + 两根桩柱插到海床
      const deck = box(p.half * 2, 0.28, p.half * 2, PALETTE.wood);
      deck.position.y = p.top - 0.14;
      pg.add(deck);
      for (const s of [-1, 1]) {
        const o = p.half * 0.5;
        const strip = box(p.half * 2 - 0.2, 0.05, 0.14, PALETTE.woodDark);
        strip.position.set(0, p.top + 0.005, s * o);
        pg.add(strip);
        const strip2 = box(0.14, 0.05, p.half * 2 - 0.2, PALETTE.woodDark);
        strip2.position.set(s * o, p.top + 0.005, 0);
        pg.add(strip2);
      }
      const seaFloor = terrainHeight(p.x, p.z) - 0.2;
      const legLen = Math.max(0.2, (p.top - 0.28) - seaFloor);
      const lo = p.half * 0.62;
      for (const [lx, lz] of [[-lo, -lo], [lo, lo]]) {
        const leg = box(0.16, legLen, 0.16, PALETTE.woodDark);
        leg.position.set(lx, p.top - 0.28 - legLen / 2, lz);
        pg.add(leg);
      }
    } else {
      // 悬空台：三种样式轮换（圆台 / 角柱台 / 描边台），终点台金边
      const isGoal = p.half > 2;
      const kind = stepIdx % 3;
      if (isGoal) {
        const deck = box(p.half * 2, 0.28, p.half * 2, PALETTE.woodDark);
        deck.position.y = p.top - 0.14;
        pg.add(deck);
        const trim = box(p.half * 2 - 0.1, 0.06, p.half * 2 - 0.1, 0xd8b04a);
        trim.position.y = p.top + 0.005;
        pg.add(trim);
      } else if (kind === 0) {
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.26, 14), woodMat);
        deck.position.y = p.top - 0.13;
        deck.castShadow = true;
        pg.add(deck);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.76, 0.12, 12), darkMat);
        base.position.y = p.top - 0.31;
        pg.add(base);
      } else if (kind === 1) {
        const deck = box(p.half * 2, 0.26, p.half * 2, PALETTE.wood);
        deck.position.y = p.top - 0.13;
        pg.add(deck);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const post = box(0.08, 0.34, 0.08, PALETTE.woodDark);
          post.position.set(sx * (p.half - 0.12), p.top + 0.17, sz * (p.half - 0.12));
          pg.add(post);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), darkMat);
          ball.position.set(sx * (p.half - 0.12), p.top + 0.37, sz * (p.half - 0.12));
          pg.add(ball);
        }
      } else {
        const deck = box(p.half * 2, 0.26, p.half * 2, PALETTE.wood);
        deck.position.y = p.top - 0.13;
        pg.add(deck);
        const accent = (Math.floor(stepIdx / 3) % 2 === 0) ? 0xe2504a : 0x4aa3e2;
        const trim = box(p.half * 2, 0.05, p.half * 2, accent);
        trim.position.y = p.top + 0.005;
        pg.add(trim);
        const base = box(p.half * 2 - 0.16, 0.1, p.half * 2 - 0.16, PALETTE.woodDark);
        base.position.y = p.top - 0.31;
        pg.add(base);
      }
    }
    stepIdx++;
    pg.position.set(p.x, 0, p.z);
    g.add(pg);
  }

  // 终点：宝箱（盖可开）+ 旗子 + 彩带池（终极大奖只属于三个长关，练习关不放大奖）
  const goal = def.goal;
  const chest = new THREE.Group();
  const chestBody = box(0.9, 0.5, 0.62, PALETTE.woodDark);
  chestBody.position.y = 0.25;
  chest.add(chestBody);
  const lidPivot = new THREE.Group();
  lidPivot.userData.animated = true;
  lidPivot.position.set(0, 0.5, -0.31);
  const lid = box(0.9, 0.16, 0.62, PALETTE.wood);
  lid.position.set(0, 0.08, 0.31);
  lidPivot.add(lid);
  chest.add(lidPivot);
  const lock = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.7 })
  );
  lock.position.set(0, 0.52, 0.33);
  chest.add(lock);
  chest.position.set(goal.x, goal.top, goal.z);
  chest.rotation.y = 0.55;
  g.add(chest);

  const fo = goal.half * 0.45;
  const flagPole = box(0.06, 1.7, 0.06, PALETTE.woodDark);
  flagPole.position.set(goal.x + fo, goal.top + 0.85, goal.z + fo);
  g.add(flagPole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.34),
    new THREE.MeshStandardMaterial({ color: def.style === 'float' ? 0xf0b848 : 0xe2504a, side: THREE.DoubleSide, roughness: 0.7 })
  );
  flag.position.set(goal.x + fo + 0.32, goal.top + 1.5, goal.z + fo);
  flag.userData.animated = true;
  g.add(flag);

  const confetti = [];
  const confettiColors = [0xe2504a, 0xf0b848, 0x5fa8d3, 0x7fb069, 0xe2836b, 0xf2e4d0];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.08),
      new THREE.MeshBasicMaterial({
        color: confettiColors[i % confettiColors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0
      })
    );
    m.visible = false;
    m.userData = { vel: new THREE.Vector3(), t: 0, animated: true };
    confetti.push(m);
    g.add(m);
  }

  // 样式附饰：sea 终点岛种棕榈树；float 终点台加灯柱
  if (def.style === 'sea') {
    const goalPlat = def.platforms[def.platforms.length - 1];
    const goalPalm = makePalm(goalPlat.x + goalPlat.half * 0.45, goalPlat.z + goalPlat.half * 0.35, 0.75, 1.1);
    goalPalm.position.y = goalPlat.top;
    g.add(goalPalm);
  } else {
    g.add(makeLantern(goal.x - goal.half * 0.73, goal.top, goal.z - goal.half * 0.73));
    g.add(makeLantern(goal.x + goal.half * 0.73, goal.top, goal.z + goal.half * 0.73));
  }

  return {
    group: g,
    platforms: def.platforms,
    lidPivot,
    flag,
    goal: { x: goal.x, y: goal.top, z: goal.z, half: goal.half, opened: false },
    spawnConfetti() {
      for (const m of confetti) {
        m.visible = true;
        m.position.set(goal.x, goal.top + 0.6, goal.z);
        m.userData.vel.set((Math.random() - 0.5) * 2.6, 2.6 + Math.random() * 2.4, (Math.random() - 0.5) * 2.6);
        m.userData.t = 0;
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        m.material.opacity = 1;
      }
    },
    update(dt) {
      for (const m of confetti) {
        if (!m.visible) continue;
        const u = m.userData;
        u.t += dt;
        u.vel.y -= 5.2 * dt;
        m.position.addScaledVector(u.vel, dt);
        m.rotation.x += dt * 6;
        m.rotation.z += dt * 4.5;
        if (u.t > 1.1) m.material.opacity = Math.max(0, 1 - (u.t - 1.1) / 0.9);
        if (u.t > 2.1) m.visible = false;
      }
    }
  };
}

/* ---------------- 动态平台物理同步 ---------------- */

function updateMovingPlatforms(time, activeView) {
  for (const course of COURSES) {
    if (course.platforms.length >= 500 && course.id !== activeView) continue;
    const dynamicPlatforms = DYNAMIC_PLATFORMS_BY_COURSE.get(course.id);
    if (!dynamicPlatforms?.length) continue;
    for (const p of dynamicPlatforms) {
      const motion = p.motion;
      if (motion.prevX === undefined) {
        motion.prevX = p.x;
        motion.prevZ = p.z;
        motion.prevTop = p.top;
      }

      const oldX = p.x;
      const oldZ = p.z;
      const oldTop = p.top;
      if (motion.type === 'orbit') {
        const angle = motion.phase + time * motion.speed;
        p.x = motion.cx + Math.cos(angle) * motion.radius;
        p.z = motion.cz + Math.sin(angle) * motion.radius;
      } else if (motion.type === 'lift') {
        p.top = motion.baseTop + Math.sin(time * motion.speed + motion.phase) * motion.amplitude;
      } else if (motion.type === 'shuttle') {
        const offset = Math.sin(time * motion.speed + motion.phase) * motion.amplitude;
        p.x = motion.x0 + motion.axisX * offset;
        p.z = motion.z0 + motion.axisZ * offset;
      } else if (motion.type === 'wave') {
        const phase = time * motion.speed + motion.phase;
        p.x = motion.x0 + Math.sin(phase) * motion.amplitudeX;
        p.z = motion.z0 + Math.cos(phase * 0.83) * motion.amplitudeZ;
        p.top = motion.baseTop + Math.sin(phase * 1.37) * motion.amplitudeY;
      }

      motion.dx = p.x - oldX;
      motion.dz = p.z - oldZ;
      motion.dTop = p.top - oldTop;
      motion.prevX = oldX;
      motion.prevZ = oldZ;
      motion.prevTop = oldTop;
    }
  }
}

function carryRider(player, activeView) {
  if (!player || !player.onGround) return;
  for (const course of COURSES) {
    if (course.platforms.length >= 500 && course.id !== activeView) continue;
    const dynamicPlatforms = DYNAMIC_PLATFORMS_BY_COURSE.get(course.id);
    if (!dynamicPlatforms?.length) continue;
    for (const p of dynamicPlatforms) {
      const motion = p.motion;
      if (motion.prevX === undefined) continue;
      const onPrevSurface =
        Math.abs(player.pos.x - motion.prevX) < p.half + 0.14 &&
        Math.abs(player.pos.z - motion.prevZ) < p.half + 0.14 &&
        Math.abs(player.pos.y - motion.prevTop) < 0.26;
      if (!onPrevSurface) continue;
      player.pos.x += motion.dx;
      player.pos.y += motion.dTop;
      player.pos.z += motion.dz;
      player.group.position.copy(player.pos);
      return;
    }
  }
}

/* ---------------- 组装场景 ---------------- */

export function buildBeachScene(options = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdceaf2, 120, 620);

  scene.add(makeSky());
  scene.add(makeSun());
  scene.add(makeIslands());
  scene.add(makeFarMountains());

  // 低多边形云（缓慢漂移）
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    const c = makeCloud(
      -90 + Math.random() * 180,
      32 + Math.random() * 16,
      -50 - Math.random() * 90,
      2.2 + Math.random() * 2.4
    );
    clouds.push(c);
    c.userData.animated = true;
    scene.add(c);
  }

  const hemi = new THREE.HemisphereLight(0xbcd9ff, 0xdcbc90, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
  sun.position.set(58, 72, 46);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.022;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, 0, 0);

  const terrain = makeTerrain();
  scene.add(terrain);

  const water = makeWater();
  scene.add(water);

  // 世界底海：一整块不透明深海面铺满全图（比浪谷低 0.5m），
  // 让东/西/北三个方向的地平线也是海——陆地与海洋在远方自然相接。
  const worldSea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: PALETTE.waterDeep, roughness: 0.6, metalness: 0 })
  );
  worldSea.rotation.x = -Math.PI / 2;
  worldSea.position.y = WATER_LEVEL - 0.5;
  scene.add(worldSea);

  const foam = makeFoam();
  foam.userData.animated = true;
  scene.add(foam);

  const ripples = makeRipples();
  for (const r of ripples) { r.userData.animated = true; scene.add(r); }
  function spawnRipple(x, z) {
    const r = ripples.find((m) => !m.visible);
    if (!r) return;
    r.position.set(x, WATER_LEVEL + 0.07, z);
    r.userData.t = 0;
    r.visible = true;
  }

  const house = makeHouse(HOUSE.x, HOUSE.z);
  scene.add(house.group);
  // 遮挡体要转换到世界坐标参与相机射线（房子不旋转，直接把 mesh 引用给出即可，
  // three.js 射线检测内部会用 matrixWorld）
  const occluders = house.occluders;

  const door = { pivot: house.doorPivot, open: false };

  /* 碰撞体（世界坐标 AABB；doorway 项在开门时移除） */
  const doorwayCollider = { minX: 14.3, maxX: 15.7, minZ: 3.82, maxZ: 4.18, doorway: true };
  const colliders = [
    // 房子前墙两段
    { minX: 12.0, maxX: 14.3, minZ: 3.78, maxZ: 4.22 },
    { minX: 15.7, maxX: 18.0, minZ: 3.78, maxZ: 4.22 },
    doorwayCollider,
    // 后墙
    { minX: 12.0, maxX: 18.0, minZ: 9.78, maxZ: 10.22 },
    // 左右墙
    { minX: 11.78, maxX: 12.22, minZ: 4.2, maxZ: 9.8 },
    { minX: 17.78, maxX: 18.22, minZ: 4.2, maxZ: 9.8 },
    // 木箱堆
    { minX: 3.95, maxX: 5.05, minZ: 8.95, maxZ: 10.05 },
    { minX: 5.38, maxX: 6.22, minZ: 9.48, maxZ: 10.32 },
    { minX: 4.43, maxX: 5.38, minZ: 10.13, maxZ: 11.08 }
  ];

  scene.add(makeSign(9.5, 1.5));
  scene.add(makeUmbrella(-8, 2.5));
  scene.add(makeBall(-6.4, 4.2));
  scene.add(makeCrate(4.5, 9.5, 1.1, 0.4));
  scene.add(makeCrate(5.8, 9.9, 0.85, -0.2));
  scene.add(makeCrate(4.9, 10.6, 0.95, 0.9));

  const palms = [
    [-14, 8, 1.0, 0.4], [-11.5, 13, 1.15, 1.2], [8.5, 14, 0.95, 2.1],
    [22, 12, 1.2, 0.8], [26, 3, 1.05, 2.6], [-22, 2, 0.9, 1.7],
    [1.5, 16, 1.1, 0.2], [12, 27.5, 1.0, 1.4]
  ];
  for (const [x, z, s, r] of palms) scene.add(makePalm(x, z, s, r));

  const rocks = [
    [-17, -1.5, 1.3], [12, -1.8, 1.1], [20, -0.5, 0.8],
    [-4, -2.4, 0.7], [6, -2.6, 0.95], [24, 6, 1.0]
  ];
  for (const [x, z, r] of rocks) scene.add(makeRock(x, z, r));

  const seaRocks = [[-10, -9, 1.5], [15, -11, 1.8], [-24, -14, 1.2], [30, -7, 1.0]];
  for (const [x, z, r] of seaRocks) scene.add(makeRock(x, z, r, WATER_LEVEL - r * 0.42));

  /* ---- 灌木：两列树篱（沿地图北缘收边，不乱撒） ---- */
  const bushSpots = [
    [-32, 11], [-28, 12.5], [-24, 11.5], [-20, 13],
    [24, 27], [28, 28.5], [32, 27], [36, 24], [-27, 28]
  ];
  for (const [x, z] of bushSpots) scene.add(makeBush(x, z, 0.9 + Math.random() * 0.5));

  scene.add(makeFence(-30, 12, -6, 13.5, 9));
  scene.add(makeFence(24, 14, 34, 11, 5));

  /* ---- 细节散落：贝壳/海星/小石子（沿岸水线带状布置，克制数量） ---- */
  const shellSpots = [
    [-11.5, 0.8], [-9.8, 1.6], [-7.2, 0.6], [-4.6, 1.4], [-2.4, 0.9], [0.4, 1.8],
    [2.8, 0.7], [5.2, 1.5], [7.4, 0.9], [9.8, 1.7], [22.5, 1.2], [24.8, 1.9],
    [-18.2, 1.1], [-20.6, 1.8]
  ];
  for (const [x, z] of shellSpots) scene.add(makeBeachDetail(x, z));

  /* ---- 草地细节：三组草丛簇（有留白，不成片撒） ---- */
  const grassClusters = [
    [-16, 15], [-14.5, 16.5], [-15.5, 18],
    [4, 12.5], [5.5, 13.8], [3.2, 14.6],
    [26, 16], [27.5, 14.8], [25.2, 17.6]
  ];
  for (const [x, z] of grassClusters) scene.add(makeGrassTuft(x, z));

  scene.add(makeSandcastle(-5.5, 1.2));

  /* ---- 会动的小东西 ---- */
  const crabs = [];
  for (const [cx, cz] of [[-9, 3.2], [2.5, 5.5]]) {
    const crab = makeCrab(cx, cz);
    crab.userData.animated = true;
    crabs.push(crab);
    scene.add(crab);
  }

  const boat = makeBoat(4, -9);
  boat.userData.animated = true;
  scene.add(boat);

  const gulls = [];
  const gullDefs = [
    { cx: -8, cz: -10, r: 7, h: 8, speed: 0.5 },
    { cx: 14, cz: -16, r: 9, h: 10, speed: 0.38 },
    { cx: 2, cz: -24, r: 8, h: 7, speed: 0.44 }
  ];
  for (const d of gullDefs) {
    const gull = makeGull();
    gull.userData.animated = true;
    gull.userData.def = d;
    gull.userData.phase = Math.random() * Math.PI * 2;
    gulls.push(gull);
    scene.add(gull);
  }

  /* ---- 关卡（注册表驱动：碰撞/奖励/检查点自动接入） ---- */
  const courseVisuals = {};
  let activeView = 'sky';
  const collectedRewardIds = options.collectedRewardIds || {};
  const highestStages = options.highestStages || {};
  for (const def of COURSES) {
    if (def.style === 'sky' || def.style === 'ocean' || def.style === 'comet') {
      const unlockedStage = Math.max(0, Number(highestStages[def.id]) || 0) + 1;
      for (const p of def.platforms) p.locked = p.stage > unlockedStage;
    }
    const vis = makeCourseVisual(def);
    courseVisuals[def.id] = vis;
    scene.add(vis.group);
    if (vis.rewards) {
      const collected = collectedRewardIds instanceof Map
        ? collectedRewardIds.get(def.id)
        : collectedRewardIds[def.id];
      for (const reward of vis.rewards) {
        if (collected?.has(reward.id)) vis.setRewardOpened(reward.id, false);
      }
    }
  }

  /* ---- 石板小径：从沙滩引向房门 ---- */
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 0.95 });
  for (const [sx, sz] of [[10.4, 2.7], [11.3, 2.9], [12.2, 3.05], [13.1, 3.15], [14.0, 3.3], [14.8, 3.45]]) {
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.06, 9), stoneMat);
    stone.position.set(sx, terrainHeight(sx, sz) + 0.03, sz);
    stone.rotation.y = Math.random() * Math.PI;
    stone.receiveShadow = true;
    scene.add(stone);
  }

  /* ---- 烟囱炊烟 ---- */
  const smokePuffs = makeSmoke(HOUSE.x + 2.2, HOUSE.base + 6.4, HOUSE.z + 1.4);
  for (const s of smokePuffs) scene.add(s);

  /* ---- 蝴蝶（草丛上空） ---- */
  const butterflies = [];
  for (const [bx, bz] of [[-15.5, 15.5], [4.8, 13.2], [26.3, 16.2]]) {
    const bf = makeButterfly(bx, bz);
    butterflies.push(bf);
    scene.add(bf);
  }

  /* ---- 脚步扬尘池 ---- */
  const dustPool = makeDustPool();
  for (const d of dustPool) scene.add(d);
  function spawnDust(x, z) {
    const d = dustPool.find((m) => !m.visible);
    if (!d) return;
    d.position.set(x + (Math.random() - 0.5) * 0.3, terrainHeight(x, z) + 0.12, z + (Math.random() - 0.5) * 0.3);
    d.userData.t = 0;
    d.visible = true;
  }

  /* ---- 性能收尾 ---- */
  // ① 小物件不投影：大幅削减阴影通道的绘制量，肉眼无感知
  scene.traverse((o) => {
    if (o.isMesh && o.castShadow) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius < 0.45) o.castShadow = false;
    }
  });
  // ② 静态物体矩阵冻结：跳过每帧数百次的矩阵重算（动画对象已标 animated，自身及子孙跳过）
  scene.traverse((o) => {
    if (o.userData.animated) return;
    for (let a = o.parent; a; a = a.parent) if (a.userData.animated) return;
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });

  let lastVisualUpdate = -Infinity;
  return {
    scene,
    colliders,
    doorwayCollider,
    door,
    occluders,
    spawnRipple,
    spawnDust,
    goals: Object.fromEntries(Object.entries(courseVisuals).map(([id, v]) => [id, v.goal])),
    rewards: Object.values(courseVisuals).flatMap((v) => v.rewards || []),
    courseVisual(id) { return courseVisuals[id]; },
    setCourseStage(id, stage) {
      courseVisuals[id]?.setCourseStage?.(stage);
    },
    setViewMode(id) {
      activeView = id;
      activePlatformCourse = id;
      for (const courseId in courseVisuals) {
        const visual = courseVisuals[courseId];
        if (visual.longCourse) visual.group.visible = courseId === id;
      }
      if (id === 'ocean') {
        scene.fog.near = 42;
        scene.fog.far = 210;
      } else if (id === 'comet') {
        scene.fog.near = 58;
        scene.fog.far = 300;
      } else {
        scene.fog.near = 120;
        scene.fog.far = 620;
      }
    },
    openReward(id) {
      for (const visual of Object.values(courseVisuals)) {
        if (!visual.rewards) continue;
        const reward = visual.rewards.find((r) => r.id === id);
        if (!reward) continue;
        return visual.setRewardOpened(id, true) ? reward : null;
      }
      return null;
    },
    update(t, dt = 0.016, player = null) {
      updateMovingPlatforms(t, activeView);
      carryRider(player, activeView);

      const visualElapsed = lastVisualUpdate < 0 ? dt : t - lastVisualUpdate;
      if (visualElapsed < 1 / 30) return;
      const visualDt = Math.min(0.05, visualElapsed);
      lastVisualUpdate = t;

      updateWater(water, t);
      foam.position.z = SHORE_Z + 0.6 + Math.sin(t * 0.7) * 1.1;
      foam.material.opacity = 0.3 + Math.abs(Math.sin(t * 0.7)) * 0.22;

      // 云漂移（越界回绕）
      for (const c of clouds) {
        c.position.x += c.userData.speed * visualDt;
        if (c.position.x > 130) c.position.x = -130;
      }

      // 门的开合动画（朝屋里开）
      const target = door.open ? -1.95 : 0;
      door.pivot.rotation.y += (target - door.pivot.rotation.y) * Math.min(1, 6 * visualDt);

      // 涟漪扩散
      for (const r of ripples) {
        if (!r.visible) continue;
        r.userData.t += visualDt;
        const k = r.userData.t / 0.9;
        if (k >= 1) { r.visible = false; continue; }
        const s = 1 + k * 2.4;
        r.scale.setScalar(s);
        r.material.opacity = 0.45 * (1 - k);
      }

      // 海鸥绕圈 + 扇翅
      for (const gull of gulls) {
        const d = gull.userData.def;
        const a = t * d.speed + gull.userData.phase;
        gull.position.set(d.cx + Math.cos(a) * d.r, d.h + Math.sin(t * 0.8 + gull.userData.phase) * 0.8, d.cz + Math.sin(a) * d.r);
        gull.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
        const flap = Math.sin(t * 9 + gull.userData.phase) * 0.55;
        gull.userData.wings[0].rotation.z = flap;
        gull.userData.wings[1].rotation.z = -flap;
      }

      // 螃蟹横行 + 身体起伏
      for (const crab of crabs) {
        const u = crab.userData;
        const off = Math.sin(t * u.speed + u.phase) * u.range;
        crab.position.x = u.x0 + off;
        crab.position.y = u.baseY + Math.abs(Math.sin(t * 8 + u.phase)) * 0.02;
        crab.rotation.y = Math.cos(t * u.speed + u.phase) > 0 ? 0 : Math.PI;
      }

      // 小船随波轻摇
      boat.position.y = WATER_LEVEL + 0.08 + Math.sin(t * 0.9) * 0.07;
      boat.rotation.z = Math.sin(t * 0.8) * 0.05;
      boat.rotation.x = Math.sin(t * 0.6) * 0.04;

      // 关卡通用：宝箱盖开合、旗帜飘动、彩带（注册表驱动，新增关卡自动接入）
      for (const id in courseVisuals) {
        const v = courseVisuals[id];
        if (v.longCourse && id !== activeView) continue;
        const lidTarget = v.goal.opened ? -1.9 : 0;
        v.lidPivot.rotation.x += (lidTarget - v.lidPivot.rotation.x) * Math.min(1, 7 * visualDt);
        v.flag.rotation.y = Math.sin(t * 2.2 + (id === 'sea' ? 0 : 1)) * 0.28;
        v.update(visualDt, t, player);
      }

      // 炊烟缓升
      for (const s of smokePuffs) {
        const u = s.userData;
        u.t = (u.t + visualDt * 0.22) % 1;
        s.position.set(
          u.x0 + Math.sin(u.t * 9) * 0.25 * u.t,
          u.y0 + u.t * 3.4,
          u.z0 + Math.cos(u.t * 7) * 0.2 * u.t
        );
        s.scale.setScalar(0.6 + u.t * 1.8);
        s.material.opacity = 0.4 * (1 - u.t) * Math.min(1, u.t * 8);
      }

      // 蝴蝶游荡
      for (const b of butterflies) {
        const u = b.userData;
        b.position.set(
          u.x0 + Math.sin(t * 0.5 + u.phase) * 2.2,
          u.y0 + Math.abs(Math.sin(t * 1.3 + u.phase)) * 0.5,
          u.z0 + Math.cos(t * 0.4 + u.phase) * 1.8
        );
        b.rotation.y = t * 0.6 + u.phase;
        const flap = Math.sin(t * 16 + u.phase) * 0.9;
        u.wings[0].rotation.y = flap;
        u.wings[1].rotation.y = -flap;
      }

      // 扬尘消散
      for (const d of dustPool) {
        if (!d.visible) continue;
        const u = d.userData;
        u.t += visualDt * 2.4;
        if (u.t >= 1) { d.visible = false; continue; }
        d.position.y += visualDt * 0.45;
        d.scale.setScalar(0.5 + u.t * 1.7);
        d.material.opacity = 0.34 * (1 - u.t);
      }
    }
  };
}
