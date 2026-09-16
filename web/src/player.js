import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight, groundAt, WATER_LEVEL, HOUSE, collectNearbyPlatforms } from './scene.js';
import { buildLimbRig } from './rig.js';
import { ANIM_MODE } from './config.js';

/* ---------------- 模型加载与归一化 ---------------- */

export function loadModel(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => reject(err));
  });
}

/**
 * 把模型按真实身高缩放到指定米数，脚底贴 y=0，水平居中。
 * 返回 { height }（缩放后实际高度）。
 */
export function normalizeModel(root, targetHeight) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);

  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.isMeshStandardMaterial) {
        o.material.roughness = Math.min(1, (o.material.roughness ?? 0.9) + 0.05);
      }
    }
  });

  return { height: size.y * scale };
}

/* ---------------- 输入 ---------------- */

export function createInput(dom) {
  const input = {
    forward: false, back: false, left: false, right: false,
    run: false, jump: false,
    runKey: false, jumpKey: false,   // 键盘状态（与手柄状态每帧合并）
    dashQueued: false,
    dashPad: false,
    mx: 0, my: 0,                    // 手柄左摇杆模拟量（my 前向为正，-1~1）
    dragX: 0, dragY: 0, wheel: 0,
    gamepad: false
  };

  const keyMap = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right'
  };

  const onKey = (e, down) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.runKey = down; return; }
    if (e.code === 'Space') { input.jumpKey = down; if (down) e.preventDefault(); return; }
    if (e.code === 'KeyF') {
      if (down && !e.repeat) input.dashQueued = true;
      e.preventDefault();
      return;
    }
    const k = keyMap[e.code];
    if (k) { input[k] = down; e.preventDefault(); }
  };

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));

  // RPG 式鼠标视角：仅进入探索场景后允许锁定（选角页点击空白不能吞掉鼠标）
  input.locked = false;
  input.lockEnabled = false;
  input.lockEnabled = false;
  dom.addEventListener('click', () => {
    if (!document.pointerLockElement && input.lockEnabled) dom.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === dom;
    if (input.onLockChange) input.onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (input.locked) {
      input.dragX += e.movementX || 0;
      input.dragY += e.movementY || 0;
    }
  });

  let dragging = false;
  dom.addEventListener('pointerdown', (e) => { dragging = true; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup', (e) => { dragging = false; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} });
  dom.addEventListener('pointerleave', () => { dragging = false; });
  dom.addEventListener('pointermove', (e) => {
    if (!dragging || input.locked) return;
    input.dragX += e.movementX || 0;
    input.dragY += e.movementY || 0;
  });
  dom.addEventListener('wheel', (e) => { input.wheel += e.deltaY; e.preventDefault(); }, { passive: false });

  input.consume = () => {
    const d = { dragX: input.dragX, dragY: input.dragY, wheel: input.wheel };
    input.dragX = 0; input.dragY = 0; input.wheel = 0;
    return d;
  };
  input.consumeDash = () => {
    const queued = input.dashQueued;
    input.dashQueued = false;
    return queued;
  };

  // 手柄轮询（主循环每帧调用）：
  //   左摇杆=移动（径向死区 0.12，幅度随推杆力度） · A=跳 · L1/L2=加速 · 右摇杆=视角
  input.updateGamepad = (dt) => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    input.gamepad = !!pad;

    let jumpPad = false, runPad = false, dashPad = false;
    input.mx = 0; input.my = 0;
    if (pad) {
      const rx = pad.axes[0] || 0, ry = pad.axes[1] || 0;
      const mag = Math.hypot(rx, ry);
      if (mag > 0.12) {
        const k = Math.min(1, (mag - 0.12) / 0.88) / mag; // 死区后归一，保留推杆力度
        input.mx = rx * k;
        input.my = -ry * k; // 摇杆上推 = 前进
      }
      const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
      jumpPad = btn(0);            // A
      dashPad = btn(1);            // B
      runPad = btn(6) || btn(4);   // L2(LT) 或 L1(LB)
      // 右摇杆视角：增量按"每秒"折算（全杆 ≈ 偏航 2.5 rad/s / 俯仰 1.8 rad/s）
      const ax2 = pad.axes[2] || 0, ay2 = pad.axes[3] || 0;
      const mag2 = Math.hypot(ax2, ay2);
      if (mag2 > 0.12) {
        const k2 = Math.min(1, (mag2 - 0.12) / 0.88) / mag2;
        input.dragX += ax2 * k2 * 560 * dt;
        input.dragY += ay2 * k2 * 520 * dt;
      }
    }
    // 键盘与手柄状态合并
    input.jump = !!(input.jumpKey || jumpPad);
    input.run = !!(input.runKey || runPad);
    if (dashPad && !input.dashPad) input.dashQueued = true;
    input.dashPad = dashPad;
  };

  return input;
}

