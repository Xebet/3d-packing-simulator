// ==========================================
// 1. 全局状态与配置
// ==========================================
let scene, camera, renderer, orbitControls, transformControls;
let containerMesh, containerEdges;
let shadowPlane; // 接收阴影的底板
let gridHelper, axesHelper;
let renderRequested = true;
let lastBinDimensions = null;
let lastFocusedElement = null;

const MAX_INVENTORY_QTY = 1000;
const MAX_ITEM_NAME_LENGTH = 80;
const WORKER_TIMEOUT_MS = 60000;

function requestRender() {
    renderRequested = true;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[char]);
}

function readNumericInput(id, { min = -Infinity, max = Infinity, integer = false } = {}) {
    const input = document.getElementById(id);
    const raw = input.value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new RangeError(`${input.closest('.input-field')?.querySelector('label')?.textContent || id} 必须在 ${min} 到 ${max} 之间`);
    }
    return value;
}

// 货物数据结构
// 预设产品清单 (v2.0 优化修改)
let inventory = [
    { id: 'preset_1', name: '产品A', l: 29, w: 16, h: 8, qty: 9, color: '#6366f1', weight: 0.65, ratio: 0, minQty: 0 },
    { id: 'preset_2', name: '产品B', l: 29, w: 13, h: 6, qty: 24, color: '#06b6d4', weight: 0.37, ratio: 0, minQty: 0 },
    { id: 'preset_3', name: '产品C', l: 29, w: 6, h: 6, qty: 12, color: '#10b981', weight: 0.19, ratio: 0, minQty: 0 }
];

let placedItems = []; // 当前放入容器的盒子列表 (手动模式)
let selectedPlacedItem = null; // 当前手动选中的盒子
let selectedBoxMesh = null; // 对应的 Three.js 网格物体
let selectionBoxHelper = null; // 选中框高亮辅助线

let activeMode = 'auto'; // 'auto' | 'manual'

// 自动装箱计算结果与动画
let autoPackedItems = [];
let autoUnpackedItems = [];
let animationStep = 0;
let animationInterval = null;
let isAnimationPlaying = false;

// 缓存所有渲染的物品 Mesh，键为 item.id
let renderedItemMeshes = new Map();

// 材质缓存，按颜色保存 MeshStandardMaterial 实例，避免重复创建
const materialCache = new Map();

// 销毁 Mesh 所占用的 GPU 资源
function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m?.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

// ==========================================
// 2. 初始化 Three.js 场景
// ==========================================
function init3DScene() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // A. 场景
    scene = new THREE.Scene();
    const isLight = document.body.classList.contains('light-theme');
    scene.background = new THREE.Color(isLight ? '#f1f5f9' : '#070b13'); // 深黑色科技背景 或 浅灰白背景

    // B. 相机
    camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    camera.position.set(70, 70, 100);

    // C. 渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // D. 控制器 (使用全局 THREE 命名空间下挂载的辅助器)
    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    orbitControls.maxPolarAngle = Math.PI / 2 - 0.05; // 限制相机不能穿入地下
    orbitControls.minDistance = 20;
    orbitControls.maxDistance = 300;
    orbitControls.addEventListener('change', requestRender);

    // E. 拖拽变换器 (TransformControls)
    transformControls = new THREE.TransformControls(camera, renderer.domElement);
    transformControls.size = 0.85; // 缩小 gizmo
    transformControls.addEventListener('change', () => renderer.render(scene, camera));
    transformControls.addEventListener('dragging-changed', (event) => {
        orbitControls.enabled = !event.value; // 拖动时禁用轨道控制器，防止镜头跟着晃动
    });
    // 监听拖动事件，触发实时坐标边界和碰撞限制
    transformControls.addEventListener('objectChange', onGizmoDrag);
    scene.add(transformControls);

    // F. 灯光系统
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(80, 120, 60);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 300;
    const d = 100;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x6366f1, 0.5, 200);
    pointLight.position.set(-60, 50, -60);
    scene.add(pointLight);

    // G. 辅助网格和坐标轴
    if (isLight) {
        gridHelper = new THREE.GridHelper(200, 50, 0x4f46e5, 0xcbd5e1);
    } else {
        gridHelper = new THREE.GridHelper(200, 50, 0x3b82f6, 0x1e293b);
    }
    gridHelper.position.y = -20;
    scene.add(gridHelper);

    axesHelper = new THREE.AxesHelper(30);
    axesHelper.position.set(-100, -19.9, -100);
    scene.add(axesHelper);

    // H. 创建阴影底板
    const shadowPlaneGeo = new THREE.PlaneGeometry(500, 500);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -20;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    // I. 窗口尺寸调整
    window.addEventListener('resize', onWindowResize);

    // J. 点击场景空白处或双击选择物体
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('dblclick', (e) => {
        if (activeMode !== 'manual') return; // 只有手动摆放模式才支持 3D 点击选择

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        
        // 查找所有被渲染的货物物体
        const meshesToIntersect = Array.from(renderedItemMeshes.values());
        const intersects = raycaster.intersectObjects(meshesToIntersect, true);

        if (intersects.length > 0) {
            // 获取最接近的网格物体
            let clickedMesh = intersects[0].object;
            // 如果点击的是黑色线框，寻找父级网格
            if (clickedMesh.type === 'LineSegments' && clickedMesh.parent) {
                clickedMesh = clickedMesh.parent;
            }
            
            // 查找对应的货物 ID
            for (const [id, mesh] of renderedItemMeshes.entries()) {
                if (mesh === clickedMesh) {
                    selectPlacedItemById(id);
                    break;
                }
            }
        } else {
            // 双击空白处取消选中
            selectPlacedItemById(null);
        }
    });

    // 启动渲染循环
    animateLoop();
}

function animateLoop() {
    requestAnimationFrame(animateLoop);
    const controlsChanged = orbitControls.update();
    if (controlsChanged || renderRequested) {
        renderer.render(scene, camera);
        renderRequested = false;
    }
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    requestRender();
}

// ==========================================
// 3. 动态更新/创建容器 (Bin) 3D 模型
// ==========================================
function updateContainer3D() {
    let l, w, h;
    try {
        l = readNumericInput('bin-l', { min: 5, max: 500 });
        w = readNumericInput('bin-w', { min: 5, max: 500 });
        h = readNumericInput('bin-h', { min: 5, max: 500 });
    } catch (error) {
        showWarningModal('error', '容器参数无效', error.message, '请输入有效的正数尺寸。');
        return;
    }

    const dimensionsChanged = lastBinDimensions &&
        (lastBinDimensions.l !== l || lastBinDimensions.w !== w || lastBinDimensions.h !== h);
    lastBinDimensions = { l, w, h };

    // 清理旧容器
    if (containerMesh) {
        disposeMesh(containerMesh);
        scene.remove(containerMesh);
    }
    if (containerEdges) {
        disposeMesh(containerEdges);
        scene.remove(containerEdges);
    }

    const isLight = document.body.classList.contains('light-theme');
    const isWireframeActive = document.getElementById('view-toggle-wireframe').classList.contains('active');
    const opacityValue = isWireframeActive ? 0.0 : (parseFloat(document.getElementById('view-opacity').value) / 100 || 0.25);

    // 1. 创建半透明外壳容器
    const geometry = new THREE.BoxGeometry(w, h, l);
    // 这里将容器中心放在 (0, h/2 - 20, 0)
    // 使得容器的底部正好在 y = -20 的高度，与辅助网格平行
    const material = new THREE.MeshStandardMaterial({
        color: isLight ? 0xffffff : 0x1e293b,
        transparent: true,
        opacity: opacityValue,
        roughness: 0.1,
        metalness: 0.1,
        side: THREE.BackSide, // 从外部看到里面
        depthWrite: false
    });
    
    containerMesh = new THREE.Mesh(geometry, material);
    containerMesh.position.set(0, h / 2 - 20, 0);
    scene.add(containerMesh);

    // 2. 创建精细的外缘线框
    const edgesGeo = new THREE.EdgesGeometry(geometry);
    const edgesMat = new THREE.LineBasicMaterial({ color: isLight ? 0x4f46e5 : 0x6366f1, linewidth: 2 });
    containerEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    containerEdges.position.copy(containerMesh.position);
    scene.add(containerEdges);

    // 3. 动态移动地面网格与阴影板，使其正好处于容器底部
    gridHelper.position.y = -20;
    shadowPlane.position.y = -20.05;

    // 4. 重置摄像机焦距在容器的中心位置
    orbitControls.target.set(0, h / 2 - 20, 0);

    // 如果处于手动模式，重置滑块的最大值
    updateManualSliderBounds();

    if (dimensionsChanged) {
        if (activeMode === 'auto' && (autoPackedItems.length > 0 || autoUnpackedItems.length > 0)) {
            stopAnimation();
            clearRenderedBoxes();
            autoPackedItems = [];
            autoUnpackedItems = [];
            animationStep = 0;
            document.getElementById('anim-section').style.display = 'none';
        } else if (activeMode === 'manual' && placedItems.length > 0) {
            placedItems.forEach(item => {
                clampItemPosition(item);
                const mesh = renderedItemMeshes.get(item.id);
                if (mesh) updateMeshPosition(mesh, item);
            });
            if (selectedPlacedItem) checkManualPlacementCollisions();
            renderPlacedItemsListUI();
        }
    }
    
    // 更新数据统计里容器的总容积
    updateStats();
    requestRender();
}

