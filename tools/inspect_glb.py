"""解析 GLB：输出网格/材质构成、整体包围盒、以及「按身高分层」的宽度/中缝分布。
用途：为 rig.js 的腿部品权重阈值提供真实几何依据，避免拍脑袋设阈值造成撕裂。
用法: python inspect_glb.py <glb 路径>
"""
import struct, json, sys, math

PATH = sys.argv[1] if len(sys.argv) > 1 else r"D:\code\Agame\web\models\char1.glb"

raw = open(PATH, "rb").read()
magic, version, length = struct.unpack_from("<III", raw, 0)
assert magic == 0x46546C67, "not a GLB"
off = 12
chunks = []
while off + 8 <= length:
    clen, ctype = struct.unpack_from("<II", raw, off)
    off += 8
    chunks.append((ctype, raw[off:off + clen]))
    off += clen
gltf = json.loads(chunks[0][1].decode("utf-8"))
bin_blob = b""
for ctype, blob in chunks:
    if ctype == 0x004E4942:
        bin_blob = blob

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(idx):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    fmt, csize = COMP[acc["componentType"]]
    nc = NCOMP[acc["type"]]
    stride = bv.get("byteStride") or nc * csize
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    out = []
    for i in range(acc["count"]):
        o = base + i * stride
        out.append(struct.unpack_from("<" + fmt * nc, bin_blob, o))
    return out


def mat_identity():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mat_mul(a, b):
    # glTF 列主序：result = a * b（对点先 b 后 a）
    r = [0.0] * 16
    for c in range(4):
        for row in range(4):
            s = 0.0
            for k in range(4):
                s += a[k * 4 + row] * b[c * 4 + k]
            r[c * 4 + row] = s
    return r


def trs_matrix(node):
    if "matrix" in node:
        return list(node["matrix"])
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    x, y, z, w = r
    rm = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    sm = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]
    tm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]
    return mat_mul(tm, mat_mul(rm, sm))


def apply(m, p):
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


# 构建 parent 映射
parent = {}
for i, n in enumerate(gltf.get("nodes", [])):
    for c in n.get("children", []):
        parent[c] = i


def world_matrix(ni):
    chain = []
    cur = ni
    while cur is not None:
        chain.append(cur)
        cur = parent.get(cur)
    m = mat_identity()
    for idx in reversed(chain):
        m = mat_mul(m, trs_matrix(gltf["nodes"][idx]))
    return m


print("=== GLB:", PATH, "===")
print("meshes:", len(gltf.get("meshes", [])), " materials:", len(gltf.get("materials", [])),
      " nodes:", len(gltf.get("nodes", [])), " animations:", len(gltf.get("animations", [])))

all_pts = []  # (mesh_idx, x, y, z)
mesh_infos = []
for ni, node in enumerate(gltf.get("nodes", [])):
    if "mesh" not in node:
        continue
    mi = node["mesh"]
    wm = world_matrix(ni)
    mesh = gltf["meshes"][mi]
    matnames = []
    for prim in mesh["primitives"]:
        if "material" in prim:
            matnames.append(gltf["materials"][prim["material"]].get("name", "?"))
    vcount = 0
    mpts = []
    for prim in mesh["primitives"]:
        pos = read_accessor(prim["attributes"]["POSITION"])
        vcount += len(pos)
        for p in pos:
            wp = apply(wm, p)
            mpts.append(wp)
            all_pts.append((mi, wp[0], wp[1], wp[2]))
    mesh_infos.append((mi, node.get("name", ""), matnames, vcount, mpts))

for mi, name, mats, vcount, mpts in mesh_infos:
    xs = [p[0] for p in mpts]; ys = [p[1] for p in mpts]; zs = [p[2] for p in mpts]
    print(f"  mesh[{mi}] '{name}' mats={mats} verts={vcount} "
          f"x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")

