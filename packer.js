/**
 * 3D装箱模拟器算法核心模块 - packer.js (v2.3 极致优化版)
 * 
 * 升级为：多起点局部搜索最佳适配算法 (Multi-Start Best-Fit Scoring Heuristic)
 * 1. 空间接触面积计算 (Contact Area Maximization)：使箱子自动紧贴容器边角或其他箱子，消除局部空洞。
 * 2. 词典式高度-深度评分模型 (Lexicographical Height-Depth Scoring)：强力压低重心，保证每层平整度，防止不规则凸起。
 * 3. 自适应多策略混合搜索 (Multi-Start Meta-Heuristic)：使用 5 种基础排序策略与 30 次随机打乱，配合不同的轴向压缩权重，秒级内搜索全局最优解。
 */

// 核心常量定义
const EPS_OVERLAP = 0.001;      // 碰撞检测容差
const EPS_CONTACT = 0.01;       // 接触面积计算容差
const EPS_STABILITY = 0.05;     // 稳定性检查容差
const EPS_DIMENSION = 0.1;      // 公共维度检测容差
const DEFAULT_SUPPORT_RATIO = 0.5;  // 默认最低支撑率

// 碰撞检测辅助函数：检查两个三维立方体是否在空间上重叠
function boxesOverlap(a, b, eps = EPS_OVERLAP) {
    return (
        a.x < b.x + b.w - eps && a.x + a.w > b.x + eps &&
        a.y < b.y + b.h - eps && a.y + a.h > b.y + eps &&
        a.z < b.z + b.d - eps && a.z + a.d > b.z + eps
    );
}

// 物品类定义
class Item {
    constructor(id, name, w, h, d, color = '#3b82f6', weight = 0) {
        this.id = id;          // 唯一标识符
        this.name = name;      // 名称
        this.w = w;            // 原始宽度
        this.h = h;            // 原始高度
        this.d = d;            // 原始深度
        this.color = color;    // 渲染颜色
        this.weight = weight;  // 重量
        
        // 放置坐标 (以容器左下后角为原点)
        this.x = 0;
        this.y = 0;
        this.z = 0;
        
        // 旋转后的尺寸 (默认不旋转)
        this.rw = w;
        this.rh = h;
        this.rd = d;
        this.rotationType = 0; // 0 到 5 种旋转状态
    }

    // 获取某个旋转状态下的尺寸
    getRotatedDimensions(rotationType) {
        // 6种旋转朝向定义：
        // 0: [W, H, D] - 原始状态
        // 1: [W, D, H]
        // 2: [H, W, D]
        // 3: [H, D, W]
        // 4: [D, W, H]
        // 5: [D, H, W]
        switch (rotationType) {
            case 0: return [this.w, this.h, this.d];
            case 1: return [this.w, this.d, this.h];
            case 2: return [this.h, this.w, this.d];
            case 3: return [this.h, this.d, this.w];
            case 4: return [this.d, this.w, this.h];
            case 5: return [this.d, this.h, this.w];
            default: return [this.w, this.h, this.d];
        }
    }

    // 设置旋转状态
    setRotation(rotationType) {
        const [rw, rh, rd] = this.getRotatedDimensions(rotationType);
        this.rw = rw;
        this.rh = rh;
        this.rd = rd;
        this.rotationType = rotationType;
    }
}

// 装箱核心类
class Packer {
    static DEFAULT_SCORE_WEIGHTS = {
        packedCount: 10000000,
        packedVolume: 10,
        maxHeightPenalty: 100,
        contactArea: 0.1,
        w_y: 100000
    };

    // 3D 碰撞检测辅助方法：检查指定空间位置及尺寸是否与任何已放置物体冲突（无临时对象分配，高性能）
    static checkCollision(px, py, pz, rw, rh, rd, placed, eps = EPS_OVERLAP) {
        for (let i = 0; i < placed.length; i++) {
            const p = placed[i];
            if (px < p.x + p.rw - eps && px + rw > p.x + eps &&
                py < p.y + p.rh - eps && py + rh > p.y + eps &&
                pz < p.z + p.rd - eps && pz + rd > p.z + eps) {
                return true;
            }
        }
        return false;
    }

    // 2D 碰撞检测辅助方法：无临时对象分配，高性能
    static checkCollision2D(px, py, rw, rh, placedList, eps = EPS_OVERLAP) {
        for (let i = 0; i < placedList.length; i++) {
            const p = placedList[i];
            if (px < p.x + p.w - eps && px + rw > p.x + eps &&
                py < p.y + p.h - eps && py + rh > p.y + eps) {
                return true;
            }
        }
        return false;
    }