// ==========================================
// 4. 产品清单数据绑定与 UI 操作
// ==========================================
function renderInventoryUI() {
    const listDiv = document.getElementById('inventory-items');
    listDiv.innerHTML = '';

    inventory.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'inventory-item';
        const safeName = escapeHtml(item.name);
        div.innerHTML = `
            <div class="item-meta" style="flex: 1; min-width: 0;">
                <div class="item-color-indicator" style="background-color: ${item.color};"></div>
                <div class="item-details" style="min-width: 0; flex: 1;">
                    <span class="item-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" title="${safeName}">${safeName}</span>
                    <span class="item-dims" style="font-size: 0.7rem; display: block;">${item.l}x${item.w}x${item.h}cm | ${item.weight}kg | 配比:${item.ratio} | 最少:${item.minQty}</span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                <div class="item-qty-selector">
                    <button class="qty-btn dec-btn" data-index="${index}">-</button>
                    <input type="number" class="qty-input" data-index="${index}" value="${item.qty}" min="0" max="${MAX_INVENTORY_QTY}">
                    <button class="qty-btn inc-btn" data-index="${index}">+</button>
                </div>
                ${activeMode === 'manual' ? `
                    <button class="btn btn-secondary place-one-btn" data-index="${index}" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; height: 26px;">
                        放入1件
                    </button>
                ` : ''}
                <button class="delete-item-btn" data-index="${index}">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
        listDiv.appendChild(div);
    });

    // 绑定数量减少按钮事件
    document.querySelectorAll('.dec-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            if (inventory[idx].qty > 0) {
                inventory[idx].qty--;
                renderInventoryUI();
                updateStats();
            }
        });
    });

    // 绑定数量增加按钮事件
    document.querySelectorAll('.inc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            inventory[idx].qty = Math.min(MAX_INVENTORY_QTY, inventory[idx].qty + 1);
            renderInventoryUI();
            updateStats();
        });
    });

    // 绑定数量直接输入框变更事件
    document.querySelectorAll('.qty-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            val = Math.min(MAX_INVENTORY_QTY, val);
            inventory[idx].qty = val;
            renderInventoryUI();
            updateStats();
        });
    });

    // 绑定放入事件 (手动模式)
    document.querySelectorAll('.place-one-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            manuallyPlaceItem(inventory[idx]);
        });
    });

    // 绑定删除清单项目事件
    document.querySelectorAll('.delete-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let button = e.target;
            while (button.tagName !== 'BUTTON') {
                button = button.parentElement;
            }
            const idx = parseInt(button.getAttribute('data-index'));
            inventory.splice(idx, 1);
            renderInventoryUI();
            updateStats();
        });
    });
}

// 添加新产品到库存清单
document.getElementById('add-item-btn').addEventListener('click', () => {
    let name, l, w, h, qty, color, weight, ratio, minQty;
    try {
        name = document.getElementById('item-name').value.trim() || '盒子';
        if (name.length > MAX_ITEM_NAME_LENGTH) {
            throw new RangeError(`产品名称不能超过 ${MAX_ITEM_NAME_LENGTH} 个字符`);
        }
        l = readNumericInput('item-l', { min: 0.01, max: 500 });
        w = readNumericInput('item-w', { min: 0.01, max: 500 });
        h = readNumericInput('item-h', { min: 0.01, max: 500 });
        qty = readNumericInput('item-qty', { min: 1, max: MAX_INVENTORY_QTY, integer: true });
        color = document.getElementById('item-color').value;
        weight = readNumericInput('item-weight', { min: 0, max: 100000 });
        ratio = readNumericInput('item-ratio', { min: 0, max: 100000, integer: true });
        minQty = readNumericInput('item-min-qty', { min: 0, max: MAX_INVENTORY_QTY, integer: true });
    } catch (error) {
        showWarningModal('error', '产品参数无效', error.message, '请检查尺寸、重量和数量后重试。');
        return;
    }

    const id = `item_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`;
    inventory.push({ id, name, l, w, h, qty, color, weight, ratio, minQty });
    renderInventoryUI();
    updateStats();

    // 重置占比系数和最少数量输入框为 0，并恢复可用状态 (v2.0 优化)
    const ratioInput = document.getElementById('item-ratio');
    const minQtyInput = document.getElementById('item-min-qty');
    ratioInput.value = "0";
    minQtyInput.value = "0";
    ratioInput.disabled = false;
    minQtyInput.disabled = false;
});

// ==========================================
// 5. 三维渲染盒子物体 (Mesh Helper)
// ==========================================
function createBoxMesh(item) {
    // 创建立方体网格物体的辅助函数
    // item.rw, item.rh, item.rd 已经在装箱时确定（由于旋转）
    const geometry = new THREE.BoxGeometry(item.rw, item.rh, item.rd);
    
    let baseMaterial = materialCache.get(item.color);
    if (!baseMaterial) {
        baseMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(item.color),
            roughness: 0.4,
            metalness: 0.1
        });
        materialCache.set(item.color, baseMaterial);
    }
    // 可交互盒子的颜色/透明度会独立变化，因此不能直接共享可变材质实例。
    const material = baseMaterial.clone();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // 增加一个帅气清晰的黑细边缘线，使得各个盒子立体区分度更高
    const edgesGeo = new THREE.EdgesGeometry(geometry);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1.5 });
    const line = new THREE.LineSegments(edgesGeo, edgesMat);
    mesh.add(line);

    // 将 Three.js 的位置与容器逻辑坐标对齐。
    updateMeshPosition(mesh, item);

    return mesh;
}

function updateMeshPosition(mesh, item) {
    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);

    // 从容器相对左下后角原点 (x,y,z) 映射到 3D 空间的世界坐标
    // containerMesh 底面 y = -20，左面 x = -binW/2，后面 z = -binL/2
    const x3d = item.x + item.rw / 2 - binW / 2;
    const y3d = item.y + item.rh / 2 - 20;
    const z3d = item.z + item.rd / 2 - binL / 2;

    mesh.position.set(x3d, y3d, z3d);
}

// 清除当前场景渲染的所有货物
function clearRenderedBoxes() {
    renderedItemMeshes.forEach(mesh => {
        scene.remove(mesh);
        disposeMesh(mesh);
    });
    renderedItemMeshes.clear();
    if (transformControls) transformControls.detach();
    removeSelectionHelper();
    requestRender();
}

// ==========================================
// 6. 自动装箱模式核心控制逻辑
// ==========================================
// Web Worker 动态生成器，绕过本地 file:// CORS 限制
let cachedWorkerBlobURL = null;

function createPackingWorker() {
    if (!cachedWorkerBlobURL) {
        const blobContent = `
            const EPS_OVERLAP = 0.001;
            const EPS_CONTACT = 0.01;
            const EPS_STABILITY = 0.05;
            const EPS_DIMENSION = 0.1;
            const DEFAULT_SUPPORT_RATIO = 0.5;

            const boxesOverlap = ${boxesOverlap.toString()};
            const Item = ${Item.toString()};
            const Packer = ${Packer.toString()};

            self.onmessage = function(e) {
                try {
                    const { type, itemsData, binW, binH, binD, options, partitionsRange, startTrial, numTrials } = e.data;
                    
                    const itemsToPack = itemsData.map(it => {
                        const item = new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
                        return item;
                    });
                    
                    const packer = new Packer(binW, binH, binD);
                    
                    if (type === 'tryLayerPack') {
                        const result = packer.tryLayerBacktrackingPackWithPartitions(itemsToPack, options.checkStability, options.supportRatio, partitionsRange[0], partitionsRange[1]);
                        if (result) {
                            const resultData = result.map(it => ({
                                id: it.id,
                                name: it.name,
                                w: it.w,
                                h: it.h,
                                d: it.d,
                                color: it.color,
                                weight: it.weight,
                                x: it.x,
                                y: it.y,
                                z: it.z,
                                rw: it.rw,
                                rh: it.rh,
                                rd: it.rd,
                                rotationType: it.rotationType
                            }));
                            self.postMessage({ status: 'success', items: resultData });
                        } else {
                            self.postMessage({ status: 'fail' });
                        }
                    } else if (type === 'greedyPack') {
                        const result = packer.runGreedyPackTrials(itemsToPack, options, startTrial, numTrials);
                        const resultData = {
                            items: result.items.map(it => ({
                                id: it.id,
                                name: it.name,
                                w: it.w,
                                h: it.h,
                                d: it.d,
                                color: it.color,
                                weight: it.weight,
                                x: it.x,
                                y: it.y,
                                z: it.z,
                                rw: it.rw,
                                rh: it.rh,
                                rd: it.rd,
                                rotationType: it.rotationType
                            })),
                            unpacked: result.unpacked.map(it => ({
                                id: it.id,
                                name: it.name,
                                w: it.w,
                                h: it.h,
                                d: it.d,
                                color: it.color,
                                weight: it.weight
                            })),
                            score: result.score
                        };
                        self.postMessage({ status: 'success', result: resultData });
                    }
                } catch (err) {
                    self.postMessage({ status: 'error', error: err.message });
                }
            };
        `;

        const blob = new Blob([blobContent], { type: 'application/javascript' });
        cachedWorkerBlobURL = URL.createObjectURL(blob);
    }
    return new Worker(cachedWorkerBlobURL);
}

// 辅助函数：根据物体的实际旋转后尺寸，动态逆向推导其在当前轴向下的 rotationType
function getRotationTypeFromDimensions(item, rw, rh, rd) {
    for (let r = 0; r < 6; r++) {
        const [w, h, d] = item.getRotatedDimensions(r);
        if (Math.abs(w - rw) < 0.1 && Math.abs(h - rh) < 0.1 && Math.abs(d - rd) < 0.1) {
            return r;
        }
    }
    return 0;
}

// 辅助函数：计算当前装载组合的容积利用率
function calculateVolumeUtilization(packedItems, binW, binH, binL) {
    const containerVolume = binW * binH * binL;
    if (containerVolume <= 0) return 0;
    let packedVol = 0;
    packedItems.forEach(item => {
        packedVol += item.rw * item.rh * item.rd;
    });
    return (packedVol / containerVolume) * 100;
}

// 单次特定空间朝向下的并发装箱执行器
function runSinglePacking(itemsToPack, binW, binH, binL, checkStability, supportRatio, biggerFirst, callback, orientationIdx, totalOrientations) {
    const progressBar = document.getElementById('loading-progress');
    const baseProgress = Math.floor((orientationIdx / totalOrientations) * 100);
    const weight = Math.floor(100 / totalOrientations);

    // 降级保护：如果浏览器不支持 Web Worker
    if (typeof Worker === 'undefined') {
        setTimeout(() => {
            const packer = new Packer(binW, binH, binL);
            packer.pack(itemsToPack, { checkStability, supportRatio, biggerFirst });
            callback(packer.items, packer.unpacked);
        }, 10);
        return;
    }

    const numCores = navigator.hardwareConcurrency || 4;
    const M = Math.max(1, Math.min(numCores, 8)); // 并发数限制在 1-8 之间
    const workers = [];
    const workerTimers = new Map();
    let completedWorkers = 0;
    let finished = false;

    const itemsSerialized = itemsToPack.map(it => ({
        id: it.id, name: it.name, w: it.w, h: it.h, d: it.d, color: it.color, weight: it.weight
    }));

    const cleanup = () => {
        finished = true;
        workerTimers.forEach(timer => clearTimeout(timer));
        workerTimers.clear();
        workers.forEach(w => w.terminate());
    };

    // 1. 判断是否符合公维对齐层级拆分装载策略
    const tempPacker = new Packer(binW, binH, binL);
    let commonDim = null;
    if (itemsToPack.length > 0) {
        const firstItem = itemsToPack[0];
        const candidates = [firstItem.w, firstItem.h, firstItem.d];
        for (const cand of candidates) {
            let isCommon = true;
            for (const item of itemsToPack) {
                if (Math.abs(item.w - cand) > 0.1 && Math.abs(item.h - cand) > 0.1 && Math.abs(item.d - cand) > 0.1) {
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

    let hasCommonDim = false;
    let numLayers = 0;
    if (commonDim) {
        numLayers = Math.floor(binL / commonDim);
        if (numLayers >= 1) {
            hasCommonDim = true;
        }
    }

    if (hasCommonDim) {
        const items2D = itemsToPack.map(item => {
            let w2d, h2d;
            if (Math.abs(item.d - commonDim) <= 0.1) {
                w2d = item.w; h2d = item.h;
            } else if (Math.abs(item.h - commonDim) <= 0.1) {
                w2d = item.w; h2d = item.d;
            } else {
                w2d = item.h; h2d = item.d;
            }
            return {
                key: `${item.w}|${item.h}|${item.d}`,
                name: item.name,
                w2d,
                h2d
            };
        });

        const itemTypes = [];
        const typeMap = new Map();
        for (const item of items2D) {
            const key = item.key;
            if (!typeMap.has(key)) {
                typeMap.set(key, { key, name: item.name, w2d: item.w2d, h2d: item.h2d, qty: 0 });
                itemTypes.push(typeMap.get(key));
            }
            typeMap.get(key).qty++;
        }

        const partitions = tempPacker.getPartitions(itemTypes, numLayers, binW, binH);
        const totalPartitions = Math.min(30, partitions.length);

        if (totalPartitions > 0) {
            let partitionsFailed = 0;
            const step = Math.ceil(totalPartitions / M);

            for (let i = 0; i < M; i++) {
                const start = i * step;
                const end = Math.min(totalPartitions, start + step);
                if (start >= totalPartitions) break;

                const worker = createPackingWorker();
                workers.push(worker);
                let settled = false;

                const failLayerWorker = (error) => {
                    if (settled || finished) return;
                    settled = true;
                    clearTimeout(workerTimers.get(worker));
                    workerTimers.delete(worker);
                    worker.terminate();
                    console.error("Worker error in layerPack:", error);
                    partitionsFailed += (end - start);
                    completedWorkers++;
                    if (completedWorkers === workers.length) {
                        runGreedyParallel();
                    }
                };

                workerTimers.set(worker, setTimeout(() => {
                    failLayerWorker(new Error(`layerPack timed out after ${WORKER_TIMEOUT_MS}ms`));
                }, WORKER_TIMEOUT_MS));

                worker.onerror = function(err) {
                    failLayerWorker(err);
                };

                worker.onmessage = function(e) {
                    if (settled || finished) return;
                    settled = true;
                    clearTimeout(workerTimers.get(worker));
                    workerTimers.delete(worker);
                    if (e.data.status === 'success') {
                        const packed = e.data.items.map(it => {
                            const item = new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
                            item.x = it.x; item.y = it.y; item.z = it.z;
                            item.setRotation(it.rotationType);
                            return item;
                        });

                        const validation = Packer.validatePackingResult(
                            packed,
                            binW,
                            binH,
                            binL,
                            checkStability,
                            supportRatio
                        );
                        if (!validation.valid) {
                            console.warn('Invalid layerPack result discarded:', validation.errors);
                            partitionsFailed += (end - start);
                            completedWorkers++;
                            if (completedWorkers === workers.length) runGreedyParallel();
                            return;
                        }

                        cleanup();
                        const progress = baseProgress + weight;
                        if (progressBar) progressBar.style.width = `${progress}%`;
                        callback(packed, []);
                    } else {
                        if (e.data.status === 'error') {
                            console.error("Worker reported error in layerPack:", e.data.error);
                        }
                        partitionsFailed += (end - start);
                        const stepProgress = Math.min(40, Math.floor((partitionsFailed / totalPartitions) * 40));
                        const progress = baseProgress + Math.floor((stepProgress / 100) * weight);
                        if (progressBar) progressBar.style.width = `${progress}%`;

                        completedWorkers++;
                        if (completedWorkers === workers.length) {
                            runGreedyParallel();
                        }
                    }
                };

                worker.postMessage({
                    type: 'tryLayerPack',
                    itemsData: itemsSerialized,
                    binW, binH, binD: binL,
                    options: { checkStability, supportRatio, biggerFirst, seed: 20260617, maxSpaces: 200 },
                    partitionsRange: [start, end]
                });
            }
            return;
        }
    }

    runGreedyParallel();

    function runGreedyParallel() {
        if (finished) return;
        workers.forEach(w => w.terminate());
        workerTimers.forEach(timer => clearTimeout(timer));
        workerTimers.clear();
        workers.length = 0;
        completedWorkers = 0;

        const trialsMultiplier = itemsToPack.length > 200 ? 6 : (itemsToPack.length > 100 ? 10 : 15);
        const numTrials = Math.max(itemsToPack.length > 200 ? 15 : (itemsToPack.length > 100 ? 30 : 60), M * trialsMultiplier);
        const step = Math.ceil(numTrials / M);
        const greedyResults = [];

        const finalizeGreedyResults = () => {
            cleanup();
            let best = { items: [], unpacked: itemsSerialized, score: -Infinity };
            greedyResults.forEach(res => {
                if (res.score > best.score) best = res;
            });
            const packed = best.items.map(it => {
                const item = new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
                item.x = it.x; item.y = it.y; item.z = it.z;
                item.setRotation(it.rotationType);
                return item;
            });
            const unpacked = best.unpacked.map(it => {
                return new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
            });
            callback(packed, unpacked);
        };

        for (let i = 0; i < M; i++) {
            const start = i * step;
            const count = Math.min(numTrials - start, step);
            if (count <= 0) break;

            const worker = createPackingWorker();
            workers.push(worker);
            let settled = false;

            const finishGreedyWorker = (result, error) => {
                if (settled || finished) return;
                settled = true;
                clearTimeout(workerTimers.get(worker));
                workerTimers.delete(worker);
                if (error) console.error("Worker error in greedyPack:", error);
                if (result) greedyResults.push(result);
                completedWorkers++;
                if (completedWorkers === workers.length) finalizeGreedyResults();
            };

            workerTimers.set(worker, setTimeout(() => {
                worker.terminate();
                finishGreedyWorker(null, new Error(`greedyPack timed out after ${WORKER_TIMEOUT_MS}ms`));
            }, WORKER_TIMEOUT_MS));

            worker.onerror = function(err) {
                finishGreedyWorker(null, err);
            };

            worker.onmessage = function(e) {
                if (settled || finished) return;
                
                const stepBase = hasCommonDim ? 40 : 0;
                const stepWeight = hasCommonDim ? 60 : 100;
                const stepProgress = stepBase + Math.floor(((completedWorkers + 1) / workers.length) * stepWeight);
                const progress = baseProgress + Math.floor((stepProgress / 100) * weight);
                if (progressBar) progressBar.style.width = `${progress}%`;

                if (e.data.status === 'success') {
                    finishGreedyWorker(e.data.result, null);
                } else if (e.data.status === 'error') {
                    finishGreedyWorker(null, new Error(e.data.error));
                } else {
                    finishGreedyWorker(null, new Error('Unknown greedyPack worker response'));
                }
            };

            worker.postMessage({
                type: 'greedyPack',
                itemsData: itemsSerialized,
                binW, binH, binD: binL,
                options: { checkStability, supportRatio, biggerFirst, seed: 20260617, maxSpaces: 200 },
                startTrial: start,
                numTrials: count
            });
        }
    }
}

// 多核并发异步装箱调度器 (支持容器姿态自动优化)
function performParallelPacking(itemsToPack, binW, binH, binL, checkStability, supportRatio, biggerFirst, callback) {
    const loadingModal = document.getElementById('loading-modal');
    const progressBar = document.getElementById('loading-progress');
    
    if (loadingModal) loadingModal.style.display = 'flex';
    if (progressBar) progressBar.style.width = '0%';

    // 定义三种空间重力堆叠姿态（以不同尺寸作为高度 H 堆叠轴）
    const orientations = [
        { perm: [0, 1, 2], w: binW, h: binH, d: binL }, // 姿态 1 (默认): 高度为 binH
        { perm: [1, 0, 2], w: binH, h: binW, d: binL }, // 姿态 2 (调换W和H): 高度为 binW
        { perm: [0, 2, 1], w: binW, h: binL, d: binH }  // 姿态 3 (调换H和L): 高度为 binL
    ];

    let bestResult = null;

    function runNextOrientation(idx) {
        if (idx >= orientations.length) {
            finalizeResult(bestResult);
            return;
        }

        const config = orientations[idx];

        runSinglePacking(itemsToPack, config.w, config.h, config.d, checkStability, supportRatio, biggerFirst, (packed, unpacked) => {
            // 将计算结果从当前的旋转坐标系转换映射回用户输入的原始坐标系 [binW, binH, binL]
            const mappedPacked = packed.map(it_calc => {
                const pos_orig = [];
                const size_orig = [];
                
                // 坐标变换映射
                pos_orig[config.perm[0]] = it_calc.x;
                pos_orig[config.perm[1]] = it_calc.y;
                pos_orig[config.perm[2]] = it_calc.z;

                // 尺寸变换映射
                size_orig[config.perm[0]] = it_calc.rw;
                size_orig[config.perm[1]] = it_calc.rh;
                size_orig[config.perm[2]] = it_calc.rd;

                const mapped = new Item(
                    it_calc.id,
                    it_calc.name,
                    it_calc.w, // 保持原始尺寸信息不变
                    it_calc.h,
                    it_calc.d,
                    it_calc.color,
                    it_calc.weight
                );
                mapped.x = pos_orig[0];
                mapped.y = pos_orig[1];
                mapped.z = pos_orig[2];
                
                mapped.rw = size_orig[0];
                mapped.rh = size_orig[1];
                mapped.rd = size_orig[2];
                
                // 动态获取转换尺寸后在原始坐标系下的旋转类型 (0-5)
                mapped.rotationType = getRotationTypeFromDimensions(mapped, mapped.rw, mapped.rh, mapped.rd);
                
                return mapped;
            });

            // 映射未装载货物列表（仅用于清单展示，无坐标映射需求）
            const mappedUnpacked = unpacked.map(it => {
                return new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight);
            });

            const currentScore = mappedPacked.length;
            const currentVolumeUtil = calculateVolumeUtilization(mappedPacked, binW, binH, binL);

            const result = {
                packed: mappedPacked,
                unpacked: mappedUnpacked,
                score: currentScore,
                utilization: currentVolumeUtil
            };

            // 校验转换回原始坐标系后的物理合法性 (主要是重力稳定性)
            const validation = Packer.validatePackingResult(mappedPacked, binW, binH, binL, checkStability, supportRatio);
            if (validation.valid) {
                // 如果当前姿态已经能够 100% 完美装入所有箱体，则提前终止后续计算
                if (currentScore === itemsToPack.length) {
                    finalizeResult(result);
                    return;
                }

                // 对比并保存最优方案（优先比拼装载数量，其次比拼体积利用率）
                if (!bestResult || currentScore > bestResult.score || (currentScore === bestResult.score && currentVolumeUtil > bestResult.utilization)) {
                    bestResult = result;
                }
            } else {
                console.warn(`Orientation ${idx + 1} mapped layout is invalid/unstable under upright gravity, discarded.`, validation.errors);
            }

            // 继续计算下一种姿态
            runNextOrientation(idx + 1);
        }, idx, orientations.length);
    }

    function finalizeResult(result) {
        if (loadingModal) loadingModal.style.display = 'none';
        if (!result) {
            showWarningModal(
                'error',
                '计算失败 (Packing Failed)',
                '装箱计算未能得出任何可行方案。请检查输入参数是否正确。'
            );
            callback([], itemsToPack);
            return;
        }
        callback(result.packed, result.unpacked);
    }

    runNextOrientation(0);
}

document.getElementById('run-pack-btn').addEventListener('click', () => {
    if (activeMode !== 'auto') return;
    
    stopAnimation();

    let binL, binW, binH;
    try {
        binL = readNumericInput('bin-l', { min: 5, max: 500 });
        binW = readNumericInput('bin-w', { min: 5, max: 500 });
        binH = readNumericInput('bin-h', { min: 5, max: 500 });
    } catch (error) {
        showWarningModal('error', '容器参数无效', error.message, '请修正容器尺寸后重试。');
        return;
    }

    // 1. 预先校验：是否有单个产品尺寸在任何旋转方向下都超出了箱子的尺寸
    let oversizedItems = [];
    inventory.forEach(inv => {
        const tempItem = new Item('temp', inv.name, inv.w, inv.h, inv.l, inv.color, inv.weight);
        let canFitAnywhere = false;
        for (let r = 0; r < 6; r++) {
            const [rw, rh, rd] = tempItem.getRotatedDimensions(r);
            if (rw <= binW && rh <= binH && rd <= binL) {
                canFitAnywhere = true;
                break;
            }
        }
        if (!canFitAnywhere) {
            oversizedItems.push(inv);
        }
    });

    if (oversizedItems.length > 0) {
        // 展示超大尺寸错误弹窗
        const listHtml = oversizedItems.map(inv => 
            `<li class="modal-bullet-item">❌ ${escapeHtml(inv.name)}: 尺寸 ${inv.w}x${inv.h}x${inv.l} cm (宽x高x长)</li>`
        ).join('');
        
        showWarningModal(
            'error',
            '产品尺寸超出箱子限制',
            `检测到以下产品即便单独摆放，其部分尺寸也已经超出了您设定的箱子尺寸 (${binW}x${binH}x${binL} cm)，物理上完全无法放入箱子中：`,
            `请您<strong>修改该产品的长宽高尺寸</strong>使其小于箱子尺寸，或者在上方设置中<strong>增大箱子的尺寸</strong>。`,
            listHtml
        );
        return; // 拦截计算
    }

    const checkStability = document.getElementById('cfg-stability').checked;
    const biggerFirst = document.getElementById('cfg-bigger-first').checked;

    // 2. 转换库存货物清单为算法 Item 实例
    const itemsToPack = [];
    inventory.forEach(inv => {
        for (let i = 0; i < inv.qty; i++) {
            const uniqueId = `auto_${inv.id}_${i}`;
            const item = new Item(uniqueId, inv.name, inv.w, inv.h, inv.l, inv.color, inv.weight);
            itemsToPack.push(item);
        }
    });

    if (itemsToPack.length === 0) {
        alert('请先添加至少一件产品盒子到配置中！');
        return;
    }

    // 3. 异步并发执行装箱
    performParallelPacking(itemsToPack, binW, binH, binL, checkStability, 0.5, biggerFirst, (packedItems, unpackedItems) => {
        autoPackedItems = packedItems;
        autoUnpackedItems = unpackedItems;

        // 4. 清除并重新初始化动画渲染
        clearRenderedBoxes();
        
        // 5. 判断并展示货物无法完全装载弹窗
        if (autoUnpackedItems.length > 0) {
            const unpackedCountMap = new Map();
            autoUnpackedItems.forEach(item => {
                unpackedCountMap.set(item.name, (unpackedCountMap.get(item.name) || 0) + 1);
            });

            const listHtml = Array.from(unpackedCountMap.entries()).map(([name, count]) => 
                `<li class="modal-bullet-item">⚠️ ${escapeHtml(name)}: 未能装入 ${count} 件</li>`
            ).join('');

            showWarningModal(
                'warning',
                '部分货物空间不足无法装箱',
                `由于箱内剩余容积不足，或重力支撑面要求未被满足，以下产品未能全部成功装入箱中（已成功装入 ${autoPackedItems.length} 件）：`,
                `建议：您可以适当<strong>减少上述货物的装箱数量</strong>，或者在上方设置中<strong>增大箱子的长宽高尺寸</strong>。`,
                listHtml
            );
        }

        // 6. 激活分步动画控制面板
        document.getElementById('anim-section').style.display = 'block';
        
        const slider = document.getElementById('anim-timeline');
        slider.max = autoPackedItems.length;
        
        // 直接展示最终装载完成呈现
        animationStep = autoPackedItems.length;
        slider.value = animationStep;
        
        updateStepUI();
        updateStats();
        showStep(animationStep);
    });
});

// 显示全局提示弹窗
function showWarningModal(type, title, message, suggestion, listHtml = '') {
    const modal = document.getElementById('warning-modal');
    const iconContainer = document.getElementById('modal-icon-container');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body-text');

    // 设置类型图标
    iconContainer.className = `modal-icon ${type}`;
    if (type === 'error') {
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" style="stroke: var(--danger)">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
        `;
        titleEl.style.color = 'var(--danger)';
    } else {
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" style="stroke: var(--warning)">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
        `;
        titleEl.style.color = 'var(--warning)';
    }

    // 设置内容
    titleEl.innerText = title;
    
    // 简易 Markdown 加粗解析器，防止遗漏的 ** 被直接渲染为文本
    const parseBold = (str) => str ? str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') : '';
    
    let contentHtml = `<p>${parseBold(message)}</p>`;
    if (listHtml) {
        contentHtml += `<ul class="modal-bullet-list">${listHtml}</ul>`;
    }
    contentHtml += `<div class="modal-suggestion">${parseBold(suggestion)}</div>`;
    
    bodyEl.innerHTML = contentHtml;

    // 显示弹窗并把键盘焦点移入对话框。
    lastFocusedElement = document.activeElement;
    modal.style.display = 'flex';
    requestAnimationFrame(() => document.getElementById('modal-close-btn')?.focus());
}

// 分步显示装箱物体数
function showStep(stepCount) {
    // 增量式增删 3D 场景中的货物 Mesh，避免全量销毁重建引起的内存抖动和卡顿
    for (let i = 0; i < autoPackedItems.length; i++) {
        const item = autoPackedItems[i];
        const hasMesh = renderedItemMeshes.has(item.id);
        if (i < stepCount) {
            if (!hasMesh) {
                const mesh = createBoxMesh(item);
                scene.add(mesh);
                renderedItemMeshes.set(item.id, mesh);
            }
        } else {
            if (hasMesh) {
                const mesh = renderedItemMeshes.get(item.id);
                scene.remove(mesh);
                disposeMesh(mesh);
                renderedItemMeshes.delete(item.id);
            }
        }
    }
    requestRender();
}

// 动画播放器核心逻辑
function updateStepUI() {
    const counter = document.getElementById('step-counter');
    counter.innerText = `${animationStep} / ${autoPackedItems.length}`;
    document.getElementById('anim-timeline').value = animationStep;
}

function playAnimation() {
    if (isAnimationPlaying) return;
    
    if (animationStep >= autoPackedItems.length) {
        animationStep = 0; // 从头播放
    }

    isAnimationPlaying = true;
    document.getElementById('play-icon').innerHTML = `
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
    `; // 暂停图标

    animationInterval = setInterval(() => {
        if (animationStep < autoPackedItems.length) {
            animationStep++;
            showStep(animationStep);
            updateStepUI();
            updateStats();
        } else {
            stopAnimation();
        }
    }, 600); // 间隔0.6秒放入一个盒子
}

function stopAnimation() {
    isAnimationPlaying = false;
    document.getElementById('play-icon').innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`; // 播放图标
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

document.getElementById('anim-play').addEventListener('click', () => {
    if (isAnimationPlaying) {
        stopAnimation();
    } else {
        playAnimation();
    }
});

document.getElementById('anim-next').addEventListener('click', () => {
    stopAnimation();
    if (animationStep < autoPackedItems.length) {
        animationStep++;
        showStep(animationStep);
        updateStepUI();
        updateStats();
    }
});

document.getElementById('anim-prev').addEventListener('click', () => {
    stopAnimation();
    if (animationStep > 0) {
        animationStep--;
        showStep(animationStep);
        updateStepUI();
        updateStats();
    }
});

document.getElementById('anim-timeline').addEventListener('input', (e) => {
    stopAnimation();
    animationStep = parseInt(e.target.value);
    showStep(animationStep);
    updateStepUI();
    updateStats();
});

// ==========================================
// 7. 手动装载模式核心控制逻辑
// ==========================================
function manuallyPlaceItem(invItem) {
    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);

    const id = `manual_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`;
    // 实例化一个未放置在任何角点的 Item
    const item = new Item(id, invItem.name, invItem.w, invItem.h, invItem.l, invItem.color, invItem.weight);

    const fittingRotation = Packer.getUniqueOrientations(item).find(rotation =>
        rotation.rw <= binW && rotation.rh <= binH && rotation.rd <= binL
    );
    if (!fittingRotation) {
        showWarningModal(
            'error',
            '产品尺寸超出容器',
            `${escapeHtml(invItem.name)} 在所有旋转方向下都无法放入当前容器。`,
            '请增大容器或调整产品尺寸。'
        );
        return;
    }
    item.setRotation(fittingRotation.rotationType);
    
    // 给定一个安全的初始掉落点 (x=0, z=0)，利用重力模拟找到合适的高点落位
    item.x = 0;
    item.z = 0;
    
    const landingY = Packer.getGravityDropY(item, placedItems, binH);
    if (landingY === null) {
        alert('容器底部已无空间容纳新的盒子！');
        return;
    }
    
    item.y = landingY;
    placedItems.push(item);

    // 渲染 3D 网格
    const mesh = createBoxMesh(item);
    scene.add(mesh);
    renderedItemMeshes.set(item.id, mesh);

    // 选中新放置 of 盒子
    selectPlacedItemById(item.id);
    
    // 更新清单和利用率统计
    renderPlacedItemsListUI();
    updateStats();
}

