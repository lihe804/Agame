# 海滨小镇 · 3D 角色漫游游戏 — 交接文档

> 最后更新：2026-09-14 ｜ 状态：**阶段性完成，可运行**

---

## 1. 项目概述

网页端 3D 角色扮演漫游游戏（Three.js 0.160，无构建工具、原生 ESM）。
两名按真实比例建模的角色（刘世锦 183cm / 王梓航 150cm），在一个海滨小镇场景中自由漫游，
包含**四套注册表驱动的跳跃关卡**（深海远征 / 环屋跳高 / 登天云梯 / 潮汐远征）、计时器与前三名持久化榜单。
登天云梯共 500 个平台、20 个阶段宝箱，最高约 218m；每座宝箱奖励积分并成为高空检查点。
潮汐远征同样包含 500 个平台、20 个阶段宝箱，从东岸沿连续 S 形航线向深海延伸约 230m。

- 访问方式：`python tools/serve.py 8765 D:/code/Agame/web` → 浏览器打开 `http://127.0.0.1:8765/`
- ⚠️ serve.py 带 `no-store, no-cache` 头（防旧代码缓存），但仍建议 **Ctrl+F5** 强刷
- 操控（键盘）：WASD 移动 / 空格跳 / Shift 跑 / E 开门 / R 载入当前长关存档 / M 静音 / 鼠标点击锁定视角 / 滚轮缩放
- 操控（手柄，自动连接）：左摇杆移动（带死区、幅度控速） / A 跳 / LT 或 L1 加速 / 右摇杆视角 / 键盘可同时使用

## 2. 目录结构

```
D:\code\Agame\
├── HANDOVER.md            ← 本文档
├── PLAN.md                ← 早期里程碑规划（历史参考）
├── web\                   ← 全部运行时代码（根目录即站点根）
│   ├── index.html / style.css
│   ├── vendor\            ← three.js 本地化（three.module.js + jsm\），无 CDN 依赖
│   ├── models\            ← char1.glb / char2.glb（AI 生成，碎片化网格）
│   └── src\
│       ├── main.js        ← 入口：渲染器、选角场景、主循环、计时器/榜单/交互接线
│       ├── scene.js       ← 场景组装 + 地形高度场 + 关卡注册表 COURSES + 关卡视觉工厂
│       ├── player.js      ← 角色控制器（移动/跳跃/纯实体平台碰撞/第三人称相机）
│       ├── rig.js         ← GLB 网格 → SkinnedMesh 伪骨骼（当前 ANIM_MODE 未启用）
│       ├── config.js      ← 角色/调色板/ANIM_MODE 开关
│       └── sfx.js         ← WebAudio 程序化音效（无外部素材）
├── tools\
│   ├── serve.py           ← 无缓存静态服务器（必须用它跑）
│   ├── inspect_glb.py     ← GLB 解析器（查碎片化程度/连通块）
│   ├── cdp-check.mjs      ← 基础 CDP 端到端脚本
│   └── cdp-sky-check.mjs  ← 双长关专项验收（500 台结构/动效/分关存档/移动端 HUD）
├── assets\models\         ← 角色模型源文件与迭代版本
└── 人物\                  ← 角色参考照片（**仅限家庭本地使用，勿外传**）
```

## 3. 核心系统速览