    // Mulberry32 确定性随机数发生器
    static mulberry32(seed) {
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // 获取物品独特的非对称三维方向，避免重复计算
    static getUniqueOrientations(item) {
        const orientations = [];
        const seen = new Set();
        for (let rType = 0; rType < 6; rType++) {
            const [rw, rh, rd] = item.getRotatedDimensions(rType);
            const key = `${rw}_${rh}_${rd}`;
            if (!seen.has(key)) {
                seen.add(key);
                orientations.push({ rw, rh, rd, rotationType: rType });
            }
        }
        return orientations;
    }

    // 自动校验装载结果是否合法，返回 { valid: boolean, errors: Array }
    static validatePackingResult(placed, binW, binH, binD, checkStability = true, supportRatio = DEFAULT_SUPPORT_RATIO) {
        const errors = [];
        const eps = EPS_OVERLAP;

        for (let i = 0; i < placed.length; i++) {
            const item = placed[i];
            
            // 越界检查
            if (item.x < -eps || item.y < -eps || item.z < -eps) {
                errors.push({ type: 'NEGATIVE_POSITION', item, detail: `Position is negative: (${item.x}, ${item.y}, ${item.z})` });
            }
            if (item.x + item.rw > binW + eps || item.y + item.rh > binH + eps || item.z + item.rd > binD + eps) {
                errors.push({ type: 'OUT_OF_BOUNDS', item, detail: `Out of container boundaries: max limit (${binW}, ${binH}, ${binD}), got (${item.x + item.rw}, ${item.y + item.rh}, ${item.z + item.rd})` });
            }

            // 重叠冲突检查
            for (let j = i + 1; j < placed.length; j++) {
                const other = placed[j];
                if (item.x < other.x + other.rw - eps && item.x + item.rw > other.x + eps &&
                    item.y < other.y + other.rh - eps && item.y + item.rh > other.y + eps &&
                    item.z < other.z + other.rd - eps && item.z + item.rd > other.z + eps) {
                    errors.push({ type: 'OVERLAP', itemA: item, itemB: other, detail: `Overlap detected between items ${item.id} and ${other.id}` });
                }
            }

            // 支撑性检查
            if (checkStability && item.y > 0) {
                let supportedArea = 0;
                const bottomArea = item.rw * item.rd;
                for (let j = 0; j < placed.length; j++) {
                    if (i === j) continue;
                    const pItem = placed[j];
                    if (Math.abs((pItem.y + pItem.rh) - item.y) < EPS_STABILITY) {
                        const xOverlap = Math.max(0, Math.min(item.x + item.rw, pItem.x + pItem.rw) - Math.max(item.x, pItem.x));
                        const zOverlap = Math.max(0, Math.min(item.z + item.rd, pItem.z + pItem.rd) - Math.max(item.z, pItem.z));
                        supportedArea += xOverlap * zOverlap;
                    }
                }
                if ((supportedArea / bottomArea) < supportRatio - eps) {
                    errors.push({ type: 'UNSTABLE', item, detail: `Insufficient support: expected ratio ${supportRatio}, got ${(supportedArea / bottomArea).toFixed(3)}` });
                }
            }
        }

        return { valid: errors.length === 0, errors };
    }

    constructor(binW, binH, binD) {
        this.binW = binW; // 容器宽度
        this.binH = binH; // 容器高度
        this.binD = binD; // 容器深度
        this.items = [];  // 已成功装入的物品
        this.unpacked = []; // 未能装入的物品
    }

    // 执行多起点最佳适配装箱算法（多维启发式与局部扰动搜索）
    pack(itemsToPack, options = {}) {
        const checkStability = options.checkStability !== false; // 是否校验重力支撑
        const supportRatio = options.supportRatio !== undefined ? options.supportRatio : DEFAULT_SUPPORT_RATIO; // 支撑面积占比阈值

        this.items = [];
        this.unpacked = [];

        // 0. 尝试公维对齐层级回溯策略
        const layerPacked = this.tryLayerBacktrackingPack(itemsToPack, checkStability, supportRatio);
        if (layerPacked) {
            this.items = layerPacked;
            this.unpacked = [];
            return;
        }

        // 1. 降级为单线程贪心搜索
        const numTrials = itemsToPack.length > 200 ? 15 : (itemsToPack.length > 100 ? 30 : 60);
        const bestPacking = this.runGreedyPackTrials(itemsToPack, options, 0, numTrials);

        this.items = bestPacking.items;
        this.unpacked = bestPacking.unpacked;
    }

    // 执行子范围区间的贪心装箱试验
    runGreedyPackTrials(itemsToPack, options = {}, startTrial, numTrials) {
        const checkStability = options.checkStability !== false;
        const supportRatio = options.supportRatio !== undefined ? options.supportRatio : DEFAULT_SUPPORT_RATIO;

        let bestPacking = { items: [], unpacked: [], score: -Infinity };
        let bestScore = -Infinity;

        const strategies = [
            (list) => [...list].sort((a, b) => (b.w * b.h * b.d) - (a.w * a.h * a.d)),
            (list) => [...list].sort((a, b) => Math.max(b.w, b.h, b.d) - Math.max(a.w, a.h, a.d)),
            (list) => [...list].sort((a, b) => b.h - a.h),
            (list) => [...list].sort((a, b) => (b.w * b.d) - (a.w * a.d)),
            (list) => [...list].sort((a, b) => b.w - a.w),
            (list) => [...list].sort((a, b) => b.d - a.d),
            (list) => [...list].sort((a, b) => (b.weight || 0) - (a.weight || 0)),
            (list) => [...list].sort((a, b) => {
                const volA = a.w * a.h * a.d;
                const volB = b.w * b.h * b.d;
                return ((b.weight || 0) / volB) - ((a.weight || 0) / volA);
            }),
            (list) => [...list].sort((a, b) => (a.w * a.h * a.d) - (b.w * b.h * b.d))
        ];

        const perturbList = (list, strategyIdx, rng) => {
            const baseSorted = strategies[strategyIdx % strategies.length](list);
            return baseSorted
                .map((item, idx) => ({
                    item,
                    key: idx + (rng() * 16 - 8)
                }))
                .sort((a, b) => a.key - b.key)
                .map(x => x.item);
        };

        const limitEnd = startTrial + numTrials;

        for (let trial = startTrial; trial < limitEnd; trial++) {
            const rng = Packer.mulberry32(20260617 + trial);
            let sortedItems;
            let lookAheadK = 1;
            
            if (trial < strategies.length * 2) {
                const strategyIdx = trial % strategies.length;
                lookAheadK = trial < strategies.length ? 1 : 8;
                sortedItems = strategies[strategyIdx](itemsToPack);
            } else {
                const strategyIdx = Math.floor(rng() * strategies.length);
                sortedItems = perturbList(itemsToPack, strategyIdx, rng);
                const kOptions = [1, 2, 4, 8, 12, 16, 24, 32, 48, 9999];
                lookAheadK = kOptions[Math.floor(rng() * kOptions.length)];
            }

            const scoreWeights = options.weights || Packer.DEFAULT_SCORE_WEIGHTS;
            let w_y = scoreWeights.w_y !== undefined ? scoreWeights.w_y : 100000;
            let w_z, w_x;
            if (trial % 3 === 0) {
                w_z = 1000;
                w_x = 1;
            } else if (trial % 3 === 1) {
                w_z = 1;
                w_x = 1000;
            } else {
                w_z = 100;
                w_x = 100;
            }

            const currentPacking = this.runSinglePack(sortedItems, checkStability, supportRatio, w_y, w_z, w_x, lookAheadK);

            // 自动校验所生成结果的合法性
            const validation = Packer.validatePackingResult(currentPacking.items, this.binW, this.binH, this.binD, checkStability, supportRatio);
            if (!validation.valid) {
                console.warn("Trial result validation failed:", validation.errors);
                continue; // 丢弃非法的解
            }

            const packedCount = currentPacking.items.length;
            let packedVolume = 0;
            let maxHeight = 0;
            for (const item of currentPacking.items) {
                packedVolume += item.rw * item.rh * item.rd;
                if (item.y + item.rh > maxHeight) {
                    maxHeight = item.y + item.rh;
                }
            }
            const totalContact = this.calculateTotalContactArea(currentPacking.items);
            const trialScore = packedCount * scoreWeights.packedCount + 
                               packedVolume * scoreWeights.packedVolume - 
                               maxHeight * scoreWeights.maxHeightPenalty + 
                               totalContact * scoreWeights.contactArea;

            if (trialScore > bestScore) {
                bestScore = trialScore;
                bestPacking = {
                    items: currentPacking.items.map(it => {
                        const clone = new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
                        clone.x = it.x;
                        clone.y = it.y;
                        clone.z = it.z;
                        clone.setRotation(it.rotationType);
                        return clone;
                    }),
                    unpacked: currentPacking.unpacked.map(it => {
                        return new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
                    }),
                    score: trialScore
                };
            }
        }

        return bestPacking;
    }

    // 运行单次装入模拟 (基于 EMS 最大空腔与多物前瞻的最佳适配算法)
    runSinglePack(sortedItems, checkStability, supportRatio, w_y, w_z, w_x, lookAheadK) {
        const placed = [];
        const pool = [...sortedItems]; // 待装载货物池

        // 初始时仅有 1 个代表整个容器的最大空腔
        let spaces = [{ x: 0, y: 0, z: 0, w: this.binW, h: this.binH, d: this.binD }];

        // EMS 切割与更新函数
        const placeBoxInEMS = (spacesList, box) => {
            const nextSpaces = [];
            for (let i = 0; i < spacesList.length; i++) {
                const s = spacesList[i];
                // 检查 s 是否与 box 在空间上重叠 (相交)
                if (s.x + s.w <= box.x + EPS_OVERLAP || box.x + box.rw <= s.x + EPS_OVERLAP ||
                    s.y + s.h <= box.y + EPS_OVERLAP || box.y + box.rh <= s.y + EPS_OVERLAP ||
                    s.z + s.d <= box.z + EPS_OVERLAP || box.z + box.rd <= s.z + EPS_OVERLAP) {
                    // 没有重叠，保留该空间
                    nextSpaces.push(s);
                    continue;
                }

                // 相交，将被 box 切割为最多 6 个子空间
                // X 轴方向切割
                if (box.x > s.x) {
                    nextSpaces.push({ x: s.x, y: s.y, z: s.z, w: box.x - s.x, h: s.h, d: s.d });
                }
                if (box.x + box.rw < s.x + s.w) {
                    nextSpaces.push({ x: box.x + box.rw, y: s.y, z: s.z, w: (s.x + s.w) - (box.x + box.rw), h: s.h, d: s.d });
                }
                // Y 轴方向切割
                if (box.y > s.y) {
                    nextSpaces.push({ x: s.x, y: s.y, z: s.z, w: s.w, h: box.y - s.y, d: s.d });
                }
                if (box.y + box.rh < s.y + s.h) {
                    nextSpaces.push({ x: s.x, y: box.y + box.rh, z: s.z, w: s.w, h: (s.y + s.h) - (box.y + box.rh), d: s.d });
                }
                // Z 轴方向切割
                if (box.z > s.z) {
                    nextSpaces.push({ x: s.x, y: s.y, z: s.z, w: s.w, h: s.h, d: box.z - s.z });
                }
                if (box.z + box.rd < s.z + s.d) {
                    nextSpaces.push({ x: s.x, y: s.y, z: box.z + box.rd, w: s.w, h: s.h, d: (s.z + s.d) - (box.z + box.rd) });
                }
            }

            // 过滤并合并包含在其它空腔中的子空腔
            const pruned = [];
            for (let i = 0; i < nextSpaces.length; i++) {
                const s1 = nextSpaces[i];
                if (s1.w <= EPS_OVERLAP || s1.h <= EPS_OVERLAP || s1.d <= EPS_OVERLAP) {
                    continue;
                }

                let isContained = false;
                for (let j = 0; j < nextSpaces.length; j++) {
                    if (i === j) continue;
                    const s2 = nextSpaces[j];
                    if (s1.x >= s2.x - EPS_OVERLAP &&
                        s1.y >= s2.y - EPS_OVERLAP &&
                        s1.z >= s2.z - EPS_OVERLAP &&
                        s1.x + s1.w <= s2.x + s2.w + EPS_OVERLAP &&
                        s1.y + s1.h <= s2.y + s2.h + EPS_OVERLAP &&
                        s1.z + s1.d <= s2.z + s2.d + EPS_OVERLAP) {
                        isContained = true;
                        break;
                    }
                }
                if (!isContained) {
                    pruned.push(s1);
                }
            }
            return pruned;
        };

        while (pool.length > 0) {
            let bestChoice = null;
            let maxScore = -Infinity;

            // 限制前瞻窗口范围为：[1, 货物池长度] 之间的有效值
            const k = Math.max(1, Math.min(lookAheadK, pool.length));

            // 1. 尝试从前瞻窗口内的 K 个货物中选取最适配的进行码放
            // 采用货物品质类型去重优化，确保相同规格的货物只被校验一次
            const processedTypesInWindow = new Set();
            for (let i = 0; i < k; i++) {
                const item = pool[i];
                const itemTypeKey = `${item.name}_${item.w}_${item.h}_${item.d}_${item.weight || 0}`;
                if (processedTypesInWindow.has(itemTypeKey)) continue;
                processedTypesInWindow.add(itemTypeKey);

                // 获取唯一的非对称旋转方向
                const uniqueOrientations = Packer.getUniqueOrientations(item);

                for (let sIdx = 0; sIdx < spaces.length; sIdx++) {
                    const s = spaces[sIdx];
                    const px = s.x;
                    const py = s.y;
                    const pz = s.z;

                    for (let rIdx = 0; rIdx < uniqueOrientations.length; rIdx++) {
                        const rot = uniqueOrientations[rIdx];
                        const rw = rot.rw;
                        const rh = rot.rh;
                        const rd = rot.rd;

                        // 尺寸可行性检查 (是否能完全放入该 EMS 空腔)
                        if (rw > s.w + EPS_OVERLAP || rh > s.h + EPS_OVERLAP || rd > s.d + EPS_OVERLAP) {
                            continue;
                        }

                        // 越界检查 (防止 epsilon 累积误差)
                        if (px + rw > this.binW || py + rh > this.binH || pz + rd > this.binD) {
                            continue;
                        }

                        // 重力支撑性检查
                        if (checkStability && py > 0) {
                            let supportedArea = 0;
                            const bottomArea = rw * rd;
                            for (let pIdx = 0; pIdx < placed.length; pIdx++) {
                                const pItem = placed[pIdx];
                                if (Math.abs((pItem.y + pItem.rh) - py) < EPS_STABILITY) {
                                    const xOverlap = Math.max(0, Math.min(px + rw, pItem.x + pItem.rw) - Math.max(px, pItem.x));
                                    const zOverlap = Math.max(0, Math.min(pz + rd, pItem.z + pItem.rd) - Math.max(pz, pItem.z));
                                    supportedArea += xOverlap * zOverlap;
                                }
                            }
                            if ((supportedArea / bottomArea) < supportRatio) {
                                continue;
                            }
                        }

                        // 契合度与壁面接触评分 (传扁平参数，避免分配临时对象)
                        const contact = this.getPlacementContactArea(px, py, pz, rw, rh, rd, placed, item.id);
                        const score = - (py + rh) * w_y - (pz + rd) * w_z - (px + rw) * w_x + contact * 10;

                        if (score > maxScore) {
                            maxScore = score;
                            bestChoice = { poolIndex: i, x: px, y: py, z: pz, rotationType: rot.rotationType, rw, rh, rd, item };
                        }
                    }
                }
            }

            // 2. 如果前瞻窗口内的所有货物由于尺寸或稳定性限制均无法装载，则扫描窗口外的剩余货物
            if (!bestChoice && k < pool.length) {
                const processedTypesOutsideWindow = new Set();
                for (let i = k; i < pool.length; i++) {
                    const item = pool[i];
                    const itemTypeKey = `${item.name}_${item.w}_${item.h}_${item.d}_${item.weight || 0}`;
                    if (processedTypesOutsideWindow.has(itemTypeKey)) continue;
                    processedTypesOutsideWindow.add(itemTypeKey);

                    const uniqueOrientations = Packer.getUniqueOrientations(item);

                    for (let sIdx = 0; sIdx < spaces.length; sIdx++) {
                        const s = spaces[sIdx];
                        const px = s.x;
                        const py = s.y;
                        const pz = s.z;

                        for (let rIdx = 0; rIdx < uniqueOrientations.length; rIdx++) {
                            const rot = uniqueOrientations[rIdx];
                            const rw = rot.rw;
                            const rh = rot.rh;
                            const rd = rot.rd;

                            if (rw > s.w + EPS_OVERLAP || rh > s.h + EPS_OVERLAP || rd > s.d + EPS_OVERLAP) {
                                continue;
                            }

                            if (px + rw > this.binW || py + rh > this.binH || pz + rd > this.binD) {
                                continue;
                            }

                            if (checkStability && py > 0) {
                                let supportedArea = 0;
                                const bottomArea = rw * rd;
                                for (let pIdx = 0; pIdx < placed.length; pIdx++) {
                                    const pItem = placed[pIdx];
                                    if (Math.abs((pItem.y + pItem.rh) - py) < EPS_STABILITY) {
                                        const xOverlap = Math.max(0, Math.min(px + rw, pItem.x + pItem.rw) - Math.max(px, pItem.x));
                                        const zOverlap = Math.max(0, Math.min(pz + rd, pItem.z + pItem.rd) - Math.max(pz, pItem.z));
                                        supportedArea += xOverlap * zOverlap;
                                    }
                                }
                                if ((supportedArea / bottomArea) < supportRatio) {
                                    continue;
                                }
                            }

                            const contact = this.getPlacementContactArea(px, py, pz, rw, rh, rd, placed, item.id);
                            const score = - (py + rh) * w_y - (pz + rd) * w_z - (px + rw) * w_x + contact * 10;

                            if (score > maxScore) {
                                maxScore = score;
                                bestChoice = { poolIndex: i, x: px, y: py, z: pz, rotationType: rot.rotationType, rw, rh, rd, item };
                            }
                        }
                    }
                }
            }

            // C. 提交并放置挑选出来的最优货物，并从剩余池中移除它
            if (bestChoice) {
                const item = bestChoice.item;
                const placedItem = new Item(item.id, item.name, item.w, item.h, item.d, item.color, item.weight);
                placedItem.x = bestChoice.x;
                placedItem.y = bestChoice.y;
                placedItem.z = bestChoice.z;
                placedItem.setRotation(bestChoice.rotationType);
                placed.push(placedItem);

                // 更新 EMS 空腔列表
                spaces = placeBoxInEMS(spaces, placedItem);

                pool.splice(bestChoice.poolIndex, 1);
            } else {
                // 如果池内剩余任何货物在所有可行空间下均无法码放，则装箱结束
                break;
            }
        }

        return { items: placed, unpacked: pool };
    }

    // 计算单个候选盒放置时的壁面及物体接触面积 (cm²) - 支持扁平坐标和尺寸参数以避免临时对象分配
    getPlacementContactArea(boxOrX, placedOrPy, pz, rw, rh, rd, placed, boxId) {
        let px, py, pzVal, rwVal, rhVal, rdVal, placedList, idVal;
        const eps = EPS_CONTACT;

        if (typeof boxOrX === 'object') {
            const box = boxOrX;
            px = box.x;
            py = box.y;
            pzVal = box.z;
            rwVal = box.rw;
            rhVal = box.rh;
            rdVal = box.rd;
            placedList = placedOrPy;
            idVal = box.id;
        } else {
            px = boxOrX;
            py = placedOrPy;
            pzVal = pz;
            rwVal = rw;
            rhVal = rh;
            rdVal = rd;
            placedList = placed;
            idVal = boxId;
        }

        let contact = 0;

        // 与容器内壁接触
        if (py < eps) contact += rwVal * rdVal; // 底面
        if (px < eps) contact += rhVal * rdVal; // 左面
        if (pzVal < eps) contact += rwVal * rhVal; // 后面
        if (Math.abs(px + rwVal - this.binW) < eps) contact += rhVal * rdVal; // 右面
        if (Math.abs(pzVal + rdVal - this.binD) < eps) contact += rwVal * rhVal; // 前面

        // 与其它放置物品的面接触
        for (let i = 0; i < placedList.length; i++) {
            const item = placedList[i];
            if (item.x === px && item.y === py && item.z === pzVal && item.rw === rwVal && item.rh === rhVal && item.rd === rdVal) continue;
            if (idVal !== undefined && item.id === idVal) continue;

            // X 轴邻接 (左右接触)
            if (Math.abs(px + rwVal - item.x) < eps || Math.abs(item.x + item.rw - px) < eps) {
                const yOverlap = Math.max(0, Math.min(py + rhVal, item.y + item.rh) - Math.max(py, item.y));
                const zOverlap = Math.max(0, Math.min(pzVal + rdVal, item.z + item.rd) - Math.max(pzVal, item.z));
                contact += yOverlap * zOverlap;
            }
            // Y 轴邻接 (上下接触)
            if (Math.abs(py + rhVal - item.y) < eps || Math.abs(item.y + item.rh - py) < eps) {
                const xOverlap = Math.max(0, Math.min(px + rwVal, item.x + item.rw) - Math.max(px, item.x));
                const zOverlap = Math.max(0, Math.min(pzVal + rdVal, item.z + item.rd) - Math.max(pzVal, item.z));
                contact += xOverlap * zOverlap;
            }
            // Z 轴邻接 (前后接触)
            if (Math.abs(pzVal + rdVal - item.z) < eps || Math.abs(item.z + item.rd - pzVal) < eps) {
                const xOverlap = Math.max(0, Math.min(px + rwVal, item.x + item.rw) - Math.max(px, item.x));
                const yOverlap = Math.max(0, Math.min(py + rhVal, item.y + item.rh) - Math.max(py, item.y));
                contact += xOverlap * yOverlap;
            }
        }

        return contact;
    }

    // 计算整体装载方案的总体接触面积
    calculateTotalContactArea(placed) {
        let total = 0;
        for (let i = 0; i < placed.length; i++) {
            const box = placed[i];
            total += this.getPlacementContactArea(box, placed);
        }
        return total / 2; // 去重折半
    }

    // 静态辅助方法：执行重力落底
    // 给定物品在 X-Z 平面的位置与尺寸，计算其在 Y 轴能下落到的最低合法位置
    static getGravityDropY(candidate, placedItems, binH) {
        let landingY = 0;

        for (const item of placedItems) {
            // 排除待测物自身
            if (item.id === candidate.id) continue;

            // 检测 X-Z 轴投影是否重叠
            const xOverlap = candidate.x < item.x + item.rw && candidate.x + candidate.rw > item.x;
            const zOverlap = candidate.z < item.z + item.rd && candidate.z + candidate.rd > item.z;

            if (xOverlap && zOverlap) {
                const itemTop = item.y + item.rh;
                if (itemTop > landingY) {
                    landingY = itemTop;
                }
            }
        }

        // 如果加上盒子高度超过容器高度，则返回 null
        if (landingY + candidate.rh > binH) {
            return null;
        }

        return landingY;
    }

    // 公维对齐层级回溯策略入口
    tryLayerBacktrackingPack(itemsToPack, checkStability, supportRatio) {
        return this.tryLayerBacktrackingPackWithPartitions(itemsToPack, checkStability, supportRatio, 0, 30);
    }

    // 支持指定组合范围的层级回溯分发策略
    tryLayerBacktrackingPackWithPartitions(itemsToPack, checkStability, supportRatio, startPartition, endPartition) {
        // 1. 检测是否有所有物品共同持有的特征维度 (公维)
        let commonDim = null;
        if (itemsToPack.length > 0) {
            const firstItem = itemsToPack[0];
            const candidates = [firstItem.w, firstItem.h, firstItem.d];
            for (const cand of candidates) {
                let isCommon = true;
                for (const item of itemsToPack) {
                    if (Math.abs(item.w - cand) > EPS_DIMENSION && Math.abs(item.h - cand) > EPS_DIMENSION && Math.abs(item.d - cand) > EPS_DIMENSION) {
                        isCommon = false;
                        break;
                    }
                }
                if (isCommon) {
                    commonDim = cand;
                    break;
                }
            }
        }

        if (!commonDim) return null;

        // 2. 检查 Z 轴 (深度) 是否适合作为层级对齐轴线
        const numLayers = Math.floor(this.binD / commonDim);
        if (numLayers < 1) return null;

        const crossW = this.binW;
        const crossH = this.binH;

        // 3. 提取物品在 Z 轴公维对齐后的 2D 尺寸 (w2d, h2d) 及其 3D 旋转映射关系
        const items2D = itemsToPack.map(item => {
            let w2d, h2d, rot3d_0, rot3d_2;
            if (Math.abs(item.d - commonDim) <= EPS_DIMENSION) {
                w2d = item.w;
                h2d = item.h;
                rot3d_0 = 0; // [w, h, d]
                rot3d_2 = 2; // [h, w, d]
            } else if (Math.abs(item.h - commonDim) <= EPS_DIMENSION) {
                w2d = item.w;
                h2d = item.d;
                rot3d_0 = 1; // [w, d, h]
                rot3d_2 = 4; // [d, w, h]
            } else {
                w2d = item.h;
                h2d = item.d;
                rot3d_0 = 3; // [h, d, w]
                rot3d_2 = 5; // [d, h, w]
            }
            return {
                name: item.name,
                w2d,
                h2d,
                rot3d_0,
                rot3d_2,
                originalItem: item
            };
        });

        // 4. 按产品名称进行分组统计
        const itemTypes = [];
        const typeMap = new Map();
        for (const item of items2D) {
            const key = item.name;
            if (!typeMap.has(key)) {
                typeMap.set(key, {
                    name: item.name,
                    w2d: item.w2d,
                    h2d: item.h2d,
                    rot3d_0: item.rot3d_0,
                    rot3d_2: item.rot3d_2,
                    originalItems: [],
                    qty: 0
                });
                itemTypes.push(typeMap.get(key));
            }
            typeMap.get(key).originalItems.push(item.originalItem);
            typeMap.get(key).qty++;
        }

        // 5. 生成所有可能的分拆方案（按层面积差异与对称性排序）
        const partitions = this.getPartitions(itemTypes, numLayers, crossW, crossH);
        if (partitions.length === 0) return null;

        // 限制索引在有效区间内
        const limitStart = Math.max(0, startPartition);
        const limitEnd = Math.min(partitions.length, endPartition);

        // 6. 依次尝试指定区间内的分拆方案，为每层调用 2D 稳定回溯求解器
        for (let pIdx = limitStart; pIdx < limitEnd; pIdx++) {
            const partition = partitions[pIdx];
            let allLayersSuccess = true;
            const layersSolutions = [];

            for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
                const layerQtyMap = partition[layerIdx];
                const layerItems = [];
                for (const type of itemTypes) {
                    const qty = layerQtyMap[type.name] || 0;
                    for (let q = 0; q < qty; q++) {
                        layerItems.push(type);
                    }
                }

                // 2D 稳定回溯求解
                const res = this.solve2D(crossW, crossH, layerItems, checkStability, supportRatio);
                if (!res.success) {
                    allLayersSuccess = false;
                    break;
                }
                layersSolutions.push(res.solutions);
            }

            if (allLayersSuccess) {
                // 成功拼合每层 2D 坐标为完整 3D 坐标
                const placed3D = [];
                // 为每个品类重设一个独立的可消费物品池，以分配唯一的 id
                const typeItemPools = new Map();
                for (const type of itemTypes) {
                    typeItemPools.set(type.name, [...type.originalItems]);
                }

                for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
                    const zOffset = layerIdx * commonDim;
                    const layerSol = layersSolutions[layerIdx];
                    for (const sol of layerSol) {
                        const original = typeItemPools.get(sol.name).pop();
                        const it = new Item(original.id, original.name, original.w, original.h, original.d, original.color, original.weight);
                        it.x = sol.x;
                        it.y = sol.y;
                        it.z = zOffset;
                        it.setRotation(sol.rotationType);
                        placed3D.push(it);
                    }
                }

                // 进行全局 3D 稳定性校验，以防万一
                if (checkStability) {
                    let stable = true;
                    for (const it of placed3D) {
                        if (it.y > 0) {
                            let supportedArea = 0;
                            const bottomArea = it.rw * it.rd;
                            for (const other of placed3D) {
                                if (other.id !== it.id && Math.abs((other.y + other.rh) - it.y) < EPS_STABILITY) {
                                    const xOverlap = Math.max(0, Math.min(it.x + it.rw, other.x + other.rw) - Math.max(it.x, other.x));
                                    const zOverlap = Math.max(0, Math.min(it.z + it.rd, other.z + other.rd) - Math.max(it.z, other.z));
                                    supportedArea += xOverlap * zOverlap;
                                }
                            }
                            if ((supportedArea / bottomArea) < supportRatio) {
                                stable = false;
                                break;
                            }
                        }
                    }
                    if (!stable) continue;
                }

                return placed3D;
            }
        }