// 选中某个盒子
function selectPlacedItemById(id) {
    if (selectedPlacedItem) {
        // 恢复之前盒子的默认材质状态 (非碰撞状态)
        updatePlacedBoxVisual(selectedPlacedItem, false);
    }

    if (id === null) {
        selectedPlacedItem = null;
        selectedBoxMesh = null;
        transformControls.detach();
        removeSelectionHelper();
        document.getElementById('manual-coords-group').style.display = 'none';
        document.getElementById('manual-status').innerHTML = `
            <span style="color: var(--text-muted); text-align: center;">💡 请在右侧3D视口中双击盒子，或在下方列表中选中盒子进行编辑摆放。</span>
        `;
        renderPlacedItemsListUI();
        return;
    }

    selectedPlacedItem = placedItems.find(item => item.id === id);
    selectedBoxMesh = renderedItemMeshes.get(id);

    if (selectedPlacedItem && selectedBoxMesh) {
        const safeName = escapeHtml(selectedPlacedItem.name);
        // 绑定拖拽变换器 (gizmo)
        transformControls.attach(selectedBoxMesh);

        // 创建高亮线框
        createSelectionHelper(selectedBoxMesh);

        // 展开侧边栏详细设置区，并更新范围边界
        document.getElementById('manual-coords-group').style.display = 'block';
        document.getElementById('manual-status').innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600;">
                <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${selectedPlacedItem.color};"></div>
                <span>当前选中: ${safeName}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
                规格: ${selectedPlacedItem.w}x${selectedPlacedItem.h}x${selectedPlacedItem.d} cm (宽x高x深)
            </div>
        `;

        updateManualSliderBounds();
        updateCoordUI();
        renderPlacedItemsListUI();
        
        // 触发初始重叠碰撞高亮检测
        checkManualPlacementCollisions();
    }
}

// 创建高亮选中线框辅助器
function createSelectionHelper(mesh) {
    removeSelectionHelper();
    
    // 用稍微宽一些的浅蓝色线框包裹被选中的物体
    const geometry = mesh.geometry;
    const edgesGeo = new THREE.EdgesGeometry(geometry);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 3 });
    selectionBoxHelper = new THREE.LineSegments(edgesGeo, edgesMat);
    selectionBoxHelper.scale.set(1.02, 1.02, 1.02); // 放大一点点，防止两线重叠产生闪烁 (z-fighting)
    mesh.add(selectionBoxHelper);
}

// 移除高亮选中辅助线
function removeSelectionHelper() {
    if (selectionBoxHelper) {
        if (selectionBoxHelper.parent) {
            selectionBoxHelper.parent.remove(selectionBoxHelper);
        }
        disposeMesh(selectionBoxHelper);
    }
    selectionBoxHelper = null;
}

// 更新选中盒子滑块的最大范围
function updateManualSliderBounds() {
    if (!selectedPlacedItem) return;

    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);

    // 最大活动范围是容器尺寸减去盒子旋转后的实际尺寸
    const maxX = Math.max(0, binW - selectedPlacedItem.rw);
    const maxY = Math.max(0, binH - selectedPlacedItem.rh);
    const maxZ = Math.max(0, binL - selectedPlacedItem.rd);

    const sliderX = document.getElementById('slider-x');
    const sliderY = document.getElementById('slider-y');
    const sliderZ = document.getElementById('slider-z');

    sliderX.max = maxX;
    sliderY.max = maxY;
    sliderZ.max = maxZ;

    // 滑块以 1cm 为步进
    sliderX.step = 1;
    sliderY.step = 1;
    sliderZ.step = 1;
}

// 同步逻辑坐标到手动控制滑块 UI
function updateCoordUI() {
    if (!selectedPlacedItem) return;

    document.getElementById('slider-x').value = Math.round(selectedPlacedItem.x);
    document.getElementById('slider-y').value = Math.round(selectedPlacedItem.y);
    document.getElementById('slider-z').value = Math.round(selectedPlacedItem.z);

    document.getElementById('val-x').innerText = `${Math.round(selectedPlacedItem.x)} cm`;
    document.getElementById('val-y').innerText = `${Math.round(selectedPlacedItem.y)} cm`;
    document.getElementById('val-z').innerText = `${Math.round(selectedPlacedItem.z)} cm`;

    // 旋转模式高亮
    document.querySelectorAll('.rotation-btn').forEach(btn => {
        const rot = parseInt(btn.getAttribute('data-rot'));
        if (rot === selectedPlacedItem.rotationType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// 绑定手动模式滑动调节事件
function onCoordSliderChange() {
    if (!selectedPlacedItem || !selectedBoxMesh) return;

    const x = parseFloat(document.getElementById('slider-x').value);
    const y = parseFloat(document.getElementById('slider-y').value);
    const z = parseFloat(document.getElementById('slider-z').value);

    selectedPlacedItem.x = x;
    selectedPlacedItem.y = y;
    selectedPlacedItem.z = z;

    updateMeshPosition(selectedBoxMesh, selectedPlacedItem);
    updateCoordUI();
    checkManualPlacementCollisions();
    
    // 渲染更新
    renderer.render(scene, camera);
}

document.getElementById('slider-x').addEventListener('input', onCoordSliderChange);
document.getElementById('slider-y').addEventListener('input', onCoordSliderChange);
document.getElementById('slider-z').addEventListener('input', onCoordSliderChange);

// 绑定旋转朝向切换
document.querySelectorAll('.rotation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!selectedPlacedItem || !selectedBoxMesh) return;
        const rot = parseInt(e.target.getAttribute('data-rot'));

        // 更新旋转朝向
        selectedPlacedItem.setRotation(rot);

        // 重新更新网格的 3D Geometry
        scene.remove(selectedBoxMesh);
        disposeMesh(selectedBoxMesh);
        
        // 实例化一个新网格，尺寸为旋转后的尺寸
        const newMesh = createBoxMesh(selectedPlacedItem);
        scene.add(newMesh);
        
        renderedItemMeshes.set(selectedPlacedItem.id, newMesh);
        selectedBoxMesh = newMesh;

        // 重新附加拖拽 Gizmo 和选中框
        transformControls.attach(selectedBoxMesh);
        createSelectionHelper(selectedBoxMesh);

        // 更新滑动条边界
        updateManualSliderBounds();
        
        // 限位保护，防止旋转后溢出边界
        clampItemPosition(selectedPlacedItem);
        updateMeshPosition(selectedBoxMesh, selectedPlacedItem);

        updateCoordUI();
        checkManualPlacementCollisions();
        updateStats();
    });
});

// 手动限位保护
function clampItemPosition(item) {
    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);

    item.x = Math.max(0, Math.min(item.x, binW - item.rw));
    item.y = Math.max(0, Math.min(item.y, binH - item.rh));
    item.z = Math.max(0, Math.min(item.z, binL - item.rd));
}

// 移除手动摆放项目
document.getElementById('btn-delete-placed').addEventListener('click', () => {
    if (!selectedPlacedItem) return;
    
    const id = selectedPlacedItem.id;
    placedItems = placedItems.filter(item => item.id !== id);

    // 移除 3D mesh
    const mesh = renderedItemMeshes.get(id);
    if (mesh) {
        scene.remove(mesh);
        disposeMesh(mesh);
        renderedItemMeshes.delete(id);
    }

    selectPlacedItemById(null);
    renderPlacedItemsListUI();
    updateStats();
});

// 一键落底重力辅助
document.getElementById('btn-gravity-drop').addEventListener('click', () => {
    if (!selectedPlacedItem || !selectedBoxMesh) return;

    const binH = parseFloat(document.getElementById('bin-h').value);
    const landingY = Packer.getGravityDropY(
        selectedPlacedItem,
        placedItems,
        binH,
        { maxLandingY: selectedPlacedItem.y }
    );

    if (landingY !== null) {
        selectedPlacedItem.y = landingY;
        updateMeshPosition(selectedBoxMesh, selectedPlacedItem);
        updateCoordUI();
        checkManualPlacementCollisions();
        updateStats();
    }
});

// 监听 3D 轴拉伸 Gizmo 拖动后的坐标转换
function onGizmoDrag() {
    if (!selectedPlacedItem || !selectedBoxMesh) return;

    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);

    // 将 3D 网格位置 x3d, y3d, z3d 反向计算为逻辑坐标 (x,y,z)
    let rx = selectedBoxMesh.position.x - selectedPlacedItem.rw / 2 + binW / 2;
    let ry = selectedBoxMesh.position.y - selectedPlacedItem.rh / 2 + 20;
    let rz = selectedBoxMesh.position.z - selectedPlacedItem.rd / 2 + binL / 2;

    // 对齐网格以实现吸附感 (Snap to 1cm Grid)
    rx = Math.round(rx);
    ry = Math.round(ry);
    rz = Math.round(rz);

    // 强力边界限位约束
    selectedPlacedItem.x = Math.max(0, Math.min(rx, binW - selectedPlacedItem.rw));
    selectedPlacedItem.y = Math.max(0, Math.min(ry, binH - selectedPlacedItem.rh));
    selectedPlacedItem.z = Math.max(0, Math.min(rz, binL - selectedPlacedItem.rd));

    // 更新网格坐标以纠正可能的小数偏差
    updateMeshPosition(selectedBoxMesh, selectedPlacedItem);
    
    // 更新滑块 UI 显示
    updateCoordUI();
    
    // 触发碰撞和非法位置警示
    checkManualPlacementCollisions();
    
    // 更新统计
    updateStats();
}

// 物理碰撞和超出边界高亮高阶检测
function checkManualPlacementCollisions() {
    if (!selectedPlacedItem) return;

    // 对全部手动物品做全局校验，避免切换选择后清除其他物品的碰撞状态。
    const binL = parseFloat(document.getElementById('bin-l').value);
    const binW = parseFloat(document.getElementById('bin-w').value);
    const binH = parseFloat(document.getElementById('bin-h').value);
    const invalidIds = new Set();

    for (const item of placedItems) {
        if (item.x < 0 || item.y < 0 || item.z < 0 ||
            item.x + item.rw > binW || item.y + item.rh > binH || item.z + item.rd > binL) {
            invalidIds.add(item.id);
        }
    }

    // B. 遍历所有盒子对做碰撞检测
    for (let i = 0; i < placedItems.length; i++) {
        for (let j = i + 1; j < placedItems.length; j++) {
            const itemA = placedItems[i];
            const itemB = placedItems[j];
            if (boxesOverlap(itemA, itemB)) {
                invalidIds.add(itemA.id);
                invalidIds.add(itemB.id);
            }
        }
    }

    for (const item of placedItems) {
        updatePlacedBoxVisual(item, invalidIds.has(item.id));
    }

    // D. 显示红色悬浮警报条
    const alertBanner = document.getElementById('collision-alert');
    if (invalidIds.size > 0) {
        alertBanner.style.display = 'flex';
    } else {
        alertBanner.style.display = 'none';
    }
}

// 辅助方法：修改已摆放网格的高亮材质
function updatePlacedBoxVisual(item, isColliding) {
    const mesh = renderedItemMeshes.get(item.id);
    if (!mesh) return;

    if (isColliding) {
        mesh.material.color.setHex(0xef4444);
        mesh.material.transparent = true;
        mesh.material.opacity = 0.6;
        mesh.material.roughness = 0.8;
    } else {
        mesh.material.color.set(new THREE.Color(item.color));
        mesh.material.transparent = false;
        mesh.material.opacity = 1.0;
        mesh.material.roughness = 0.4;
    }
    requestRender();
}

// 渲染已摆放盒子列表 UI
function renderPlacedItemsListUI() {
    const listDiv = document.getElementById('manual-placed-items');
    listDiv.innerHTML = '';

    placedItems.forEach(item => {
        const div = document.createElement('div');
        const isSelected = selectedPlacedItem && selectedPlacedItem.id === item.id;
        const safeName = escapeHtml(item.name);
        div.className = `manual-item-row ${isSelected ? 'selected' : ''}`;
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${item.color};"></div>
                <span class="manual-item-name">${safeName}</span>
            </div>
            <span class="manual-item-coords">x:${Math.round(item.x)} y:${Math.round(item.y)} z:${Math.round(item.z)}</span>
        `;
        
        div.addEventListener('click', () => {
            selectPlacedItemById(item.id);
        });

        listDiv.appendChild(div);
    });
}