| 系统 | 位置 | 要点 |
|---|---|---|
| 地形高度场 | `scene.js terrainHeight()` | 分析函数，地形网格与角色落地共用同一来源 |
| 世界底海 | `scene.js buildBeachScene()` | 6000×6000 不透明深海面（y=-0.5），陆地任意方向入海 |
| 角色控制器 | `player.js Player` | AABB 碰撞 + 地形落地 + 纯实体平台（见下） |
| 平台碰撞 | `player.js ALL_PLATFORMS` | **真 3D 盒**：身体与台体体积相交才阻挡；顶面落地走 `groundAt` 单向判定 |
| 相机 | `player.js CameraRig` | 防穿墙射线 + 俯仰钳制（-0.2~0.95） |
| 角色动画 | `player.js + config.js ANIM_MODE` | 当前 `'rigid'` 整体刚体动画（起伏/压扁），无网格变形 |
| 音效 | `sfx.js` | WebAudio 合成，M 键静音 |
| 登天云梯 | `scene.js` + `main.js` | 500 台分 20 段；120 个 orbit/lift/shuttle 动态台；房屋区域全高度禁飞 |
| 潮汐远征 | `scene.js` + `main.js` | 500 台纵深 S 形海路；384 个动态台；未开本段宝箱时后段平台不可落地 |
| 积分与分关存档 | `main.js` + `index.html` | 双长关分栏保存；HUD 一键刷新全部积分、宝箱与检查点；自动迁移旧云梯存档 |
| 手柄 | `player.js createInput().updateGamepad()` | 主循环每帧轮询 `navigator.getGamepads()`；左摇杆径向死区 0.12 + 幅度控速（`input.mx/my` 模拟量，Player.update 与键盘开关量叠加）；A=跳（buttons[0]）、L2/L1=加速（buttons[6]/[4]）、右摇杆=视角（axes[2]/[3]，径向死区 0.12，全杆偏航 ≈144°/s，增量按秒折算并入 dragX/dragY）；键盘与手柄状态每帧合并（`jumpKey||jumpPad`），键盘 keyup 不会误清手柄按住的状态 |
| 性能 | `scene.js` 末尾 + `main.js` | 见 §6 |

## 4. ⭐ 关卡扩展指南（核心接口）

**所有关卡由 `scene.js` 顶部的 `COURSES` 注册表驱动。新增一关 = 加一个定义对象，其余全自动：**
碰撞（纯实体）、落地判定、计时器、前三名榜单（localStorage 持久化）、宝箱/旗子/彩带、榜牌、
通关提示——无需改动 player.js / main.js 的任何逻辑。

### 关卡定义字段

```js
// scene.js → COURSES 数组中追加：
{
  id: 'my-level',                    // 唯一 id（计时器/榜单存档键 wb-board-<id>）
  name: '我的关卡',                   // 通关提示显示名
  style: 'float',                    // 'sea'=桩柱浮台 | 'float'=悬空台 | 'sky'=高空实例化云梯
  platforms: [                       // platforms[0] = 起点台（踩上即开始计时）
    { x: 10, z: 30, top: 2.0, half: 0.85 },
    { x: 12, z: 32, top: 2.4, half: 0.85, prop: 'palm' },  // prop:'palm'=棕榈树冠跳台
    { x: 14, z: 34, top: 2.8, half: 0.5, motion: { type:'lift', baseTop:2.8, amplitude:0.08, speed:1.2, phase:0 } },
    { x: 17, z: 35, top: 3.2, half: 0.95, reward: { id:'stage-1', stage:1, points:250 } },
    // ...
    { x: 20, z: 40, top: 6.0, half: 2.4 },                 // 半宽>2 自动用金边终点台样式
  ],
  goal: { x: 20, z: 40, top: 6.0, half: 2.4 },           // 终点（靠近宝箱通关）
  board: { x: 8, z: 28, rot: 0.8 },  // 榜牌位置与朝向（弧度）；省略则无榜牌
}
```

### 布点硬约束（违反会重叠/撞墙/跳不过）

1. **相邻平台中心距 ∈ [2.8, 3.2]**：≥2.8 防视觉重叠；≤3.2 保证跳跃弧线在进入目标台范围前
   已高出台面（纯实体侧壁会弹开弧线不足的跳越）
2. **每级升幅 ≤ 0.65**（跳跃顶点 0.94m）
3. 间隙（中心距 − 两台 half 之和）≤ 2.0 = 步行跳极限；>2.3 必须助跑跳（Shift）
4. 平台不要落在其他关卡终点/房屋 footprint 内（实体会互相干扰）

### 计时与榜单规则（自动生效）