/* ---------------- 角色控制器（无骨骼 → 程序化动作） ---------------- */

/** 把点推出所有 AABB 碰撞体（含角色半径） */
function resolveAabb(p, minX, maxX, minZ, maxZ, r) {
  if (p.x > minX - r && p.x < maxX + r && p.z > minZ - r && p.z < maxZ + r) {
    const dxl = p.x - (minX - r);
    const dxr = (maxX + r) - p.x;
    const dzl = p.z - (minZ - r);
    const dzr = (maxZ + r) - p.z;
    const m = Math.min(dxl, dxr, dzl, dzr);
    if (m === dxl) p.x = minX - r;
    else if (m === dxr) p.x = maxX + r;
    else if (m === dzl) p.z = minZ - r;
    else p.z = maxZ + r;
    return true;
  }
  return false;
}

function resolveColliders(p, colliders, r) {
  for (const c of colliders) {
    resolveAabb(p, c.minX, c.maxX, c.minZ, c.maxZ, r);
  }
}

export class Player {
  constructor(model, height) {
    this.group = new THREE.Group();
    this.model = model;
    this.modelBaseY = model.position.y;
    this.group.add(model);
    this.height = height;

    // 伪骨骼四肢：仅 'limb' 模式构建（需要网格变形，碎片网格会撕裂，默认不启用）
    this.limb = ANIM_MODE === 'limb' ? buildLimbRig(model) : null;
    this.modelBaseYaw = model.rotation.y || 0;

    this.pos = new THREE.Vector3(0, 0, 4);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.yaw = Math.PI;
    this.bob = 0;
    this.blend = 0;
    this.airK = 0;
    this.time = 0;
    this.lastPhase = 0;
    this.rippleT = 0;
    this.squash = 0;   // >0 压扁 / <0 拉伸（整体缩放，不变形网格）
    this.landVy = 0;   // 落地瞬间竖直速度，决定压扁幅度

    this.walkSpeed = 3.3;
    this.runSpeed = 6.4;
    this.jumpSpeed = 5.4;
    this.gravity = 15.5;
    this.dashTime = 0;
    this.dashDuration = 0.52;
    this.dashSpeed = 11.3;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._collisionPoint = { x: 0, z: 0 };
    this._platformCandidates = [];
    this._groundSupport = { platform: null };
    this.supportPlatform = null;
    this._motionState = { speed: 0, inWater: false, dashing: false };

    // 西侧星轨延伸到 x≈-105；zMin 覆盖潮汐远征约 -3000 的远海终点。
    this.limits = { xMin: -115, xMax: 82, zMin: -3012, zMax: 45 };
  }