// ==========================================
// 8. 实时数据统计看板更新
// ==========================================
function updateStats() {
    const binL = parseFloat(document.getElementById('bin-l').value) || 60;
    const binW = parseFloat(document.getElementById('bin-w').value) || 40;
    const binH = parseFloat(document.getElementById('bin-h').value) || 50;

    // 1. 容器总体积，换算为升 (1L = 1000 cm³)
    const containerVolume = (binL * binW * binH) / 1000;
    document.getElementById('stat-container-vol').innerText = `${containerVolume.toFixed(1)} L`;

    let activeItems = [];
    let unpackCount = 0;

    if (activeMode === 'auto') {
        activeItems = autoPackedItems.slice(0, animationStep);
        unpackCount = autoUnpackedItems.length;
    } else {
        activeItems = placedItems;
    }

    // 2. 已装载总体积
    let packedVolCc = 0;
    activeItems.forEach(item => {
        packedVolCc += item.rw * item.rh * item.rd;
    });
    const packedVolume = packedVolCc / 1000;
    document.getElementById('stat-packed-vol').innerText = `${packedVolume.toFixed(1)} L`;

    // 3. 空闲体积
    const freeVolume = Math.max(0, containerVolume - packedVolume);
    document.getElementById('stat-free-vol').innerText = `${freeVolume.toFixed(1)} L`;

    // 4. 利用率百分比
    const utilization = containerVolume > 0 ? (packedVolume / containerVolume) * 100 : 0;
    
    // 更新圆形进度环
    const circle = document.getElementById('efficiency-circle');
    const textCircle = document.getElementById('efficiency-val-circle');
    const statusText = document.getElementById('efficiency-status-text');

    const offset = 220 - (220 * Math.min(100, utilization)) / 100;
    circle.style.strokeDashoffset = offset;
    textCircle.innerText = `${utilization.toFixed(1)}%`;

    if (activeItems.length === 0) {
        statusText.innerText = '暂无货物';
        statusText.style.color = 'var(--text-secondary)';
    } else if (utilization < 40) {
        statusText.innerText = '装载空旷';
        statusText.style.color = 'var(--warning)';
    } else if (utilization < 75) {
        statusText.innerText = '利用良好';
        statusText.style.color = 'var(--primary)';
    } else {
        statusText.innerText = '高效满载';
        statusText.style.color = 'var(--success)';
    }

    // 5. 数量统计
    let totalInventoryQty = 0;
    inventory.forEach(i => totalInventoryQty += i.qty);

    if (activeMode === 'auto') {
        document.getElementById('stat-packed-count').innerText = `${activeItems.length} / ${totalInventoryQty} 个`;
    } else {
        document.getElementById('stat-packed-count').innerText = `${activeItems.length} 个`;
    }

    // 6. 处理溢出未装入警示栏
    const warningSection = document.getElementById('warning-section');
    if (activeMode === 'auto' && unpackCount > 0) {
        warningSection.style.display = 'flex';
        document.getElementById('warning-text').innerText = `共有 ${unpackCount} 件货物由于空间限制或重力支撑性校验未通过，未能成功装入。请适当调整容器尺寸或减少配置。`;
    } else {
        warningSection.style.display = 'none';
    }

    // --- 新增重量与泡货统计计算 (v2.0) ---
    const binEmptyWeight = parseFloat(document.getElementById('bin-empty-weight').value) || 1.5;
    const binMaxWeight = parseFloat(document.getElementById('bin-max-weight').value) || 21.0;
    const binDivisor = parseFloat(document.getElementById('bin-divisor').value) || 8000;

    // 计算实际总重
    let totalWeight = binEmptyWeight;
    activeItems.forEach(item => {
        totalWeight += parseFloat(item.weight) || 0;
    });

    // 更新整箱总重浮动看板
    const vTotalWeight = document.getElementById('v-total-weight');
    if (vTotalWeight) {
        vTotalWeight.innerText = `${totalWeight.toFixed(1)} kg / ${binMaxWeight.toFixed(1)} kg`;
        if (totalWeight > binMaxWeight) {
            vTotalWeight.classList.add('danger-weight');
        } else {
            vTotalWeight.classList.remove('danger-weight');
        }
    }

    // 计算体积泡货值 (cm³ / 泡货系数)
    const dimWeight = (binL * binW * binH) / binDivisor;
    const vDimWeight = document.getElementById('v-dim-weight');
    if (vDimWeight) {
        let dimWeightText = `${dimWeight.toFixed(1)} kg`;
        if (dimWeight > totalWeight) {
            dimWeightText += ` <span style="font-size: 0.7rem; color: var(--warning); font-weight: normal;">(按体积泡货计费)</span>`;
        }
        vDimWeight.innerHTML = dimWeightText;
    }

    // 更新已装入明细
    const vLoadedDetails = document.getElementById('v-loaded-details');
    if (vLoadedDetails) {
        const counts = new Map();
        activeItems.forEach(item => {
            counts.set(item.name, (counts.get(item.name) || 0) + 1);
        });
        const details = Array.from(counts.entries()).map(([name, count]) => `${name}x${count}`).join(', ');
        vLoadedDetails.innerText = details || '暂无货物';
    }
}

