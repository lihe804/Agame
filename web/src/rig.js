import * as THREE from 'three';

/**
 * 蒙皮版伪骨骼（体型自适应）：
 * - 模型全部网格合并为一个 SkinnedMesh + 5 根骨骼（躯干/左右臂/左右腿）
 * - 肩点、手尖从顶点自动检测，手臂距离场对任意体型自适应
 * - 关节带内顶点在「肢体骨骼 ↔ 躯干骨骼」间平滑过渡，运动无缝
 *
 * 返回 { lArm, rArm, lLeg, rLeg }（Bone，直接改 .rotation）或 null。
 */

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function buildLimbRig(root) {
  try {
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    if (!meshes.length) return null;

    /* ---- 第一遍：合并所有顶点到根局部空间 ---- */
    const pieces = [];
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let total = 0;
    for (const mesh of meshes) {
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const rel = new THREE.Matrix4().copy(mesh.matrixWorld).premultiply(rootInv);
      pieces.push({ src, rel });
      total += src.attributes.position.count;
      const p = src.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(rel);
        box.expandByPoint(v);
      }
    }

    const size = new THREE.Vector3();
    box.getSize(size);
    const H = size.y;
    if (!(H > 0)) return null;
    const cx = (box.min.x + box.max.x) / 2;
    const minY = box.min.y;

    const P = new Float32Array(total * 3);
    const N = new Float32Array(total * 3);
    const hasUV = !!pieces[0].src.attributes.uv;
    const U = hasUV ? new Float32Array(total * 2) : null;

    const n = new THREE.Vector3();
    let o = 0;
    for (const pc of pieces) {
      const p = pc.src.attributes.position, no = pc.src.attributes.normal, uv = pc.src.attributes.uv;
      const nm = new THREE.Matrix3().getNormalMatrix(pc.rel);
      for (let i = 0; i < p.count; i++, o++) {
        v.fromBufferAttribute(p, i).applyMatrix4(pc.rel);
        P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
        n.fromBufferAttribute(no, i).applyMatrix3(nm).normalize();
        N[o * 3] = n.x; N[o * 3 + 1] = n.y; N[o * 3 + 2] = n.z;
        if (U) { U[o * 2] = uv.getX(i); U[o * 2 + 1] = uv.getY(i); }
      }
    }

    /* ---- 第二遍：自动检测每侧的肩点与手尖 ---- */
    function detectArm(sign) {
      const pts = [];
      for (let i = 0; i < total; i++) {
        const x = P[i * 3], y = P[i * 3 + 1];
        const yr = (y - minY) / H;
        const side = (x - cx) * sign;
        if (yr > 0.28 && yr < 0.64 && side > 0.07 * H) pts.push([x, y, yr]);
      }
      if (pts.length < 20) return null;
      pts.sort((p1, p2) => p2[1] - p1[1]); // 按 y 降序
      const nTop = Math.max(2, Math.floor(pts.length * 0.05));
      let sx = 0, sy = 0;
      for (let i = 0; i < nTop; i++) { sx += pts[i][0]; sy += pts[i][1]; }
      const shoulder = [sx / nTop, sy / nTop];
      // 手尖 = 距肩最远的候选点（取前 2% 平均防噪）
      const withD = pts.map((p) => [p[0], p[1], Math.hypot(p[0] - shoulder[0], p[1] - shoulder[1])]);
      withD.sort((p1, p2) => p2[2] - p1[2]);
      const nFar = Math.max(2, Math.floor(pts.length * 0.02));
      let hx = 0, hy = 0;
      for (let i = 0; i < nFar; i++) { hx += withD[i][0]; hy += withD[i][1]; }
      const hand = [hx / nFar, hy / nFar];
      return { shoulder, hand };
    }

    const armL = detectArm(1);
    const armR = detectArm(-1);
    if (!armL || !armR) return null;
    console.log('[rig] detected L shoulder/hand:', armL.shoulder.map((x) => +x.toFixed(2)), armL.hand.map((x) => +x.toFixed(2)),
      'R:', armR.shoulder.map((x) => +x.toFixed(2)), armR.hand.map((x) => +x.toFixed(2)));

    /* ---- 骨骼层级 ---- */
    const bones = [];
    const torso = new THREE.Bone();
    torso.name = 'torso';
    bones.push(torso);
    const mkBone = (name, x, y) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, 0);
      torso.add(b);
      bones.push(b);
      return b;
    };
    const lArm = mkBone('lArm', armL.shoulder[0], armL.shoulder[1]);
    const rArm = mkBone('rArm', armR.shoulder[0], armR.shoulder[1]);
    /* 腿骨旋转中心：取髋部略偏下（≈0.42*H），让摆动质量集中在中心下方，
     * 减少裤腰/外套下摆被带动的幅度。 */
    const lLeg = mkBone('lLeg', cx + 0.085 * H, minY + 0.42 * H);
    const rLeg = mkBone('rLeg', cx - 0.085 * H, minY + 0.42 * H);

    /* ---- 第三遍：逐顶点蒙皮权重 ---- */
    const SI = new Uint16Array(total * 4);
    const SW = new Float32Array(total * 4);

    /* 腿部品权重场（关键：该 glb 是 **1339 块碎片化面片**，相邻面片彼此不连通，
     * 只要相邻面片权重不同，摆动时就会错开露出黑缝（用户看到的"黑丝"）。
     * 因此必须让权重随位置**连续缓变**，并彻底取消一切横向硬截断。
     * 经实测几何：裤腿位于 yr<0.34 且 ax<0.12；外套下摆/手位于 yr>0.36。
     *  yrLegFull — 低于此高度：完全归腿（裤腿主体）
     *  yrLegTop  — 高于此高度：完全归躯干（外套/腰带）
     *  axCenter  — 已改为随高度变化（见下方 centerW），此处仅保留说明
     *  axOuter   — 外侧（手/外套外缘）排除的过渡起点与终点 */
    const yrLegFull = 0.34;
    const yrLegTop  = 0.45;
    const axOuterA  = 0.14;
    const axOuterB  = 0.19;

    // 手段竖直切割阈值：取「手部最内侧 ax」与「下摆最外 ax」的中点
    const handAxMin = Math.min(Math.abs(armL.hand[0] - cx), Math.abs(armR.hand[0] - cx)) / H;
    let hemAxMax = 0;
    for (let i = 0; i < total; i++) {
      const yr0 = (P[i * 3 + 1] - minY) / H;
      if (yr0 > 0.30 && yr0 < 0.46) hemAxMax = Math.max(hemAxMax, Math.abs(P[i * 3] - cx) / H);
    }
    const handCut = Math.min((handAxMin + hemAxMax) / 2, handAxMin - 0.008);
    console.log('[rig] handAxMin:', +handAxMin.toFixed(3), 'hemAxMax:', +hemAxMax.toFixed(3), 'handCut:', +handCut.toFixed(3),
      'legBand:', yrLegFull, '→', yrLegTop);

    for (let i = 0; i < total; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const yr = (y - minY) / H;
      const ax = Math.abs(x - cx) / H;
      const side = x > cx ? 1 : -1;

      // 手臂场：检测出的肩→手中轴线 3D 距离（袖子整环同权重，不劈开）
      const arm = side > 0 ? armL : armR;
      const shAx = Math.abs(arm.shoulder[0] - cx) / H;
      const hdAx = Math.abs(arm.hand[0] - cx) / H;
      const handYr = (arm.hand[1] - minY) / H;
      let a = 0;
      if (yr >= handYr - 0.02 && yr < 0.88) {
        const t = Math.min(1, Math.max(0, ((arm.shoulder[1] - minY) / H - yr) / (((arm.shoulder[1] - minY) / H) - handYr)));
        const axisAx = shAx + (hdAx - shAx) * t;
        const d = Math.hypot(ax - axisAx, z / H);
        a = 1 - smoothstep(0.040, 0.070, d);   // 放宽过渡，避免碎片网格错缝
      } else if (yr < handYr - 0.02) {
        a = smoothstep(handCut - 0.018, handCut + 0.018, ax);  // 放宽过渡
      }

      // 腿场：全程连续缓变，横向不做硬截断（硬截断 = 相邻面片权重突变 = 黑缝）
      let l = 0;
      let legBi = 0;
      if (yr < yrLegTop) {
        const yrK = yr <= yrLegFull ? 1 : 1 - smoothstep(yrLegFull, yrLegTop, yr);
        // 中缝过渡宽度随高度变化：小腿处很窄（整条腿圆周权重一致，不被劈成内外两半），
        // 越靠近胯部越宽（左右腿相差最大处改由躯干承担，避免对撕）。
        const centerW = 0.012 + 0.083 * smoothstep(0.24, 0.40, yr);
        const centerK = smoothstep(0.0, centerW, ax);
        const outerK = 1 - smoothstep(axOuterA, axOuterB, ax); // 外侧渐变，排除手/外套外缘
        const w0 = yrK * centerK * outerK;
        if (w0 > 0.001) { legBi = side > 0 ? 3 : 4; l = w0; }
      }

      // 取骨骼：手场与腿场取大；a/l 都不足则走躯干
      let w, bi;
      if (a >= l && a > 0.001) { w = a; bi = side > 0 ? 1 : 2; }
      else if (l > 0.001)       { w = l; bi = legBi; }
      else                      { w = 1; bi = 0; /* 纯躯干 */ }
      w = Math.min(1, Math.max(0, w));

      SI[i * 4] = bi;
      SW[i * 4] = w;
      SW[i * 4 + 1] = 1 - w; // 其余给躯干（恒等骨骼）
    }

    /* ---- 第四遍：三角形组装
     * 全量保留，不做任何剔除：该模型是 1339 块碎片化面片，
     * 剔除任一面片都会在表面留下可见破洞（此前"黑丝"的另一半成因）。 */
    const GP = new Float32Array(total * 3);
    const GN = new Float32Array(total * 3);
    const GU = hasUV ? new Float32Array(total * 2) : null;
    const GSI = new Uint16Array(total * 4);
    const GSW = new Float32Array(total * 4);

    let used = 0;
    for (let i = 0; i + 3 <= total; i += 3) {
      for (let k = 0; k < 3; k++) {
        const s = i + k, d = used + k;
        GP[d * 3] = P[s * 3]; GP[d * 3 + 1] = P[s * 3 + 1]; GP[d * 3 + 2] = P[s * 3 + 2];
        GN[d * 3] = N[s * 3]; GN[d * 3 + 1] = N[s * 3 + 1]; GN[d * 3 + 2] = N[s * 3 + 2];
        if (GU) { GU[d * 2] = U[s * 2]; GU[d * 2 + 1] = U[s * 2 + 1]; }
        GSI[d * 4] = SI[s * 4]; GSI[d * 4 + 1] = 0; GSI[d * 4 + 2] = 0; GSI[d * 4 + 3] = 0;
        GSW[d * 4] = SW[s * 4]; GSW[d * 4 + 1] = SW[s * 4 + 1]; GSW[d * 4 + 2] = 0; GSW[d * 4 + 3] = 0;
      }
      used += 3;
    }
    console.log('[rig] verts:', used, '/', total, '(全量保留，未剔除任何面片)');

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(GP, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(GN, 3));
    if (GU) geo.setAttribute('uv', new THREE.BufferAttribute(GU, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(GSI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(GSW, 4));

    const sm = new THREE.SkinnedMesh(geo, meshes[0].material);
    sm.name = 'limbedBody';
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.frustumCulled = false; // 蒙皮顶点会超出静止包围盒
    sm.add(torso);
    root.add(sm);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    sm.bind(skeleton, root.matrixWorld.clone());

    for (const m of meshes) m.visible = false;

    return { lArm, rArm, lLeg, rLeg };
  } catch (err) {
    console.warn('limb rig failed, fallback to simple anim', err);
    return null;
  }
}
