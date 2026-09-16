// 动作方案开关：
//  'rigid' — 整体刚体动作（起伏/前倾/侧摆/朝向微摆/跳跃压扁拉伸），不做任何网格变形，
//            对碎片化 AI 网格零撕裂，当前默认。
//  'limb'  — 伪骨骼四肢摆动（SkinnedMesh 顶点变形）。当前模型是 1339 块互不连通的
//            面片拼成的，相邻面片权重不同必然错开露缝 → 撕裂/黑丝。仅当未来换上
//            带正规骨架的模型（如 Mixamo 重定向）时再启用。
export const ANIM_MODE = 'rigid';

export const CHARACTERS = [
  {
    id: 'char1',
    name: '刘世锦',
    age: 14,
    height: 1.83,
    model: './models/char1.glb',
    modelYaw: 0,
    accent: '#e2504a'
  },
  {
    id: 'char2',
    name: '王梓航',
    age: 10,
    height: 1.50,
    model: './models/char2.glb',
    modelYaw: 0,
    accent: '#4aa3e2'
  }
];

export const PALETTE = {
  sandDry: 0xf2ead2,
  sandWet: 0xcaa87b,
  grass: 0x7fb069,
  grassDark: 0x5d8f4e,
  water: 0x2f86bd,
  waterDeep: 0x1f5f8f,
  foam: 0xffffff,
  wood: 0xd0a06a,
  woodDark: 0x8a5f3a,
  roof: 0xc25b45,
  palmLeaf: 0x5aa05a,
  palmTrunk: 0x9b7248,
  rock: 0x9aa1a8,
  crate: 0xc79a63,
  umbrella: 0xe2504a
};