// ==========================================
// 8.5. 主题切换与同步 (v2.0)
// ==========================================
function syncThreeTheme() {
    if (!scene) return;
    const isLight = document.body.classList.contains('light-theme');
    
    // 动态调整 Three.js 背景色
    scene.background.set(isLight ? '#f1f5f9' : '#070b13');
    
    // 重新创建网格辅助器
    if (gridHelper) {
        scene.remove(gridHelper);
        disposeMesh(gridHelper);
        if (isLight) {
            gridHelper = new THREE.GridHelper(200, 50, 0x4f46e5, 0xcbd5e1);
        } else {
            gridHelper = new THREE.GridHelper(200, 50, 0x3b82f6, 0x1e293b);
        }
        gridHelper.position.y = -20;
        gridHelper.visible = document.getElementById('view-toggle-grid').classList.contains('active');
        scene.add(gridHelper);
    }
    
    // 动态更新容器材质颜色
    if (containerMesh) {
        containerMesh.material.color.setHex(isLight ? 0xffffff : 0x1e293b);
    }
    if (containerEdges) {
        containerEdges.material.color.setHex(isLight ? 0x4f46e5 : 0x6366f1);
    }
    
    renderer.render(scene, camera);
}

// ==========================================
// 8.6. 智能配载数量计算器 (v2.0)
// ==========================================
function solveCargoQuantities() {
    let binL, binW, binH, binEmptyWeight, binMaxWeight;
    try {
        binL = readNumericInput('bin-l', { min: 5, max: 500 });
        binW = readNumericInput('bin-w', { min: 5, max: 500 });
        binH = readNumericInput('bin-h', { min: 5, max: 500 });
        binEmptyWeight = readNumericInput('bin-empty-weight', { min: 0, max: 100000 });
        binMaxWeight = readNumericInput('bin-max-weight', { min: 0.01, max: 100000 });
        if (binMaxWeight <= binEmptyWeight) {
            throw new RangeError('承载上限必须大于箱子空重');
        }
    } catch (error) {
        showWarningModal('error', '配载参数无效', error.message, '请修正容器重量和尺寸设置。');
        return;
    }

    const V_bin = binL * binW * binH;
    const maxVolumeLimit = 0.75 * V_bin; // 引入 75% 拼装安全容积余量
    const maxWeightLimit = binMaxWeight - binEmptyWeight;

    if (inventory.length === 0) {
        showWarningModal(
            'warning',
            '无可用产品',
            '产品清单为空，请先添加产品盒子！',
            '请在左侧面板中输入产品规格并点击“添加产品”。'
        );
        return;
    }

    // 初始化分配数组：先满足所有货物的最少数量 (占比系数与最少装货数量在0时不参与计算)
    const allocated = [];
    let currentWeight = 0;
    let currentVolume = 0;

    for (let i = 0; i < inventory.length; i++) {
        const item = inventory[i];
        const minQty = parseInt(item.minQty) || 0;
        allocated[i] = minQty;
        currentWeight += minQty * (parseFloat(item.weight) || 0);
        currentVolume += minQty * (parseFloat(item.l) * parseFloat(item.w) * parseFloat(item.h));
    }

    // 检查最少数量自身是否已超标
    if (currentWeight > maxWeightLimit) {
        showWarningModal(
            'error',
            '最少数量设置超出承载上限',
            `所有货物的最少数量重量总和为 ${(currentWeight + binEmptyWeight).toFixed(1)} kg（含箱子空重），已超出箱子承载上限 ${binMaxWeight.toFixed(1)} kg。`,
            '请减少产品的“最少数量”或者调高箱子的“承载上限”。'
        );
        return;
    }
    if (currentVolume > maxVolumeLimit) {
        showWarningModal(
            'error',
            '最少数量设置超出安全容积',
            `所有货物的最少数量体积总和为 ${(currentVolume / 1000).toFixed(1)} L，已超出 75% 的安全容积 ${(maxVolumeLimit / 1000).toFixed(1)} L。`,
            '请减少产品的“最少数量”或者增大箱子尺寸。'
        );
        return;
    }

    // 标记不参与分配的产品 (配载占比在0时不参与比例拼装计算)
    const blocked = new Array(inventory.length).fill(false);
    for (let i = 0; i < inventory.length; i++) {
        const ratio = parseInt(inventory[i].ratio) || 0;
        if (ratio <= 0) {
            blocked[i] = true; // 不参与比例分配计算，锁定在最少数量 (即使为0也锁定)
        }
    }

    // 循环贪心配比分配
    while (true) {
        // 安全检测：如果总分配数量已经非常大（防止死循环/极端边界造成的卡死）
        const totalQty = allocated.reduce((sum, q) => sum + q, 0);
        if (totalQty >= 1000) {
            break;
        }

        // 寻找当前未被封顶的且配载偏离比例最小的产品
        let bestIndex = -1;
        let minVal = Infinity;

        for (let i = 0; i < inventory.length; i++) {
            if (blocked[i]) continue;
            
            const ratio = parseInt(inventory[i].ratio) || 0;
            if (ratio <= 0) {
                blocked[i] = true;
                continue;
            }
            const minQty = parseInt(inventory[i].minQty) || 0;
            const val = (allocated[i] - minQty) / ratio;

            if (val < minVal) {
                minVal = val;
                bestIndex = i;
            }
        }

        // 所有产品均已超出物理阈值或不参与计算而被锁死
        if (bestIndex === -1) {
            break;
        }

        const item = inventory[bestIndex];
        const wgt = parseFloat(item.weight) || 0;
        const vol = parseFloat(item.l) * parseFloat(item.w) * parseFloat(item.h);

        // 预检：增加 1 件该产品是否会超出重量或容积上限
        if (currentWeight + wgt > maxWeightLimit) {
            blocked[bestIndex] = true;
            continue;
        }
        if (currentVolume + vol > maxVolumeLimit) {
            blocked[bestIndex] = true;
            continue;
        }

        // 分配成功，更新累加值
        allocated[bestIndex]++;
        currentWeight += wgt;
        currentVolume += vol;
    }

    // 将计算分配后的数量结果写回 inventory 列表，并刷新 UI
    for (let i = 0; i < inventory.length; i++) {
        inventory[i].qty = allocated[i];
    }

    renderInventoryUI();
    updateStats();

    // 触发 3D 重新排布计算呈现
    document.getElementById('run-pack-btn').click();
}