# 判定 Y 是否已是身高轴（人类模型 Y 范围应最大）
xs = [p[1] for p in all_pts]; ys = [p[2] for p in all_pts]; zs = [p[3] for p in all_pts]
print("global bbox X[%.3f,%.3f] Y[%.3f,%.3f] Z[%.3f,%.3f]" % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

minY, maxY = min(ys), max(ys)
H = maxY - minY
cx = (min(xs) + max(xs)) / 2
print("H=%.3f  cx=%.3f" % (H, cx))

# 分层统计
print("\n=== 按身高分层（yr=0 脚底，1 头顶）===")
print(" yr     count   max|x|/H   min|x|/H   near-center(<0.02H)  说明")
NB = 20
bands = [[] for _ in range(NB)]
for _, x, y, z in all_pts:
    yr = (y - minY) / H
    b = min(NB - 1, max(0, int(yr * NB)))
    bands[b].append((abs(x - cx) / H, z))

for b in range(NB):
    items = bands[b]
    yr0 = b / NB
    if not items:
        print(f" {yr0:.2f}   {0:5d}      -          -            -")
        continue
    axs = [a for a, _ in items]
    near = sum(1 for a in axs if a < 0.02) / len(axs)
    bar = "#" * int(max(axs) * 120)
    print(f" {yr0:.2f}   {len(items):5d}   {max(axs):.3f}      {min(axs):.3f}       {near:.2f}                {bar}")

# 中缝检测：找到「中心不再有顶点」的高度（裤裆分离）
print("\n=== 分层 ax 直方图（ax 0→0.30，bin 0.02）— 用来看「腿簇 / 手簇 / 外套簇」===")
NBIN = 15
for b in range(NB):
    items = bands[b]
    if not items:
        continue
    counts = [0] * NBIN
    for a, _ in items:
        k = min(NBIN - 1, int(a / 0.02))
        counts[k] += 1
    mx = max(counts) or 1
    bars = "".join(" .:-=+*#%@"[min(9, int(c / mx * 9))] for c in counts)
    print(f" yr={b/NB:.2f} n={len(items):5d} |{bars}|  " +
          " ".join(f"{i*0.02:.2f}:{counts[i]}" for i in range(NBIN) if counts[i] > 0))

print("\n=== 中缝（center gap）检测 ===")
for b in range(NB):
    items = bands[b]
    if not items:
        continue
    axs = sorted(a for a, _ in items)
    print(f" yr={b/NB:.2f}  min_ax={axs[0]:.3f}  p5_ax={axs[len(axs)//20]:.3f}  max_ax={axs[-1]:.3f}")

# ============ 连通分量分析：判断裤/衣/鞋是否为独立网格块 ============
print("\n=== 连通分量分析（连通块 = 可整块绑定的独立部件）===")
from collections import defaultdict

prim = gltf["meshes"][0]["primitives"][0]
POS = read_accessor(prim["attributes"]["POSITION"])
if "indices" in prim:
    IDX = [t[0] for t in read_accessor(prim["indices"])]
else:
    IDX = list(range(len(POS)))
nv = len(POS)
uf = list(range(nv))


def find(x):
    while uf[x] != x:
        uf[x] = uf[uf[x]]
        x = uf[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        uf[ra] = rb


for i in range(0, len(IDX) - 2, 3):
    union(IDX[i], IDX[i + 1])
    union(IDX[i + 1], IDX[i + 2])

groups = defaultdict(list)
for i in range(nv):
    groups[find(i)].append(i)
comps = sorted(groups.values(), key=len, reverse=True)
print("共 %d 个连通块；max=%d verts (%.1f%%)" % (len(comps), len(comps[0]), 100.0 * len(comps[0]) / nv))

wm = world_matrix(0)
for k, comp in enumerate(comps[:20]):
    pts = [apply(wm, POS[i]) for i in comp]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    print("  comp#%-2d verts=%-6d yr[%.2f,%.2f]  x[%.2f,%.2f]  z[%.2f,%.2f]"
          % (k, len(comp), (min(ys) - minY) / H, (max(ys) - minY) / H,
             min(xs), max(xs), min(zs), max(zs)))