  update(dt, input, camYaw, world = {}) {
    this.time += dt;

    const cf = this._forward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const cr = this._right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));

    const wish = this._wish.set(0, 0, 0);
    if (input.forward) wish.add(cf);
    if (input.back) wish.sub(cf);
    if (input.right) wish.add(cr);
    if (input.left) wish.sub(cr);
    // 手柄左摇杆模拟量叠加（键盘开关逻辑不变）
    wish.addScaledVector(cf, input.my || 0);
    wish.addScaledVector(cr, input.mx || 0);

    const mag = wish.length();
    const moving = mag > 0.08;
    if (moving) wish.multiplyScalar(Math.min(1, mag)); // 摇杆幅度 <1 时慢走

    // 星跃：边沿触发，一次一格；优先沿当前输入方向，静止时沿镜头前方。
    const wantsDash = input.consumeDash ? input.consumeDash() : false;
    if (wantsDash && this.dashTime <= 0) {
      const dashCharges = Math.max(0, Number(world.dashCharges) || 0);
      if (dashCharges > 0) {
        this.dashDir.copy(moving ? wish : cf).normalize();
        this.dashTime = this.dashDuration;
        this.onGround = false;
        this.vy = Math.max(this.vy, 1.75);
        this.vel.x = this.dashDir.x * this.dashSpeed;
        this.vel.z = this.dashDir.z * this.dashSpeed;
        if (world.consumeDash) world.consumeDash();
        if (world.onDash) world.onDash(dashCharges - 1);
      } else if (world.onDashEmpty) {
        world.onDashEmpty();
      }
    }

    const dashing = this.dashTime > 0;
    const target = this.onGround ? (input.run ? this.runSpeed : this.walkSpeed) : (input.run ? this.runSpeed : this.walkSpeed) * 0.85;
    const accel = this.onGround ? 14 : 4.5;
    const desired = wish.multiplyScalar(moving ? target : 0);
    if (dashing) {
      this.vel.x = this.dashDir.x * this.dashSpeed;
      this.vel.z = this.dashDir.z * this.dashSpeed;
    } else {
      this.vel.x += (desired.x - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (desired.z - this.vel.z) * Math.min(1, accel * dt);
    }

    // 跳跃与重力
    if (input.jump && this.onGround && !dashing) {
      this.vy = this.jumpSpeed;
      this.onGround = false;
      if (world.onJump) world.onJump();
    }
    this.vy -= this.gravity * (dashing ? 0.25 : 1) * dt;
    if (dashing) {
      this.dashTime = Math.max(0, this.dashTime - dt);
      if (this.dashTime === 0) {
        this.vel.x *= 0.24;
        this.vel.z *= 0.24;
      }
    }

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;

    // 边界与涉水限制
    let bx = Math.min(this.limits.xMax, Math.max(this.limits.xMin, nx));
    let bz = Math.min(this.limits.zMax, Math.max(this.limits.zMin, nz));
    if (bx !== nx) this.vel.x = 0;
    if (bz !== nz) this.vel.z = 0;

    // 墙体碰撞（只在墙高以下生效，飞过屋顶不阻挡）
    if (world.colliders && world.colliders.length && this.pos.y < HOUSE.deckTop + 3.0) {
      const p = { x: bx, z: bz };
      resolveColliders(p, world.colliders, 0.38);
      if (p.x !== bx) this.vel.x = 0;
      if (p.z !== bz) this.vel.z = 0;
      bx = p.x;
      bz = p.z;
    }

    // 台阶真 3D 实体：身体（脚 pos.y ~ 头 pos.y+1.9）与台体体积真实相交才阻挡——
    // 侧面/下方不可穿模，但高空的悬浮台不再变成地面上的隐形墙，可从桥下自由走过。
    // 顶面站立由 groundAt 的单向落面判定负责。
    const nearbyPlatforms = collectNearbyPlatforms(bx, bz, 0.38, this._platformCandidates);
    for (const platform of nearbyPlatforms) {
      const p = platform;
      if (p.locked) continue;
      if (this.pos.y < p.top - 0.02 && this.pos.y + 1.9 > p.top - 0.28) {
        const pt = this._collisionPoint;
        pt.x = bx;
        pt.z = bz;
        resolveAabb(pt, p.x - p.half, p.x + p.half, p.z - p.half, p.z + p.half, 0.38);
        if (pt.x !== bx) this.vel.x = 0;
        if (pt.z !== bz) this.vel.z = 0;
        bx = pt.x;
        bz = pt.z;
      }
    }

    // 单向平台：仅在下落/站立时平台顶面才算地面（起跳上升期不算，防止被"吸"上平台）
    const refY = this.vy <= 0.12 ? this.pos.y : -1e9;

    // 台阶限制：落差超过 0.65m 不能直接走上（露台只能走坡道或跳）
    let ground = groundAt(bx, bz, refY, this._groundSupport, nearbyPlatforms);
    if (this.onGround && ground - this.pos.y > 0.65) {
      bx = this.pos.x;
      bz = this.pos.z;
      this.vel.x *= 0.15;
      this.vel.z *= 0.15;
      ground = groundAt(bx, bz, refY, this._groundSupport);
    }

    let ny = this.pos.y + this.vy * dt;
    const groundFinal = ground;
    if (ny <= groundFinal) {
      if (!this.onGround && this.vy < -3.5 && world.onLand) world.onLand();
      if (!this.onGround) {
        this.landVy = this.vy;
        this.squash = Math.min(0.10, Math.abs(this.vy) * 0.016); // 落地轻微压扁
      }
      ny = groundFinal;
      this.vy = 0;
      this.onGround = true;
    }
    this.supportPlatform = this._groundSupport.platform;

    this.pos.set(bx, ny, bz);

    // 朝向
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.25) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      let diff = targetYaw - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, 12 * dt);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // 程序化动作：走路起伏 + 前倾，站立呼吸，四肢摆动
    this.blend += ((moving && speed > 0.3 ? Math.min(1, speed / this.walkSpeed) : 0) - this.blend) * Math.min(1, 8 * dt);
    this.airK += ((this.onGround ? 0 : 1) - this.airK) * Math.min(1, 9 * dt);
    this.bob += dt * (6.4 + this.blend * 7);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.06 * this.blend;
    const breathe = Math.sin(this.time * 1.7) * 0.008 * (1 - this.blend);
    const lean = this.blend * 0.07 + this.airK * 0.04;
    const roll = Math.sin(this.bob * 0.5) * 0.045 * this.blend;

    this.model.position.y = this.modelBaseY + bobY + breathe;
    this.model.rotation.x = lean;
    this.model.rotation.z = roll;

    // 落地轻微压扁（整体缩放，绝不变形网格）。跳跃全程不拉伸，避免模型被拉长
    this.squash += (0 - this.squash) * Math.min(1, 6.5 * dt);
    const sxz = 1 + this.squash * 0.5;
    this.model.scale.set(sxz, 1 - this.squash, sxz);

    if (this.limb) {
      // 'limb' 模式：行走摆臂摆腿（对侧同步）。需要 SkinnedMesh 顶点变形，
      // 仅适用于带正规骨架的模型——碎片化 AI 网格会撕裂，勿对当前模型启用。
      const sw = Math.sin(this.bob);
      const idle = Math.sin(this.time * 1.7) * 0.03 * (1 - this.blend) * (1 - this.airK);
      const k = Math.min(1, 12 * dt);
      const damp = (part, tx, ty, tz) => {
        part.rotation.x += (tx - part.rotation.x) * k;
        part.rotation.y += (ty - part.rotation.y) * k;
        part.rotation.z += (tz - part.rotation.z) * k;
      };
      const armSwing = 0.38 * this.blend * (1 - this.airK);
      const legSwing = 0.30 * this.blend * (1 - this.airK);
      damp(this.limb.lArm, sw * armSwing + idle - this.airK * 0.14, 0, 0.03 + this.airK * 0.20);
      damp(this.limb.rArm, -sw * armSwing + idle - this.airK * 0.14, 0, -0.03 - this.airK * 0.20);
      damp(this.limb.lLeg, -sw * legSwing - this.airK * 0.22, 0, 0);
      damp(this.limb.rLeg, sw * legSwing + this.airK * 0.12, 0, 0);
    } else {
      // 'rigid' 折中方案：朝向随步频左右微摆（叠加在 modelYaw 之上），
      // 配合起伏/侧摆营造迈步感，全程无网格变形。
      this.model.rotation.y = this.modelBaseYaw
        + Math.sin(this.bob * 0.5) * 0.05 * this.blend * (1 - this.airK);
    }

    // 脚步声（起伏相位过零时踩一步）
    const phase = Math.sin(this.bob);
    const inWater = groundFinal < WATER_LEVEL + 0.12 && this.pos.y < WATER_LEVEL + 0.2;
    if (this.onGround && this.blend > 0.4) {
      if ((this.lastPhase > 0 && phase <= 0) || (this.lastPhase < 0 && phase >= 0)) {
        if (world.onFootstep) world.onFootstep(inWater);
        // 涉水涟漪
        if (inWater && speed > 0.6 && world.spawnRipple) {
          world.spawnRipple(this.pos.x, this.pos.z);
          this.rippleT = 0.38;
        }
      }
    }
    this.lastPhase = phase;
    // 涉水行走时持续泛涟漪
    if (inWater && this.onGround && speed > 0.6 && world.spawnRipple) {
      this.rippleT -= dt;
      if (this.rippleT <= 0) {
        world.spawnRipple(this.pos.x, this.pos.z);
        this.rippleT = 0.38;
      }
    }

    this._motionState.speed = speed;
    this._motionState.inWater = inWater;
    this._motionState.dashing = dashing;
    return this._motionState;
  }

  /** 落水救援：送回检查点（或关卡起点） */
  respawn(pt) {
    this.pos.set(pt.x, pt.y, pt.z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.onGround = true;
    this.airK = 0;
    this.blend = 0;
    this.dashTime = 0;
    this.squash = 0.08; // 落台小压扁，给个着地反馈
  }
}