// ==========================================
// 9. 模式切换与初始化逻辑
// ==========================================
function switchMode(mode) {
    if (activeMode === mode) return;

    activeMode = mode;
    stopAnimation();
    clearRenderedBoxes();

    const tabAuto = document.getElementById('tab-auto');
    const tabManual = document.getElementById('tab-manual');
    const autoPanel = document.getElementById('auto-panel');
    const manualPanel = document.getElementById('manual-panel');
    const qtyField = document.getElementById('qty-field');

    if (mode === 'auto') {
        tabAuto.classList.add('active');
        tabAuto.setAttribute('aria-selected', 'true');
        tabManual.classList.remove('active');
        tabManual.setAttribute('aria-selected', 'false');
        autoPanel.style.display = 'block';
        manualPanel.style.display = 'none';
        qtyField.style.display = 'block'; // 自动装箱支持批量添加
        
        autoPackedItems = [];
        autoUnpackedItems = [];
        document.getElementById('anim-section').style.display = 'none';
    } else {
        tabAuto.classList.remove('active');
        tabAuto.setAttribute('aria-selected', 'false');
        tabManual.classList.add('active');
        tabManual.setAttribute('aria-selected', 'true');
        autoPanel.style.display = 'none';
        manualPanel.style.display = 'block';
        qtyField.style.display = 'none'; // 手动装载时，侧边栏直接点击“放入1件”
        
        placedItems = [];
        selectPlacedItemById(null);
        renderPlacedItemsListUI();
    }

    // 刷新库存 UI
    renderInventoryUI();
    
    // 重置统计看板
    updateStats();
    
    // 渲染更新
    renderer.render(scene, camera);
}