        return null;
    }

    // 辅助函数：生成所有合理的层面积分拆组合 (采用对称偏差剪枝优化，杜绝组合数爆炸)
    getPartitions(itemTypes, numLayers, crossW, crossH) {
        const partitions = [];
        const currentPartition = Array.from({ length: numLayers }, () => ({}));
        for (const type of itemTypes) {
            for (let j = 0; j < numLayers; j++) {
                currentPartition[j][type.name] = 0;
            }
        }

        const maxArea = crossW * crossH;

        const searchPartition = (typeIdx) => {
            if (partitions.length >= 5000) return;
            if (typeIdx === itemTypes.length) {
                const layerAreas = [];
                for (let j = 0; j < numLayers; j++) {
                    let area = 0;
                    for (const type of itemTypes) {
                        area += currentPartition[j][type.name] * type.w2d * type.h2d;
                    }
                    if (area > maxArea) return;
                    layerAreas.push(area);
                }
                const clone = currentPartition.map(layer => ({ ...layer }));
                const minArea = Math.min(...layerAreas);
                const maxAreaVal = Math.max(...layerAreas);
                
                // 计算对称性得分 (数值越小代表各层分配的相同货物数量越均匀)
                let symmetryScore = 0;
                for (const type of itemTypes) {
                    const target = type.qty / numLayers;
                    for (let j = 0; j < numLayers; j++) {
                        symmetryScore += Math.abs(clone[j][type.name] - target);
                    }
                }

                partitions.push({ 
                    layers: clone, 
                    diff: maxAreaVal - minArea,
                    symmetryScore: symmetryScore
                });
                return;
            }

            const type = itemTypes[typeIdx];
            const qty = type.qty;
            const avg = qty / numLayers;
            const maxDev = Math.max(1, Math.ceil(avg * 0.4));
            const minQty = Math.max(0, Math.floor(avg - maxDev));
            const maxQty = Math.min(qty, Math.ceil(avg + maxDev));

            const distribute = (layerIdx, remainingQty) => {
                if (layerIdx === numLayers - 1) {
                    if (remainingQty >= minQty && remainingQty <= maxQty) {
                        currentPartition[layerIdx][type.name] = remainingQty;
                        searchPartition(typeIdx + 1);
                    }
                    return;
                }

                const startQ = Math.max(minQty, remainingQty - (numLayers - 1 - layerIdx) * maxQty);
                const endQ = Math.min(maxQty, remainingQty - (numLayers - 1 - layerIdx) * minQty);

                for (let q = startQ; q <= endQ; q++) {
                    currentPartition[layerIdx][type.name] = q;
                    distribute(layerIdx + 1, remainingQty - q);
                }
            };

            distribute(0, qty);
        };

        searchPartition(0);
        
        // 优先按对称性得分排序，对称性相同时按面积差异排序
        partitions.sort((a, b) => {
            if (Math.abs(a.symmetryScore - b.symmetryScore) > 0.01) {
                return a.symmetryScore - b.symmetryScore;
            }
            return a.diff - b.diff;
        });
        
        return partitions.map(p => p.layers);
    }

    // 辅助函数：2D 稳定回溯求解器
    solve2D(binW, binH, items, checkStability, supportRatio) {
        let solutions = [];
        let placed = [];
        let pool = [...items];

        pool.sort((a, b) => (b.w2d * b.h2d) - (a.w2d * a.h2d));

        let nodesVisited = 0;
        const maxNodes = 100000; // 调大上限以确保能够找到解

        const backtrack = () => {
            nodesVisited++;
            if (nodesVisited > maxNodes) return false;

            if (pool.length === 0) {
                solutions = placed.map(p => ({
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    w: p.w,
                    h: p.h,
                    rotationType: p.rotationType,
                    item: p.item
                }));
                return true;
            }

            const item = pool.pop();

            const pivots = [[0, 0]];
            for (const p of placed) {
                pivots.push([p.x + p.w, p.y]);
                pivots.push([p.x, p.y + p.h]);
            }

            const uniquePivots = [];
            const seen = new Set();
            for (const [px, py] of pivots) {
                if (px >= binW || py >= binH) continue;
                const key = `${px.toFixed(1)},${py.toFixed(1)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniquePivots.push({ x: px, y: py });
                }
            }

            uniquePivots.sort((a, b) => (a.y !== b.y) ? a.y - b.y : a.x - b.x);

            const isSquare = Math.abs(item.w2d - item.h2d) < 0.01;
            const rotations = isSquare
                ? [{ rw: item.w2d, rh: item.h2d, rot: item.rot3d_0 }]
                : [
                    { rw: item.w2d, rh: item.h2d, rot: item.rot3d_0 },
                    { rw: item.h2d, rh: item.w2d, rot: item.rot3d_2 }
                ];

            for (const r of rotations) {
                for (const pivot of uniquePivots) {
                    if (pivot.x + r.rw > binW || pivot.y + r.rh > binH) continue;

                    // 碰撞冲突检查 (无分配对象，高性能)
                    if (Packer.checkCollision2D(pivot.x, pivot.y, r.rw, r.rh, placed, EPS_OVERLAP)) {
                        continue;
                    }

                    // 2D 支撑性校验
                    if (checkStability && pivot.y > 0) {
                        let supportedWidth = 0;
                        for (const p of placed) {
                            if (Math.abs((p.y + p.h) - pivot.y) < EPS_STABILITY) {
                                const xOverlap = Math.max(0, Math.min(pivot.x + r.rw, p.x + p.w) - Math.max(pivot.x, p.x));
                                supportedWidth += xOverlap;
                            }
                        }
                        if ((supportedWidth / r.rw) < supportRatio) {
                            continue;
                        }
                    }

                    placed.push({
                        name: item.name,
                        x: pivot.x,
                        y: pivot.y,
                        w: r.rw,
                        h: r.rh,
                        rotationType: r.rot,
                        item: item.originalItem
                    });

                    if (backtrack()) return true;

                    placed.pop();
                }
            }

            pool.push(item);
            return false;
        };

        const success = backtrack();
        return { success, solutions, nodesVisited };
    }
}

// 将核心定义挂载到 window 全局变量下，以便其他脚本访问
window.boxesOverlap = boxesOverlap;
window.Item = Item;
window.Packer = Packer;