- 踩上 `platforms[0]` → 开始计时（重复踩上 = 重新计时）
- 靠近终点宝箱（距离 < half×0.75+0.2）→ 停表、彩带、音效、成绩上榜
- **落回地面（|pos.y − terrainHeight| < 0.15）→ 计时立即结束，成绩作数**
- 掉回低台阶不结束计时；海里落水自动送回起点台并重新计时
- 榜单存档键：`localStorage['wb-board-<id>']`，最多 3 组最好成绩
- 长关阶段宝箱：每 25 台一座，打开后自动加分并更新对应关卡检查点
- 存档：云端与潮汐进度分别保存；宝箱自动记录阶段/高度/台号，按 `R` 在对应长关附近载入
- 防捷径：两个 500 台长关都按 25 台分段，完成当前段宝箱后才解锁下一段实体碰撞
- 动态台：`motion.type` 支持 `orbit`（绕轴旋转）/ `lift`（升降）/ `shuttle`（横向往返）/ `wave`（波浪漂移）

### 更大的扩展点

- **新道具跳台**：`makeCourseVisual()` 里仿照 `prop === 'palm'` 分支加类型（如岩石顶、屋顶）
- **新平台样式**：`def.style` 分支（现 `'sea'`/`'float'`/`'sky'`）内加视觉变体
- **角色**：`config.js CHARACTERS` 加条目 + GLB 放入 `web/models/`；`ANIM_MODE` 详见 §5

## 5. 已知限制与重要注意事项

1. **模型是碎片化网格**（inspect_glb.py 实测 1339 块互不连通面片）——这是历次
   “撕裂/黑丝/残影”问题的总根源。顶点蒙皮在此类网格上无解，故角色动画走整体刚体方案。
   **若未来换用带正规骨架的模型（如 Mixamo 重定向）**：`config.js` 把 `ANIM_MODE` 改为
   `'limb'` 即可启用 `rig.js` 伪骨骼摆臂摆腿（代码保留未删）。
2. **地面行走会碰撞低空平台**：平台是实体，悬浮低于 1.9m 的台体在地面走位时会被阻挡——
   这是“纯实体”的物理代价，布新关卡时把低空台放在路线附近而非步行道上。
3. **浏览器验收**：本机已有 Chrome/Playwright Chromium；无头启动需可写 profile，专项脚本为 `tools/cdp-sky-check.mjs`。
4. **角色照片隐私**：`人物/` 目录为真人参考照，仅限本地家庭使用，严禁上传/外传。
5. 必须用 `tools/serve.py` 启动（带 no-cache 头）；直接双击 index.html 会因 ESM/CORS 失败。

## 6. 性能优化清单（已做，改场景时请保持）

- 像素比封顶 1.75 + `powerPreference: 'high-performance'`
- 包围球 <0.45 的小物件不投影（`scene.js` 末尾遍历）
- 静态物体矩阵冻结（`matrixAutoUpdate=false`）；**动画对象必须标 `userData.animated = true`**
  （遍历会跳过它及其子孙——新加动效对象忘标记 = 动画失效）
- 浪面法线每 3 帧重算；涟漪/彩带/扬尘均为对象池
- 两个 500 台长关的静态台、动态台和装饰均用 `InstancedMesh` 合批，只更新动态实例矩阵
- ⚠️ 往场景里加“每帧都在动的东西”时，记得标 `animated`；加静态物体则什么都不用做

## 7. 调试入口

- `window.__wb` = `{ state, enterExplore, camera }`（控制台可手动切场景/看状态）
- `node tools/cdp-sky-check.mjs http://127.0.0.1:8765/ .tmp/shots/sky`：
  校验两个 500 台长关、各 20 宝箱、动态台移动、房屋/旧关隔离、分关存档、`R` 载入及移动端 HUD

## 8. 版本里程碑（简）

M0-M2 角色建模与迭代 → M3 场景与漫游 → M4 肢体动画尝试（失败→刚体方案）→
M5 房屋交互 → 关卡 1 深海远征（零容错）→ 关卡 2 环屋跳高（悬空台阶）→
计时器 + 前三名榜单 → 注册表重构 → 关卡 3 登天云梯（500 台、动态平台、20 阶段宝箱）→
关卡 4 潮汐远征（500 台海面蛇形路线、动态台、独立存档）。