document.getElementById('tab-auto').addEventListener('click', () => switchMode('auto'));
document.getElementById('tab-manual').addEventListener('click', () => switchMode('manual'));

// ==========================================
// 10. 视口悬浮工具栏功能绑定
// ==========================================

// A. 相机复位
document.getElementById('view-reset-camera').addEventListener('click', () => {
    camera.position.set(70, 70, 100);
    const h = parseFloat(document.getElementById('bin-h').value) || 50;
    orbitControls.target.set(0, h / 2 - 20, 0);
    orbitControls.update();
});

// B. 网格辅助器开关
document.getElementById('view-toggle-grid').addEventListener('click', (e) => {
    let btn = e.target;
    while (btn.tagName !== 'BUTTON') btn = btn.parentElement;

    const active = btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', String(active));
    gridHelper.visible = active;
    axesHelper.visible = active;
    
    renderer.render(scene, camera);
});

// C. 容器外壳框线模式切换 (Wireframe / Solid)
document.getElementById('view-toggle-wireframe').addEventListener('click', (e) => {
    let btn = e.target;
    while (btn.tagName !== 'BUTTON') btn = btn.parentElement;

    const active = btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', String(active));
    if (containerMesh) {
        if (active) {
            containerMesh.material.opacity = 0.0;
        } else {
            const opacity = parseFloat(document.getElementById('view-opacity').value) / 100;
            containerMesh.material.opacity = opacity;
        }
        renderer.render(scene, camera);
    }
});

// D. 容器壳透明度拖动
document.getElementById('view-opacity').addEventListener('input', (e) => {
    const opacity = parseFloat(e.target.value) / 100;
    if (containerMesh && !document.getElementById('view-toggle-wireframe').classList.contains('active')) {
        containerMesh.material.opacity = opacity;
        renderer.render(scene, camera);
    }
});

