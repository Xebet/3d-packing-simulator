/**
 * 3D装箱模拟器算法核心模块 - packer.js (v2.2 智能升级版)
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

        const perturbList = (list, strategyIdx) => {
            const baseSorted = strategies[strategyIdx % strategies.length](list);
            return baseSorted
                .map((item, idx) => ({
                    item,
                    key: idx + (Math.random() * 16 - 8)
                }))
                .sort((a, b) => a.key - b.key)
                .map(x => x.item);
        };

        const limitEnd = startTrial + numTrials;

        for (let trial = startTrial; trial < limitEnd; trial++) {
            let sortedItems;
            let lookAheadK = 1;
            
            if (trial < strategies.length * 2) {
                const strategyIdx = trial % strategies.length;
                lookAheadK = trial < strategies.length ? 1 : 8;
                sortedItems = strategies[strategyIdx](itemsToPack);
            } else {
                const strategyIdx = Math.floor(Math.random() * strategies.length);
                sortedItems = perturbList(itemsToPack, strategyIdx);
                const kOptions = [1, 2, 4, 8, 12, 16, 24, 32, 48, 9999];
                lookAheadK = kOptions[Math.floor(Math.random() * kOptions.length)];
            }

            let w_y = 100000;
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
            const trialScore = packedCount * 10000000 + packedVolume * 10 - maxHeight * 100 + totalContact * 0.1;

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

    // 运行单次装入模拟 (多项目前瞻最佳适配机制 - Multi-Item Look-Ahead Best-Fit placement)
    runSinglePack(sortedItems, checkStability, supportRatio, w_y, w_z, w_x, lookAheadK) {
        const placed = [];
        const pool = [...sortedItems]; // 待装载货物池

        while (pool.length > 0) {
            let bestChoice = null;
            let maxScore = -Infinity;

            // 限制前瞻窗口范围为：[1, 货物池长度] 之间的有效值
            const k = Math.max(1, Math.min(lookAheadK, pool.length));

            // A. 生成放置候选点 (Pivots)
            const pivots = [[0, 0, 0]];
            for (const pItem of placed) {
                pivots.push([pItem.x + pItem.rw, pItem.y, pItem.z]);
                pivots.push([pItem.x, pItem.y + pItem.rh, pItem.z]);
                pivots.push([pItem.x, pItem.y, pItem.z + pItem.rd]);
            }

            // 过滤超出边界和重复的角点
            const uniquePivots = [];
            const seen = new Set();
            for (const [px, py, pz] of pivots) {
                if (px >= this.binW || py >= this.binH || pz >= this.binD) continue;
                const key = `${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniquePivots.push({ x: px, y: py, z: pz });
                }
            }

            // 1. 尝试从前瞻窗口内的 K 个货物中选取最适配的进行码放
            // 采用货物品质类型去重优化，确保相同规格 of 货物只被校验一次，大幅提升大批量装箱时的执行效率
            const processedTypesInWindow = new Set();
            for (let i = 0; i < k; i++) {
                const item = pool[i];
                const itemTypeKey = `${item.name}_${item.w}_${item.h}_${item.d}`;
                if (processedTypesInWindow.has(itemTypeKey)) continue;
                processedTypesInWindow.add(itemTypeKey);

                for (const pivot of uniquePivots) {
                    for (let rType = 0; rType < 6; rType++) {
                        const [rw, rh, rd] = item.getRotatedDimensions(rType);

                        // 越界检查
                        if (pivot.x + rw > this.binW || pivot.y + rh > this.binH || pivot.z + rd > this.binD) {
                            continue;
                        }

                        // 碰撞冲突检查
                        const candidateBox = { x: pivot.x, y: pivot.y, z: pivot.z, w: rw, h: rh, d: rd };
                        let collision = false;
                        for (const pItem of placed) {
                            if (boxesOverlap(candidateBox, { x: pItem.x, y: pItem.y, z: pItem.z, w: pItem.rw, h: pItem.rh, d: pItem.rd })) {
                                collision = true;
                                break;
                            }
                        }
                        if (collision) continue;

                        // 重力支撑性检查
                        if (checkStability && pivot.y > 0) {
                            let supportedArea = 0;
                            const bottomArea = rw * rd;
                            for (const pItem of placed) {
                                if (Math.abs((pItem.y + pItem.rh) - pivot.y) < EPS_STABILITY) {
                                    const xOverlap = Math.max(0, Math.min(pivot.x + rw, pItem.x + pItem.rw) - Math.max(pivot.x, pItem.x));
                                    const zOverlap = Math.max(0, Math.min(pivot.z + rd, pItem.z + pItem.rd) - Math.max(pivot.z, pItem.z));
                                    supportedArea += xOverlap * zOverlap;
                                }
                            }
                            if ((supportedArea / bottomArea) < supportRatio) {
                                continue;
                            }
                        }

                        // 契合度与壁面接触评分
                        const contact = this.getPlacementContactArea({ x: pivot.x, y: pivot.y, z: pivot.z, rw, rh, rd }, placed);
                        const score = - (pivot.y + rh) * w_y - (pivot.z + rd) * w_z - (pivot.x + rw) * w_x + contact * 10;

                        if (score > maxScore) {
                            maxScore = score;
                            bestChoice = { poolIndex: i, pivot, rotationType: rType, item };
                        }
                    }
                }
            }

            // 2. 如果前瞻窗口内的所有货物由于尺寸或稳定性限制均无法装载，则扫描窗口外的剩余货物
            // 这确保了如果有较小的缝隙，可以被排在后面的小件货物（如产品C）及时填补，避免空间碎片化
            if (!bestChoice && k < pool.length) {
                const processedTypesOutsideWindow = new Set();
                for (let i = k; i < pool.length; i++) {
                    const item = pool[i];
                    const itemTypeKey = `${item.name}_${item.w}_${item.h}_${item.d}`;
                    if (processedTypesOutsideWindow.has(itemTypeKey)) continue;
                    processedTypesOutsideWindow.add(itemTypeKey);

                    for (const pivot of uniquePivots) {
                        for (let rType = 0; rType < 6; rType++) {
                            const [rw, rh, rd] = item.getRotatedDimensions(rType);

                            // 越界检查
                            if (pivot.x + rw > this.binW || pivot.y + rh > this.binH || pivot.z + rd > this.binD) {
                                continue;
                            }

                            // 碰撞冲突检查
                            const candidateBox = { x: pivot.x, y: pivot.y, z: pivot.z, w: rw, h: rh, d: rd };
                            let collision = false;
                            for (const pItem of placed) {
                                if (boxesOverlap(candidateBox, { x: pItem.x, y: pItem.y, z: pItem.z, w: pItem.rw, h: pItem.rh, d: pItem.rd })) {
                                    collision = true;
                                    break;
                                }
                            }
                            if (collision) continue;

                            // 重力支撑性检查
                            if (checkStability && pivot.y > 0) {
                                let supportedArea = 0;
                                const bottomArea = rw * rd;
                                for (const pItem of placed) {
                                    if (Math.abs((pItem.y + pItem.rh) - pivot.y) < EPS_STABILITY) {
                                        const xOverlap = Math.max(0, Math.min(pivot.x + rw, pItem.x + pItem.rw) - Math.max(pivot.x, pItem.x));
                                        const zOverlap = Math.max(0, Math.min(pivot.z + rd, pItem.z + pItem.rd) - Math.max(pivot.z, pItem.z));
                                        supportedArea += xOverlap * zOverlap;
                                    }
                                }
                                if ((supportedArea / bottomArea) < supportRatio) {
                                    continue;
                                }
                            }

                            // 契合度与壁面接触评分
                            const contact = this.getPlacementContactArea({ x: pivot.x, y: pivot.y, z: pivot.z, rw, rh, rd }, placed);
                            const score = - (pivot.y + rh) * w_y - (pivot.z + rd) * w_z - (pivot.x + rw) * w_x + contact * 10;

                            if (score > maxScore) {
                                maxScore = score;
                                bestChoice = { poolIndex: i, pivot, rotationType: rType, item };
                            }
                        }
                    }
                }
            }

            // C. 提交并放置挑选出来的最优货物，并从剩余池中移除它
            if (bestChoice) {
                const item = bestChoice.item;
                const placedItem = new Item(item.id, item.name, item.w, item.h, item.d, item.color, item.weight);
                placedItem.x = bestChoice.pivot.x;
                placedItem.y = bestChoice.pivot.y;
                placedItem.z = bestChoice.pivot.z;
                placedItem.setRotation(bestChoice.rotationType);
                placed.push(placedItem);

                pool.splice(bestChoice.poolIndex, 1);
            } else {
                // 如果池内剩余任何货物在所有可行点与旋转朝向下均无法码放，则装箱结束
                break;
            }
        }

        return { items: placed, unpacked: pool };
    }

    // 计算单个候选盒放置时的壁面及物体接触面积 (cm²)
    getPlacementContactArea(box, placed) {
        let contact = 0;
        const eps = EPS_CONTACT;

        // 与容器内壁接触
        if (box.y < eps) contact += box.rw * box.rd; // 底面
        if (box.x < eps) contact += box.rh * box.rd; // 左面
        if (box.z < eps) contact += box.rw * box.rh; // 后面
        if (Math.abs(box.x + box.rw - this.binW) < eps) contact += box.rh * box.rd; // 右面
        if (Math.abs(box.z + box.rd - this.binD) < eps) contact += box.rw * box.rh; // 前面

        // 与其它放置物品的面接触
        for (const item of placed) {
            if (item === box || (box.id !== undefined && item.id === box.id)) continue;
            // X 轴邻接 (左右接触)
            if (Math.abs(box.x + box.rw - item.x) < eps || Math.abs(item.x + item.rw - box.x) < eps) {
                const yOverlap = Math.max(0, Math.min(box.y + box.rh, item.y + item.rh) - Math.max(box.y, item.y));
                const zOverlap = Math.max(0, Math.min(box.z + box.rd, item.z + item.rd) - Math.max(box.z, item.z));
                contact += yOverlap * zOverlap;
            }
            // Y 轴邻接 (上下接触)
            if (Math.abs(box.y + box.rh - item.y) < eps || Math.abs(item.y + item.rh - box.y) < eps) {
                const xOverlap = Math.max(0, Math.min(box.x + box.rw, item.x + item.rw) - Math.max(box.x, item.x));
                const zOverlap = Math.max(0, Math.min(box.z + box.rd, item.z + item.rd) - Math.max(box.z, item.z));
                contact += xOverlap * zOverlap;
            }
            // Z 轴邻接 (前后接触)
            if (Math.abs(box.z + box.rd - item.z) < eps || Math.abs(item.z + item.rd - box.z) < eps) {
                const xOverlap = Math.max(0, Math.min(box.x + box.rw, item.x + item.rw) - Math.max(box.x, item.x));
                const yOverlap = Math.max(0, Math.min(box.y + box.rh, item.y + item.rh) - Math.max(box.y, item.y));
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

    // 辅助函数：生成所有合理的层面积分拆组合
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

            const distribute = (layerIdx, remainingQty) => {
                if (layerIdx === numLayers - 1) {
                    currentPartition[layerIdx][type.name] = remainingQty;
                    searchPartition(typeIdx + 1);
                    return;
                }

                for (let q = 0; q <= remainingQty; q++) {
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

        pool.sort((a, b) => (a.w2d * a.h2d) - (b.w2d * b.h2d));

        let nodesVisited = 0;
        const maxNodes = 2000000; // 调大上限以确保能够找到解

        const rectsOverlap = (r1, r2) => {
            const eps = EPS_OVERLAP;
            return (
                r1.x < r2.x + r2.w - eps && r1.x + r1.w > r2.x + eps &&
                r1.y < r2.y + r2.h - eps && r1.y + r1.h > r2.y + eps
            );
        };

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

                    const candidate = { x: pivot.x, y: pivot.y, w: r.rw, h: r.rh };
                    let collision = false;
                    for (const p of placed) {
                        if (rectsOverlap(candidate, p)) {
                            collision = true;
                            break;
                        }
                    }
                    if (collision) continue;

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