/* ---------------- 第三人称相机 ---------------- */

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.35;  // 自然俯仰：可抬头看天与房顶，也可俯瞰地面
    this.dist = 6.0;
    this.current = new THREE.Vector3();
    this.initialized = false;
    this.lookAt = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.rayHits = [];
    this.rayNear = 0.05;
    this.smoothDist = 6.0;
    this._focus = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
  }

  update(dt, target, height, drag, occluders) {
    if (drag) {
      this.yaw -= drag.dragX * 0.0045;
      // 俯仰范围：-0.2（微仰视天空/屋顶）到 0.95（大俯视），不钻地不朝天
      this.pitch = Math.min(0.95, Math.max(-0.2, this.pitch + drag.dragY * 0.0035));
      if (drag.wheel) this.dist = Math.min(12, Math.max(2.6, this.dist + drag.wheel * 0.0045));
    }

    const focus = this._focus.set(target.x, target.y + height * 0.62, target.z);
    const fullDist = this.dist;
    const dir = this._dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );

    // 防穿墙：从角色向镜头方向打射线，命中就收近（拉远快、拉近慢的手感）
    let d = fullDist;
    if (occluders && occluders.length) {
      this.ray.set(focus, dir);
      this.ray.far = fullDist + 0.4;
      this.rayHits.length = 0;
      this.ray.intersectObjects(occluders, false, this.rayHits);
      if (this.rayHits.length) d = Math.max(1.0, this.rayHits[0].distance - 0.3);
    }
    // 无遮挡时平滑回到用户设定距离；被挡时立即收近
    this.smoothDist = d < this.smoothDist ? d : this.smoothDist + (d - this.smoothDist) * Math.min(1, 3.2 * dt);

    const desired = this._desired.set(
      focus.x + dir.x * this.smoothDist,
      focus.y + dir.y * this.smoothDist + 0.35,
      focus.z + dir.z * this.smoothDist
    );

    const minY = terrainHeight(desired.x, desired.z) + 1.1;
    if (desired.y < minY) desired.y = minY;
    const minWater = WATER_LEVEL + 0.8;
    if (desired.y < minWater) desired.y = minWater;

    if (!this.initialized) {
      this.current.copy(desired);
      this.initialized = true;
    } else {
      this.current.lerp(desired, Math.min(1, 9 * dt));
    }

    this.camera.position.copy(this.current);
    this.lookAt.lerp(focus, this.initialized ? Math.min(1, 10 * dt) : 1);
    this.camera.lookAt(focus);
  }
}