// ==========================================
// 11. 初始化启动
// ==========================================
window.onload = () => {
    // A. 建立 3D 渲染视口
    init3DScene();

    // B. 创建容器
    updateContainer3D();

    // 容器尺寸与属性输入框联动
    document.getElementById('bin-l').addEventListener('change', updateContainer3D);
    document.getElementById('bin-w').addEventListener('change', updateContainer3D);
    document.getElementById('bin-h').addEventListener('change', updateContainer3D);
    document.getElementById('bin-empty-weight').addEventListener('change', updateStats);
    document.getElementById('bin-max-weight').addEventListener('change', updateStats);
    document.getElementById('bin-divisor').addEventListener('change', updateStats);

    // C. 渲染预设库存
    renderInventoryUI();

    // D. 初始化数据看板
    updateStats();

    // E. 绑定弹窗关闭按钮
    document.getElementById('modal-close-btn').addEventListener('click', () => {
        document.getElementById('warning-modal').style.display = 'none';
        lastFocusedElement?.focus();
    });

    // F. 绑定日夜间模式切换按钮 (v2.0)
    const themeToggleBtn = document.getElementById('theme-toggle');
    themeToggleBtn.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-theme');
        if (isLight) {
            themeToggleBtn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 0.95rem; height: 0.95rem; stroke: currentColor; fill: none; stroke-width: 2;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                <span id="theme-text">夜间模式</span>
            `;
        } else {
            themeToggleBtn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 0.95rem; height: 0.95rem; stroke: currentColor; fill: none; stroke-width: 2;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                <span id="theme-text">日间模式</span>
            `;
        }
        syncThreeTheme();
    });

    // G. 绑定智能配载数量计算器 (v2.0)
    document.getElementById('calc-qty-btn').addEventListener('click', solveCargoQuantities);

    // H. 绑定占比系数与最少装货数量互斥逻辑 (v2.0 优化)
    const ratioInput = document.getElementById('item-ratio');
    const minQtyInput = document.getElementById('item-min-qty');

    function handleInputExclusivity() {
        let ratioVal = parseFloat(ratioInput.value) || 0;
        let minQtyVal = parseInt(minQtyInput.value) || 0;

        if (ratioInput.value !== '' && parseFloat(ratioInput.value) < 0) {
            ratioInput.value = "0";
            ratioVal = 0;
        }
        if (minQtyInput.value !== '' && parseInt(minQtyInput.value) < 0) {
            minQtyInput.value = "0";
            minQtyVal = 0;
        }

        if (ratioVal > 0) {
            minQtyInput.value = "0";
            minQtyInput.disabled = true;
        } else if (minQtyVal > 0) {
            ratioInput.value = "0";
            ratioInput.disabled = true;
        } else {
            ratioInput.disabled = false;
            minQtyInput.disabled = false;
        }
    }

    ratioInput.addEventListener('input', handleInputExclusivity);
    minQtyInput.addEventListener('input', handleInputExclusivity);

    ratioInput.addEventListener('blur', () => {
        if (ratioInput.value === '' || isNaN(parseFloat(ratioInput.value))) {
            ratioInput.value = "0";
        }
        handleInputExclusivity();
    });

    minQtyInput.addEventListener('blur', () => {
        if (minQtyInput.value === '' || isNaN(parseInt(minQtyInput.value))) {
            minQtyInput.value = "0";
        }
        handleInputExclusivity();
    });

    // 初始化互斥状态
    handleInputExclusivity();

    // 点击被禁用的输入框时，提示用户解锁
    const ratioWrapper = ratioInput.parentElement;
    const minQtyWrapper = minQtyInput.parentElement;

    ratioWrapper.addEventListener('click', () => {
        if (ratioInput.disabled) {
            showWarningModal(
                'warning',
                '输入限制提示',
                '装箱配比与最少数量互斥。',
                '当前“最少数量”已输入数值。请先清除“最少数量”的数值（将其修改或重置为 0）后，才能输入装箱配比。'
            );
        }
    });

    minQtyWrapper.addEventListener('click', () => {
        if (minQtyInput.disabled) {
            showWarningModal(
                'warning',
                '输入限制提示',
                '最少数量与装箱配比互斥。',
                '当前“装箱配比”已输入数值。请先清除“装箱配比”的数值（将其修改或重置为 0）后，才能输入最少数量。'
            );
        }
    });

    // I. 关于系统弹窗交互 (Bilingual About Modal Interaction)
    const aboutToggle = document.getElementById('about-toggle');
    const aboutModal = document.getElementById('about-modal');
    const aboutCloseBtn = document.getElementById('about-close-btn');
    const aboutGithubBtn = document.getElementById('about-github-btn');
    const aboutTabZh = document.getElementById('about-tab-zh');
    const aboutTabEn = document.getElementById('about-tab-en');
    const aboutContentZh = document.getElementById('about-content-zh');
    const aboutContentEn = document.getElementById('about-content-en');

    if (aboutToggle && aboutModal) {
        aboutToggle.addEventListener('click', () => {
            lastFocusedElement = document.activeElement;
            aboutModal.style.display = 'flex';
            requestAnimationFrame(() => aboutCloseBtn?.focus());
        });
    }

    if (aboutCloseBtn && aboutModal) {
        aboutCloseBtn.addEventListener('click', () => {
            aboutModal.style.display = 'none';
            lastFocusedElement?.focus();
        });
    }

    if (aboutModal) {
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                aboutModal.style.display = 'none';
                lastFocusedElement?.focus();
            }
        });
    }

    if (aboutTabZh && aboutTabEn && aboutContentZh && aboutContentEn) {
        aboutTabZh.addEventListener('click', () => {
            aboutTabZh.classList.add('active');
            aboutTabEn.classList.remove('active');
            aboutContentZh.style.display = 'flex';
            aboutContentEn.style.display = 'none';
        });
        aboutTabEn.addEventListener('click', () => {
            aboutTabEn.classList.add('active');
            aboutTabZh.classList.remove('active');
            aboutContentEn.style.display = 'flex';
            aboutContentZh.style.display = 'none';
        });
    }

    if (aboutGithubBtn) {
        aboutGithubBtn.addEventListener('click', () => {
            window.open('https://github.com/Xebet/3d-packing-simulator', '_blank', 'noopener,noreferrer');
        });
    }

    // J. 交互式功能导览 (Interactive Onboarding Tour)
    const aboutTourBtn = document.getElementById('about-tour-btn');
    const tourOverlay = document.getElementById('tour-overlay');
    const tourHighlight = document.getElementById('tour-highlight');
    const tourTooltip = document.getElementById('tour-tooltip');
    const tourSkipBtn = document.getElementById('tour-skip-btn');
    const tourBackBtn = document.getElementById('tour-back-btn');
    const tourNextBtn = document.getElementById('tour-next-btn');

    const tourSteps = [
        {
            element: null,
            title: "欢迎来到 3D 智能装箱模拟器! 👋<br>Welcome to 3D Packing Simulator!",
            desc: "这是一个离线、高性能的 3D 装箱配载和排布规划系统。接下来我们将带您快速了解各项核心功能。<hr>This is an offline, high-performance 3D packing simulation and layout system. Let's walk through the core features."
        },
        {
            element: "#tour-container-config",
            title: "1. 容器尺寸与配置 (Container Dimensions)",
            desc: "在此配置货柜/箱子的长、宽、高尺寸，以及自重上限和泡货折重系数等属性。<hr>Set the length, width, height, maximum payload capacity, and volumetric billing divisor of your container here."
        },
        {
            element: "#tour-modes",
            title: "2. 工作模式切换 (Packing Modes)",
            desc: "支持双模式：<br><b>自动模式</b>：运行并行算法，自动输出并播放最优化装箱策略；<br><b>手动模式</b>：在三维中以 3D 控制轴自由挪动、摆放和旋转货物。<hr>Select between: <br><b>Auto Mode</b>: Runs multi-core solver for optimal strategies;<br><b>Manual Mode</b>: Manually drag/rotate boxes with 3D translation gizmos."
        },
        {
            element: "#tour-box-config",
            title: "3. 产品货物配置 (Cargo Inventory)",
            desc: "设置要装入的产品长宽高、颜色、重量、装载数量及各类朝向、重力支撑等限制参数。点击下方“添加/修改此配置”可增加入库。<hr>Configure cargo sizes, colors, weight, quantities, and placement constraints (e.g., orientation, bottom support). Click 'Add/Update Config' to save."
        },
        {
            element: "#run-pack-btn",
            title: "4. 开始智能计算 (Trigger Solver)",
            desc: "配置好货物后，点击此按钮。系统会动态分配多核 Web Workers 全速并发计算最完美装箱解，主界面完全不卡顿。<hr>Click here to trigger multi-core background parallel computation for the optimal packing solution. The page remains fully responsive."
        },
        {
            element: "#canvas-container",
            title: "5. 3D 三维交互视口 (3D Viewport)",
            desc: "三维可视化呈现。支持<b>左键拖拽旋转</b>、<b>右键拖拽平移</b>、<b>滚轮缩放</b>。顶部显示当前货物的实时装载体积占比与称重详情。<hr>Interactive 3D visualization. Use <b>Left click drag</b> to rotate, <b>Right click drag</b> to pan, and <b>Wheel</b> to zoom. Check metrics on the top overlay."
        },
        {
            element: "#about-toggle",
            title: "6. 关于与指南 (About & Guide)",
            desc: "随时点击此按钮查看体积折重、重力稳定性等核心公式算法。您也可以在此处随时重新打开本使用指南！<hr>Click '关于 / About' to review volumetric weight formulas and gravity checks, or to restart this guide at any time!"
        }
    ];

    let currentTourStep = 0;
    let tourResizeHandler = null;

    function startTour() {
        currentTourStep = 0;
        if (tourOverlay) tourOverlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // 关闭关于弹窗和其他可能弹出的提示
        if (aboutModal) aboutModal.style.display = 'none';
        const warningModal = document.getElementById('warning-modal');
        if (warningModal) warningModal.style.display = 'none';

        showTourStep(0);

        // 绑定视口缩放与调整监听器，使高亮和提示框自适应
        tourResizeHandler = () => {
            const step = tourSteps[currentTourStep];
            const targetEl = step.element ? document.querySelector(step.element) : null;
            positionTooltip(targetEl, tourTooltip, tourHighlight);
        };
        window.addEventListener('resize', tourResizeHandler);
    }

    function showTourStep(index) {
        currentTourStep = index;
        const step = tourSteps[index];
        const targetEl = step.element ? document.querySelector(step.element) : null;

        const badge = document.getElementById('tour-step-badge');
        const title = document.getElementById('tour-step-title');
        const desc = document.getElementById('tour-step-desc');

        if (badge) badge.textContent = `步骤 ${index + 1} / ${tourSteps.length} (Step ${index + 1} / ${tourSteps.length})`;
        if (title) title.innerHTML = step.title;
        if (desc) desc.innerHTML = step.desc;

        if (tourBackBtn) {
            if (index === 0) {
                tourBackBtn.style.display = 'none';
            } else {
                tourBackBtn.style.display = 'block';
            }
        }

        if (tourNextBtn) {
            if (index === tourSteps.length - 1) {
                tourNextBtn.textContent = '完成 / Finish';
            } else {
                tourNextBtn.textContent = '下一步 / Next';
            }
        }

        if (tourTooltip) tourTooltip.classList.remove('active');

        if (targetEl) {
            // 将元素平滑滚动到屏幕中心，避免视口外高亮计算不准
            targetEl.scrollIntoView({ block: 'center', inline: 'nearest' });
            setTimeout(() => {
                positionTooltip(targetEl, tourTooltip, tourHighlight);
                if (tourTooltip) tourTooltip.classList.add('active');
            }, 200);
        } else {
            positionTooltip(null, tourTooltip, tourHighlight);
            if (tourTooltip) tourTooltip.classList.add('active');
        }
    }

    function endTour(completed) {
        if (tourOverlay) tourOverlay.style.display = 'none';
        document.body.style.overflow = '';
        if (tourResizeHandler) {
            window.removeEventListener('resize', tourResizeHandler);
            tourResizeHandler = null;
        }
        if (completed) {
            localStorage.setItem('packing_simulator_tour_completed', 'true');
        }
    }

    function positionTooltip(targetEl, tooltipEl, highlightEl) {
        if (!tooltipEl || !highlightEl) return;

        if (!targetEl) {
            // 欢迎页的居中效果
            tooltipEl.style.top = '50%';
            tooltipEl.style.left = '50%';
            tooltipEl.style.transform = 'translate(-50%, -50%)';
            highlightEl.style.width = '0px';
            highlightEl.style.height = '0px';
            highlightEl.style.top = '50%';
            highlightEl.style.left = '50%';
            highlightEl.style.boxShadow = '0 0 0 9999px rgba(2, 6, 23, 0.75)';
            return;
        }

        const rect = targetEl.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        // 设置高亮框的宽度、高度、外间距
        const padding = 6;
        const top = rect.top + scrollTop - padding;
        const left = rect.left + scrollLeft - padding;
        const width = rect.width + padding * 2;
        const height = rect.height + padding * 2;

        highlightEl.style.top = `${top}px`;
        highlightEl.style.left = `${left}px`;
        highlightEl.style.width = `${width}px`;
        highlightEl.style.height = `${height}px`;
        highlightEl.style.boxShadow = '0 0 0 9999px rgba(2, 6, 23, 0.75), 0 0 15px var(--primary)';
        
        // 计算提示气泡的最佳摆放坐标
        const tooltipWidth = 320;
        const gap = 15;
        let tTop, tLeft;
        tooltipEl.style.transform = 'none';

        // 基于屏幕可用空间进行动态微调
        const spaceRight = window.innerWidth - rect.right;
        const spaceLeft = rect.left;
        const spaceBottom = window.innerHeight - rect.bottom;

        if (spaceRight > tooltipWidth + gap) {
            // 优先放在右侧
            tLeft = rect.right + gap;
            tTop = rect.top + scrollTop + (rect.height - tooltipEl.offsetHeight) / 2;
        } else if (spaceLeft > tooltipWidth + gap) {
            // 空间不足放左侧
            tLeft = rect.left - tooltipWidth - gap;
            tTop = rect.top + scrollTop + (rect.height - tooltipEl.offsetHeight) / 2;
        } else if (spaceBottom > 220) {
            // 上下布局：放下方
            tLeft = rect.left + scrollLeft + (rect.width - tooltipWidth) / 2;
            tTop = rect.bottom + gap + scrollTop;
        } else {
            // 放上方
            tLeft = rect.left + scrollLeft + (rect.width - tooltipWidth) / 2;
            tTop = rect.top - tooltipEl.offsetHeight - gap + scrollTop;
        }

        // 边界保护：确保不超出窗口边界
        tLeft = Math.max(10, Math.min(tLeft, window.innerWidth - tooltipWidth - 10));
        tTop = Math.max(10, tTop);

        tooltipEl.style.top = `${tTop}px`;
        tooltipEl.style.left = `${tLeft}px`;
    }

    // 绑定按钮事件
    if (tourSkipBtn) {
        tourSkipBtn.addEventListener('click', () => {
            endTour(true);
        });
    }

    if (tourBackBtn) {
        tourBackBtn.addEventListener('click', () => {
            if (currentTourStep > 0) {
                showTourStep(currentTourStep - 1);
            }
        });
    }

    if (tourNextBtn) {
        tourNextBtn.addEventListener('click', () => {
            if (currentTourStep < tourSteps.length - 1) {
                showTourStep(currentTourStep + 1);
            } else {
                endTour(true);
            }
        });
    }

    // 绑定关于弹窗中的重新运行指南按钮
    if (aboutTourBtn) {
        aboutTourBtn.addEventListener('click', () => {
            startTour();
        });
    }

    // 首次载入检测
    const tourCompleted = localStorage.getItem('packing_simulator_tour_completed');
    if (!tourCompleted) {
        setTimeout(() => {
            startTour();
        }, 1200); // 1.2秒延迟，等待Three.js初始渲染就绪
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const warningModal = document.getElementById('warning-modal');
        if (warningModal.style.display !== 'none') {
            document.getElementById('modal-close-btn').click();
        } else if (aboutModal?.style.display !== 'none') {
            aboutCloseBtn?.click();
        } else if (tourOverlay?.style.display !== 'none') {
            endTour(false);
        }
    });
};

window.addEventListener('beforeunload', () => {
    if (cachedWorkerBlobURL) {
        URL.revokeObjectURL(cachedWorkerBlobURL);
        cachedWorkerBlobURL = null;
    }
    materialCache.forEach(material => material.dispose());
    materialCache.clear();
    renderer?.dispose();
});
