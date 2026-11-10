// ==========================================
// 1. 全局状态与配置
// ==========================================
let scene, camera, renderer, orbitControls, transformControls;
let containerMesh, containerEdges;
let shadowPlane; // 接收阴影的底板
let gridHelper, axesHelper;
let lastBinDimensions = null;
const binWeightSettings = { emptyWeight: 1.5, maxWeight: 21, divisor: 8000 };
let animationFrame = null;
let resizeObserver;
let deletedInventory = null;
let deletedPlacement = null;
let inventoryUndoTimer, placementUndoTimer;
let packingController = null;
let bestAutoResult = null;
let solutionAttempt = 0;
let packingSeed = 20260617;

const MAX_INVENTORY_QTY = 1000;
const MAX_ITEM_NAME_LENGTH = 80;
function setWorkspaceStatus(message) {
    document.getElementById('workspace-status').textContent = message;
}

function cancelPacking() {
    packingController?.abort();
}

function invalidateAutoLayout() {
    cancelPacking();
    stopAnimation();
    autoPackedItems = [];
    autoUnpackedItems = [];
    animationStep = 0;
    bestAutoResult = null;
    solutionAttempt = 0;
    packingSeed = 20260617;
    document.getElementById('alternative-pack-btn').disabled = true;
    document.getElementById('restore-best-btn').hidden = true;
    document.getElementById('packing-comparison').textContent = '配置已更新，请重新计算';
    document.getElementById('anim-section').style.display = 'none';
    if (activeMode === 'auto') clearRenderedBoxes();
    setWorkspaceStatus('配置已更新，请重新计算');
}

function requestRender() {
    if (renderer && animationFrame === null && !document.hidden) animationFrame = requestAnimationFrame(animateLoop);
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
    try {
        const value = Cargo.number(input.value, min, max, integer);
        input.removeAttribute('aria-invalid');
        input.setCustomValidity('');
        document.getElementById(id + '-error')?.remove();
        return value;
    } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity(error.message);
        let helper = document.getElementById(id + '-error');
        if (!helper) {
            helper = document.createElement('span');
            helper.id = id + '-error';
            helper.className = 'field-error';
            input.closest('.input-field')?.appendChild(helper);
        }
        helper.textContent = error.message;
        input.setAttribute('aria-describedby', helper.id);
        input.focus();
        throw new RangeError((input.labels?.[0]?.textContent || id) + '：' + error.message);
    }
}

function sceneColor(name) {
    return getComputedStyle(document.body).getPropertyValue('--scene-' + name).trim();
}


let currentOverlay = null;
const overlayFocus = new Map();

function readPreference(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Private browsing can disable persistence. */ }
}
function openOverlay(id) {
    if (currentOverlay && currentOverlay !== id) closeOverlay(currentOverlay);
    if (currentOverlay !== id) overlayFocus.set(id, document.activeElement);
    currentOverlay = id;
    const modal = document.getElementById(id);
    modal.style.display = id === 'tour-overlay' ? 'block' : 'flex';
    document.querySelector('header').inert = true;
    document.querySelector('main').inert = true;
    requestAnimationFrame(() => {
        if (currentOverlay === id) modal.querySelector('button:not([disabled])')?.focus();
    });
}
function closeOverlay(id) {
    const modal = document.getElementById(id);
    if (modal.style.display === 'none') return;
    modal.style.display = 'none';
    if (currentOverlay === id) currentOverlay = null;
    document.querySelector('header').inert = false;
    document.querySelector('main').inert = false;
    const target = overlayFocus.get(id);
    if (target?.isConnected && !target.closest('[inert]')) target.focus();
    overlayFocus.delete(id);
}
document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !currentOverlay) return;
    const modal = document.getElementById(currentOverlay);
    const nodes = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"], a[href]')].filter(node => node.getClientRects().length);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
    }
});
document.getElementById('cancel-pack-btn').addEventListener('click', cancelPacking);
document.getElementById('config-toggle').addEventListener('click', event => {
    const open = document.body.classList.toggle('config-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
    event.currentTarget.textContent = open ? '收起装箱配置' : '展开装箱配置';
});
document.getElementById('undo-inventory-btn').addEventListener('click', () => {
    if (!deletedInventory) return;
    try { Cargo.validateInventory([...inventory, deletedInventory.item]); } catch (error) {
        showWarningModal('warning', '暂时无法撤销', error.message); return;
    }
    inventory.splice(deletedInventory.index, 0, deletedInventory.item);
    deletedInventory = null;
    clearTimeout(inventoryUndoTimer);
    document.getElementById('inventory-undo').hidden = true;
    invalidateAutoLayout();
    renderInventoryUI();
    updateStats();
});
document.getElementById('undo-placement-btn').addEventListener('click', () => {
    if (!deletedPlacement) return;
    if (placedItems.length >= MAX_INVENTORY_QTY) {
        showWarningModal('warning', '暂时无法撤销', '已达到 1000 件上限，请先移出部分物品。'); return;
    }
    placedItems.push(deletedPlacement);
    if (activeMode === 'manual') {
        const mesh = createBoxMesh(deletedPlacement);
        scene.add(mesh);
        renderedItemMeshes.set(deletedPlacement.id, mesh);
        selectPlacedItemById(deletedPlacement.id);
    }
    deletedPlacement = null;
    clearTimeout(placementUndoTimer);
    document.getElementById('placement-undo').hidden = true;
    renderPlacedItemsListUI();
    if (activeMode === 'manual') checkManualPlacementCollisions();
    updateStats();
});
document.getElementById('warning-modal').addEventListener('click', event => {
    if (event.target.id === 'warning-modal') closeOverlay('warning-modal');
});

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
    scene.background = new THREE.Color(sceneColor('background')); // 深黑色科技背景 或 浅灰白背景

    // B. 相机
    camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    camera.position.set(70, 70, 100);

    // C. 渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', '三维装箱视图，可使用鼠标或触控旋转与缩放');
    renderer.domElement.setAttribute('role', 'img');
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
    transformControls.addEventListener('change', requestRender);
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
    gridHelper = new THREE.GridHelper(200, 50, sceneColor('grid-major'), sceneColor('grid'));
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
    resizeObserver = new ResizeObserver(onWindowResize);
    resizeObserver.observe(container);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAnimation();
        else requestRender();
    });

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
    requestRender();
}

function animateLoop() {
    animationFrame = null;
    if (document.hidden || !renderer) return;
    orbitControls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height || !renderer) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    requestRender();
}

function fitCamera() {
    if (!renderer || !lastBinDimensions) return;
    const { w, h, l } = lastBinDimensions;
    const radius = Math.hypot(w, h, l) / 2;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
    orbitControls.target.set(0, h / 2 - 20, 0);
    camera.position.copy(orbitControls.target).add(new THREE.Vector3(1, 0.85, 1.2).normalize().multiplyScalar(distance));
    camera.far = Math.max(1000, distance * 8);
    camera.updateProjectionMatrix();
    orbitControls.maxDistance = distance * 5;
    orbitControls.update();
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
    if (!scene) { updateStats(); return; }

    // 清理旧容器
    if (containerMesh) {
        disposeMesh(containerMesh);
        scene.remove(containerMesh);
    }
    if (containerEdges) {
        disposeMesh(containerEdges);
        scene.remove(containerEdges);
    }

    const isWireframeActive = document.getElementById('view-toggle-wireframe').classList.contains('active');
    const opacityValue = isWireframeActive ? 0.0 : (Number(document.getElementById('view-opacity').value) / 100);

    // 1. 创建半透明外壳容器
    const geometry = new THREE.BoxGeometry(w, h, l);
    // 这里将容器中心放在 (0, h/2 - 20, 0)
    // 使得容器的底部正好在 y = -20 的高度，与辅助网格平行
    const material = new THREE.MeshStandardMaterial({
        color: sceneColor('shell'),
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
    const edgesMat = new THREE.LineBasicMaterial({ color: sceneColor('edge'), linewidth: 2 });
    containerEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    containerEdges.position.copy(containerMesh.position);
    scene.add(containerEdges);

    // 3. 动态移动地面网格与阴影板，使其正好处于容器底部
    gridHelper.position.y = -20;
    const gridScale = Math.max(1, Math.max(w, l) / 100);
    gridHelper.scale.set(gridScale, 1, gridScale);
    shadowPlane.scale.set(gridScale, gridScale, 1);
    shadowPlane.position.y = -20.05;

    // 4. 重置摄像机焦距在容器的中心位置
    orbitControls.target.set(0, h / 2 - 20, 0);

    // 如果处于手动模式，重置滑块的最大值
    updateManualSliderBounds();

    if (dimensionsChanged) {
        invalidateAutoLayout();
        fitCamera();
        if (placedItems.length > 0) {
            placedItems.forEach(item => {
                clampItemPosition(item);
                const mesh = renderedItemMeshes.get(item.id);
                if (mesh) updateMeshPosition(mesh, item);
            });
            checkManualPlacementCollisions();
            renderPlacedItemsListUI();
            updateCoordUI();
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
    const list = document.getElementById('inventory-items');
    list.innerHTML = inventory.length ? '' : '<p class="empty-list">清单为空。展开“添加产品规格”，加入要装箱的产品。</p>';
    document.getElementById('inventory-summary').textContent = inventory.length + ' 种 / ' + inventory.reduce((sum, item) => sum + item.qty, 0) + ' 件';
    inventory.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'inventory-item';
        row.style.setProperty('--item-color', item.color);
        const name = escapeHtml(item.name);
        row.innerHTML = `
            <div class="item-meta"><span class="item-color-indicator"></span>
                <div class="item-details"><span class="item-name" title="${name}">${name}</span>
                    <span class="item-dims">${item.l} × ${item.w} × ${item.h} cm / ${item.weight} kg</span>
                    <span class="item-dims">配比 ${item.ratio} / 最少 ${item.minQty}</span>
                </div>
            </div>
            <div class="inventory-actions">
                <div class="item-qty-selector">
                    <button type="button" class="qty-btn dec-btn" data-index="${index}" aria-label="减少 ${name} 数量">−</button>
                    <input type="number" class="qty-input" data-index="${index}" value="${item.qty}" min="0" max="${MAX_INVENTORY_QTY}" step="1" inputmode="numeric" aria-label="${name} 数量">
                    <button type="button" class="qty-btn inc-btn" data-index="${index}" aria-label="增加 ${name} 数量">+</button>
                </div>
                ${activeMode === 'manual' ? `<button type="button" class="btn btn-secondary place-one-btn" data-index="${index}">放入1件</button>` : ''}
                <button type="button" class="delete-item-btn" data-index="${index}" aria-label="删除产品 ${name}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>
            </div>`;
        list.appendChild(row);
    });
}

function updateInventoryQuantity(index, value) {
    const original = inventory[index].qty;
    try {
        inventory[index].qty = Cargo.number(value, 0, MAX_INVENTORY_QTY, true);
        Cargo.validateInventory(inventory);
        invalidateAutoLayout();
    } catch (error) {
        inventory[index].qty = original;
        showWarningModal('warning', '数量未更新', error.message);
    }
    renderInventoryUI();
    updateStats();
}
document.getElementById('inventory-items').addEventListener('click', event => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.classList.contains('place-one-btn')) return manuallyPlaceItem(inventory[index]);
    if (button.classList.contains('delete-item-btn')) {
        deletedInventory = { item: inventory[index], index };
        document.getElementById('inventory-undo').hidden = false;
        clearTimeout(inventoryUndoTimer);
        inventoryUndoTimer = setTimeout(() => {
            deletedInventory = null;
            document.getElementById('inventory-undo').hidden = true;
        }, 10000);
        inventory.splice(index, 1);
        invalidateAutoLayout();
        renderInventoryUI();
        updateStats();
    } else updateInventoryQuantity(index, inventory[index].qty + (button.classList.contains('inc-btn') ? 1 : -1));
});
document.getElementById('inventory-items').addEventListener('change', event => {
    if (event.target.matches('.qty-input')) updateInventoryQuantity(Number(event.target.dataset.index), event.target.value);
});

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
    const candidate = { id, name, l, w, h, qty, color, weight, ratio, minQty };
    try { Cargo.validateInventory([...inventory, candidate]); } catch (error) {
        showWarningModal('warning', '产品未添加', error.message); return;
    }
    inventory.push(candidate);
    invalidateAutoLayout();
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
    
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(item.color), roughness: 0.4, metalness: 0.1 });

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
    const { l: binL, w: binW, h: binH } = lastBinDimensions;

    // 从容器相对左下后角原点 (x,y,z) 映射到 3D 空间的世界坐标
    // containerMesh 底面 y = -20，左面 x = -binW/2，后面 z = -binL/2
    const x3d = item.x + item.rw / 2 - binW / 2;
    const y3d = item.y + item.rh / 2 - 20;
    const z3d = item.z + item.rd / 2 - binL / 2;

    mesh.position.set(x3d, y3d, z3d);
}

// 清除当前场景渲染的所有货物
function clearRenderedBoxes() {
    removeSelectionHelper();
    renderedItemMeshes.forEach(mesh => {
        scene.remove(mesh);
        disposeMesh(mesh);
    });
    renderedItemMeshes.clear();
    if (transformControls) transformControls.detach();
    requestRender();
}

// ==========================================
// 6. 自动装箱模式核心控制逻辑
// ==========================================
// Search alternate container orientations, then validate upright gravity before accepting.
async function performParallelPacking(items, binW, binH, binL, options, signal) {
    const configs = [
        { perm: [0, 1, 2], bin: [binW, binH, binL] },
        { perm: [1, 0, 2], bin: [binH, binW, binL] },
        { perm: [0, 2, 1], bin: [binW, binL, binH] }
    ];
    let best = null;
    const seen = new Set();
    for (let index = 0; index < configs.length; index++) {
        const config = configs[index];
        if (seen.has(config.bin.join('|'))) continue;
        seen.add(config.bin.join('|'));
        // The saved signature is in world coordinates; mapped candidates are checked again below.
        const runOptions = index === 0 ? options : { ...options, excludeSignature: undefined };
        const result = await PackingJobs.run(items, config.bin, runOptions, { signal, onProgress(value, label) {
            const progress = document.getElementById('loading-progress');
            progress.style.transform = 'scaleX(' + ((index + value / 100) / configs.length) + ')';
            progress.parentElement.setAttribute('aria-valuenow', String(Math.round((index + value / 100) / configs.length * 100)));
            document.getElementById('loading-description').textContent = label + '，姿态 ' + (index + 1) + ' / ' + configs.length;
        } });
        if (signal.aborted) throw new DOMException('计算已取消', 'AbortError');
        if (result.noAlternative) continue;
        const packed = result.items.map(item => {
            const pos = [], size = [];
            [item.x, item.y, item.z].forEach((v, i) => pos[config.perm[i]] = v);
            [item.rw, item.rh, item.rd].forEach((v, i) => size[config.perm[i]] = v);
            const mapped = new Item(item.id, item.name, item.w, item.h, item.d, item.color, item.weight);
            mapped.x = pos[0]; mapped.y = pos[1]; mapped.z = pos[2];
            const rotation = Packer.getUniqueOrientations(mapped).find(r =>
                Math.abs(r.rw - size[0]) < 0.001 && Math.abs(r.rh - size[1]) < 0.001 && Math.abs(r.rd - size[2]) < 0.001);
            mapped.setRotation(rotation.rotationType);
            return mapped;
        });
        if (!Packer.validatePackingResult(packed, binW, binH, binL, options.checkStability, options.supportRatio).valid) continue;
        if (options.excludeSignature && Packer.layoutSignature(packed) === options.excludeSignature) continue;
        if (!best || Packer.comparePackings(packed, best.items) > 0) best = { ...result, items: packed };
        if (packed.length === items.length) break;
    }
    if (!best && options.explore) return { noAlternative: true };
    if (!best) throw new Error('未找到有效布局，请检查配置并重试');
    return best;
}

function displayAutoResult(result) {
    stopAnimation();
    autoPackedItems = result.items;
    autoUnpackedItems = result.unpacked;
    clearRenderedBoxes();
    document.getElementById('anim-section').style.display = 'block';
    const slider = document.getElementById('anim-timeline');
    slider.max = autoPackedItems.length;
    animationStep = autoPackedItems.length;
    slider.value = animationStep;
    updateStepUI();
    updateStats();
    showStep(animationStep);
    const metrics = Packer.packingMetrics(autoPackedItems);
    const best = Packer.packingMetrics(bestAutoResult.items);
    const isBest = Packer.layoutSignature(autoPackedItems) === Packer.layoutSignature(bestAutoResult.items);
    document.getElementById('restore-best-btn').hidden = isBest;
    document.getElementById('packing-comparison').textContent =
        '方案 ' + result.attempt + '，种子 ' + result.seed + '。已装 ' + metrics.count +
        ' 件，体积 ' + (metrics.volume / 1000).toFixed(1) + ' L，堆高 ' + metrics.height.toFixed(1) +
        ' cm。最佳：' + best.count + ' 件 / ' + (best.volume / 1000).toFixed(1) + ' L / ' + best.height.toFixed(1) + ' cm。';
}
document.getElementById('run-pack-btn').addEventListener('click', () => calculatePacking());
document.getElementById('alternative-pack-btn').addEventListener('click', () => calculatePacking(true));
document.getElementById('restore-best-btn').addEventListener('click', () => {
    if (packingController || !bestAutoResult) return;
    displayAutoResult(bestAutoResult);
    setWorkspaceStatus('已恢复当前数据下找到的最佳方案');
});
async function calculatePacking(explore = false) {
    if (activeMode !== 'auto' || packingController) return;
    
    stopAnimation();

    let binL, binW, binH;
    try {
        Cargo.validateInventory(inventory);
        binL = readNumericInput('bin-l', { min: 5, max: 500 });
        binW = readNumericInput('bin-w', { min: 5, max: 500 });
        binH = readNumericInput('bin-h', { min: 5, max: 500 });
        const emptyWeight = readNumericInput('bin-empty-weight', { min: 0, max: 100000 });
        const maxWeight = readNumericInput('bin-max-weight', { min: 0.01, max: 100000 });
        const divisor = readNumericInput('bin-divisor', { min: 1, max: 100000 });
        if (maxWeight <= emptyWeight) throw new RangeError('承载上限必须大于箱子空重');
        Object.assign(binWeightSettings, { emptyWeight, maxWeight, divisor });
    } catch (error) {
        showWarningModal('error', '容器参数无效', error.message, '请修正容器尺寸后重试。');
        return;
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
        showWarningModal('warning', '清单为空', '请先添加至少一件产品，再开始装箱。');
        return;
    }

    const previousSignature = Packer.layoutSignature(autoPackedItems);
    const started = performance.now();
    solutionAttempt++;
    packingSeed = explore ? (packingSeed + 0x9e3779b9) >>> 0 : 20260617;

    // 3. 异步并发执行装箱
    const controller = new AbortController();
    packingController = controller;
    const button = document.getElementById('run-pack-btn');
    const alternativeButton = document.getElementById('alternative-pack-btn');
    button.disabled = true;
    alternativeButton.disabled = true;
    document.getElementById('restore-best-btn').disabled = true;
    (explore ? alternativeButton : button).setAttribute('aria-busy', 'true');
    setWorkspaceStatus(explore ? '正在搜索其他方案，原布局已保留' : '正在计算装箱方案');
    document.getElementById('loading-progress').style.transform = 'scaleX(0)';
    document.querySelector('.loading-track').setAttribute('aria-valuenow', '0');
    // Fast searches should finish without flashing a full-screen scrim.
    const loadingTimer = setTimeout(() => openOverlay('loading-modal'), 300);
    try {
        const result = await performParallelPacking(itemsToPack, binW, binH, binL, {
            checkStability, supportRatio: 0.5, biggerFirst, seed: packingSeed, explore,
            excludeSignature: explore ? previousSignature : undefined
        }, controller.signal);
        if (controller.signal.aborted) return;
        closeOverlay('loading-modal');
        if (result.noAlternative) {
            setWorkspaceStatus('本次搜索未找到不同的有效方案，现有布局已保留');
            return;
        }
        result.attempt = solutionAttempt;
        result.seed = packingSeed;
        const improved = bestAutoResult && Packer.comparePackings(result.items, bestAutoResult.items) > 0;
        if (!bestAutoResult || improved) bestAutoResult = result;
        displayAutoResult(result);
        const elapsed = ((performance.now() - started) / 1000).toFixed(2);
        setWorkspaceStatus((improved ? '找到更优方案' : explore ? '已生成不同方案' : '装箱完成') +
            '，用时 ' + elapsed + ' 秒' + (result.degraded ? '（基础搜索）' : '，已校验边界、碰撞与支撑'));

        // 5. 判断并展示货物无法完全装载弹窗
        if (autoUnpackedItems.length > 0) {
            const unpackedCountMap = new Map();
            autoUnpackedItems.forEach(item => {
                unpackedCountMap.set(item.name, (unpackedCountMap.get(item.name) || 0) + 1);
            });

            const listHtml = Array.from(unpackedCountMap.entries()).map(([name, count]) => 
                `<li class="modal-bullet-item">${escapeHtml(name)}: 未能装入 ${count} 件</li>`
            ).join('');

            showWarningModal(
                'warning',
                '部分货物未能装入',
                `由于产品尺寸超出容器、剩余空间不足或支撑要求未满足，以下产品未能全部装入（已成功装入 ${autoPackedItems.length} 件）：`,
                `建议：您可以适当<strong>减少上述货物的装箱数量</strong>，或者在上方设置中<strong>增大箱子的长宽高尺寸</strong>。`,
                listHtml
            );
        }

    } catch (error) {
        closeOverlay('loading-modal');
        if (error.name !== 'AbortError') {
            setWorkspaceStatus('计算失败，原布局已保留');
            showWarningModal('error', '计算未完成', error.message, '请减少数量或检查浏览器设置后重试。');
        } else setWorkspaceStatus('计算已取消，可以调整参数后重试');
    } finally {
        clearTimeout(loadingTimer);
        if (packingController === controller) packingController = null;
        closeOverlay('loading-modal');
        button.disabled = false;
        button.removeAttribute('aria-busy');
        alternativeButton.removeAttribute('aria-busy');
        alternativeButton.disabled = autoPackedItems.length === 0;
        document.getElementById('restore-best-btn').disabled = false;
    }
}

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
            <svg aria-hidden="true" viewBox="0 0 24 24" style="stroke: var(--danger)">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
        `;
        titleEl.style.color = 'var(--danger)';
    } else {
        iconContainer.innerHTML = `
            <svg aria-hidden="true" viewBox="0 0 24 24" style="stroke: var(--warning)">
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
    const parseBold = str => escapeHtml(str || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/&lt;(\/?strong)&gt;/g, '<$1>');
    
    let contentHtml = `<p>${parseBold(message)}</p>`;
    if (listHtml) {
        contentHtml += `<ul class="modal-bullet-list">${listHtml}</ul>`;
    }
    contentHtml += `<div class="modal-suggestion">${parseBold(suggestion)}</div>`;
    
    bodyEl.innerHTML = contentHtml;

    // 显示弹窗并把键盘焦点移入对话框。
    openOverlay('warning-modal');
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
    document.getElementById('anim-play').setAttribute('aria-label', '暂停回放');
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
    document.getElementById('anim-play').setAttribute('aria-label', '播放回放');
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
    if (placedItems.length >= MAX_INVENTORY_QTY) {
        showWarningModal('warning', '已达到数量上限', '容器最多编辑 1000 件物品，请先移出部分物品。'); return;
    }
    const { l: binL, w: binW, h: binH } = lastBinDimensions;

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
            `${invItem.name} 在所有旋转方向下都无法放入当前容器。`,
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
        showWarningModal('warning', '当前落点空间不足', '请先移动原点附近的物品，再放入新盒子。');
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
        requestRender();
    }

    if (id === null) {
        selectedPlacedItem = null;
        selectedBoxMesh = null;
        transformControls.detach();
        removeSelectionHelper();
        document.getElementById('manual-coords-group').style.display = 'none';
        document.getElementById('manual-status').innerHTML = `
            <span style="color: var(--text-muted); text-align: center;">请在右侧3D视口中双击盒子，或在下方列表中选中盒子进行编辑摆放。</span>
        `;
        renderPlacedItemsListUI();
        checkManualPlacementCollisions();
        requestRender();
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
    if (!selectedPlacedItem || activeMode !== 'manual') return;

    const { l: binL, w: binW, h: binH } = lastBinDimensions;

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

    const row = [...document.querySelectorAll('.manual-item-row')].find(row => row.dataset.itemId === selectedPlacedItem.id);
    if (row) row.querySelector('.manual-item-coords').textContent =
        'x:' + Math.round(selectedPlacedItem.x) + ' y:' + Math.round(selectedPlacedItem.y) + ' z:' + Math.round(selectedPlacedItem.z);

    // 旋转模式高亮
    document.querySelectorAll('.rotation-btn').forEach(btn => {
        const rot = parseInt(btn.getAttribute('data-rot'));
        if (rot === selectedPlacedItem.rotationType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        btn.setAttribute('aria-pressed', String(rot === selectedPlacedItem.rotationType));
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
    requestRender();
}

document.getElementById('slider-x').addEventListener('input', onCoordSliderChange);
document.getElementById('slider-y').addEventListener('input', onCoordSliderChange);
document.getElementById('slider-z').addEventListener('input', onCoordSliderChange);

// 绑定旋转朝向切换
document.querySelectorAll('.rotation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!selectedPlacedItem || !selectedBoxMesh) return;
        const rot = Number(e.currentTarget.dataset.rot);
        const [rw, rh, rd] = selectedPlacedItem.getRotatedDimensions(rot);
        if (rw > lastBinDimensions.w || rh > lastBinDimensions.h || rd > lastBinDimensions.l) {
            showWarningModal('warning', '此朝向超出容器', '请选择另一个旋转朝向，或增大容器。');
            return;
        }
        removeSelectionHelper();

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
    const { l: binL, w: binW, h: binH } = lastBinDimensions;

    item.x = Math.max(0, Math.min(item.x, binW - item.rw));
    item.y = Math.max(0, Math.min(item.y, binH - item.rh));
    item.z = Math.max(0, Math.min(item.z, binL - item.rd));
}

// 移除手动摆放项目
document.getElementById('btn-delete-placed').addEventListener('click', () => {
    if (!selectedPlacedItem) return;
    
    const id = selectedPlacedItem.id;
    deletedPlacement = selectedPlacedItem;
    document.getElementById('placement-undo').hidden = false;
    clearTimeout(placementUndoTimer);
    placementUndoTimer = setTimeout(() => {
        deletedPlacement = null;
        document.getElementById('placement-undo').hidden = true;
    }, 10000);
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
    checkManualPlacementCollisions();
    updateStats();
});

// 一键落底重力辅助
document.getElementById('btn-gravity-drop').addEventListener('click', () => {
    if (!selectedPlacedItem || !selectedBoxMesh) return;

    const binH = lastBinDimensions.h;
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

    const { l: binL, w: binW, h: binH } = lastBinDimensions;

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
    // 对全部手动物品做全局校验，避免切换选择后清除其他物品的碰撞状态。
    const { l: binL, w: binW, h: binH } = lastBinDimensions;
    const invalidIds = new Set();

    const result = Packer.validatePackingResult(placedItems, binW, binH, binL, document.getElementById('cfg-stability').checked, 0.5);
    for (const error of result.errors) {
        if (error.item) invalidIds.add(error.item.id);
        if (error.itemA) invalidIds.add(error.itemA.id);
        if (error.itemB) invalidIds.add(error.itemB.id);
    }
    document.querySelector('#collision-alert .alert-banner-text').textContent =
        '布局无效：' + invalidIds.size + ' 件存在重叠、越界或支撑不足，请调整';

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
    listDiv.innerHTML = placedItems.length ? '' : '<p class="empty-list">容器内还没有物品。点击清单中的“放入1件”开始排布。</p>';

    placedItems.forEach(item => {
        const div = document.createElement('div');
        const isSelected = selectedPlacedItem && selectedPlacedItem.id === item.id;
        const safeName = escapeHtml(item.name);
        div.className = `manual-item-row ${isSelected ? 'selected' : ''}`;
        div.dataset.itemId = item.id;
        div.tabIndex = 0;
        div.setAttribute('role', 'button');
        div.setAttribute('aria-pressed', String(Boolean(isSelected)));
        div.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPlacedItemById(item.id); }
        });
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
    const { l: binL, w: binW, h: binH } = lastBinDimensions || { l: 60, w: 40, h: 50 };

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
    document.getElementById('viewport-empty').hidden = activeItems.length > 0;
    if (renderer) renderer.shadowMap.enabled = activeItems.length <= 200;

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
        document.getElementById('warning-text').innerText = `共有 ${unpackCount} 件货物由于尺寸超限、空间限制或支撑性校验未通过，未能成功装入。请适当调整容器尺寸或减少配置。`;
    } else {
        warningSection.style.display = 'none';
    }

    // --- 新增重量与泡货统计计算 (v2.0) ---
    const { emptyWeight: binEmptyWeight, maxWeight: binMaxWeight, divisor: binDivisor } = binWeightSettings;

    // 计算实际总重
    let totalWeight = binEmptyWeight;
    activeItems.forEach(item => {
        totalWeight += parseFloat(item.weight) || 0;
    });

    // 更新整箱总重浮动看板
    const vTotalWeight = document.getElementById('v-total-weight');
    if (vTotalWeight) {
        vTotalWeight.innerText = `${totalWeight.toFixed(1)} kg / ${binMaxWeight.toFixed(1)} kg` +
            (totalWeight > binMaxWeight ? `（超重 ${(totalWeight - binMaxWeight).toFixed(1)} kg）` : '');
        if (totalWeight > binMaxWeight) {
            vTotalWeight.classList.add('danger-weight');
        } else {
            vTotalWeight.classList.remove('danger-weight');
        }
    }

    // 计算体积泡货值 (cm³ / 泡货系数)
    const dimWeight = binDivisor > 0 ? (binL * binW * binH) / binDivisor : 0;
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
    
    // 动态调整 Three.js 背景色
    scene.background.set(sceneColor('background'));
    
    // 重新创建网格辅助器
    if (gridHelper) {
        scene.remove(gridHelper);
        disposeMesh(gridHelper);
        gridHelper = new THREE.GridHelper(200, 50, sceneColor('grid-major'), sceneColor('grid'));
        gridHelper.position.y = -20;
        const gridScale = Math.max(1, Math.max(lastBinDimensions.w, lastBinDimensions.l) / 100);
        gridHelper.scale.set(gridScale, 1, gridScale);
        gridHelper.visible = document.getElementById('view-toggle-grid').classList.contains('active');
        scene.add(gridHelper);
    }
    
    // 动态更新容器材质颜色
    if (containerMesh) {
        containerMesh.material.color.set(sceneColor('shell'));
    }
    if (containerEdges) {
        containerEdges.material.color.set(sceneColor('edge'));
    }
    
    requestRender();
}

// ==========================================
// 8.6. 智能配载数量计算器 (v2.0)
// ==========================================
function solveCargoQuantities() {
    try {
        const quantities = Cargo.allocate(inventory, {
            l: readNumericInput('bin-l', { min: 5, max: 500 }),
            w: readNumericInput('bin-w', { min: 5, max: 500 }),
            h: readNumericInput('bin-h', { min: 5, max: 500 }),
            emptyWeight: readNumericInput('bin-empty-weight', { min: 0, max: 100000 }),
            maxWeight: readNumericInput('bin-max-weight', { min: 0.01, max: 100000 })
        });
        invalidateAutoLayout();
        inventory.forEach((item, i) => item.qty = quantities[i]);
        renderInventoryUI();
        updateStats();
        document.getElementById('run-pack-btn').click();
    } catch (error) {
        showWarningModal('error', '配载数量未更新', error.message, '请检查尺寸、重量、配比和最少数量。');
    }
}

// ==========================================
// 9. 模式切换与初始化逻辑
// ==========================================
function switchMode(mode) {
    if (activeMode === mode) return;

    cancelPacking();
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
        
        document.getElementById('anim-section').style.display = autoPackedItems.length ? 'block' : 'none';
        showStep(animationStep);
    } else {
        tabAuto.classList.remove('active');
        tabAuto.setAttribute('aria-selected', 'false');
        tabManual.classList.add('active');
        tabManual.setAttribute('aria-selected', 'true');
        autoPanel.style.display = 'none';
        manualPanel.style.display = 'block';
        qtyField.style.display = 'none'; // 手动装载时，侧边栏直接点击“放入1件”
        
        placedItems.forEach(item => { const mesh = createBoxMesh(item); scene.add(mesh); renderedItemMeshes.set(item.id, mesh); });
        selectPlacedItemById(null);
        renderPlacedItemsListUI();
    }

    document.getElementById('tab-auto').tabIndex = mode === 'auto' ? 0 : -1;
    document.getElementById('tab-manual').tabIndex = mode === 'manual' ? 0 : -1;
    const url = new URL(location.href);
    if (mode === 'manual') url.searchParams.set('mode', 'manual'); else url.searchParams.delete('mode');
    history.replaceState(null, '', url);

    if (mode === 'auto') {
        selectedPlacedItem = null;
        selectedBoxMesh = null;
        document.getElementById('collision-alert').style.display = 'none';
    }
    setWorkspaceStatus(mode === 'auto' ? '自动装箱，配置后开始计算' : '手动排布，从清单放入物品后调整位置');

    // 刷新库存 UI
    renderInventoryUI();
    
    // 重置统计看板
    updateStats();
    
    // 渲染更新
    requestRender();
}

document.getElementById('tab-auto').addEventListener('click', () => switchMode('auto'));
document.getElementById('tab-manual').addEventListener('click', () => switchMode('manual'));

// ==========================================
// 10. 视口悬浮工具栏功能绑定
// ==========================================

// A. 相机复位
document.getElementById('view-reset-camera').addEventListener('click', () => {
    fitCamera();
});

// B. 网格辅助器开关
document.getElementById('view-toggle-grid').addEventListener('click', (e) => {
    let btn = e.target;
    while (btn.tagName !== 'BUTTON') btn = btn.parentElement;

    const active = btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', String(active));
    gridHelper.visible = active;
    axesHelper.visible = active;
    
    requestRender();
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
        requestRender();
    }
});

// D. 容器壳透明度拖动
document.getElementById('view-opacity').addEventListener('input', (e) => {
    const opacity = parseFloat(e.target.value) / 100;
    if (containerMesh && !document.getElementById('view-toggle-wireframe').classList.contains('active')) {
        containerMesh.material.opacity = opacity;
        requestRender();
    }
});

// ==========================================
// 11. 初始化启动
// ==========================================
window.onload = () => {
    // A. 建立 3D 渲染视口
    try {
        init3DScene();
    } catch {
        renderer?.dispose();
        renderer = null;
        scene = null;
        document.querySelector('#viewport-empty p').textContent = '当前环境无法启动三维视图';
        document.querySelector('#viewport-empty span').textContent = '请启用浏览器硬件加速或使用支持 WebGL 的浏览器重试。';
        for (const id of ['run-pack-btn', 'calc-qty-btn', 'tab-manual', 'view-reset-camera', 'view-toggle-grid', 'view-toggle-wireframe', 'view-opacity']) {
            document.getElementById(id).disabled = true;
        }
        setWorkspaceStatus('三维视图不可用，请检查浏览器硬件加速');
    }

    // B. 创建容器
    updateContainer3D();
    fitCamera();

    // 容器尺寸与属性输入框联动
    document.getElementById('bin-l').addEventListener('change', updateContainer3D);
    document.getElementById('bin-w').addEventListener('change', updateContainer3D);
    document.getElementById('bin-h').addEventListener('change', updateContainer3D);
    document.getElementById('bin-empty-weight').addEventListener('change', () => {
        try { binWeightSettings.emptyWeight = readNumericInput('bin-empty-weight', { min: 0, max: 100000 }); updateStats(); }
        catch (error) { showWarningModal('warning', '参数无效', error.message); }
    });
    document.getElementById('bin-max-weight').addEventListener('change', () => {
        try { binWeightSettings.maxWeight = readNumericInput('bin-max-weight', { min: 0.01, max: 100000 }); updateStats(); }
        catch (error) { showWarningModal('warning', '参数无效', error.message); }
    });
    document.getElementById('bin-divisor').addEventListener('change', () => {
        try { binWeightSettings.divisor = readNumericInput('bin-divisor', { min: 1, max: 100000 }); updateStats(); }
        catch (error) { showWarningModal('warning', '参数无效', error.message); }
    });

    // C. 渲染预设库存
    renderInventoryUI();

    // D. 初始化数据看板
    updateStats();

    // E. 绑定弹窗关闭按钮
    document.getElementById('modal-close-btn').addEventListener('click', () => {
        closeOverlay('warning-modal');
    });

    const themeSelect = document.getElementById('theme-toggle');
    const syncTheme = () => {
        applyTheme();
        themeSelect.value = themeMode;
        document.querySelector('meta[name="theme-color"]').content = sceneColor('background');
        syncThreeTheme();
    };
    syncTheme();
    themeSelect.addEventListener('change', () => {
        themeMode = themeSelect.value;
        writePreference('packing_theme_mode', themeMode);
        syncTheme();
    });
    systemThemeQuery.addEventListener('change', () => {
        if (themeMode === 'system') syncTheme();
    });

    // G. 绑定智能配载数量计算器 (v2.0)
    document.getElementById('calc-qty-btn').addEventListener('click', solveCargoQuantities);

    // A minimum is a lower bound, so it can be combined with a ratio.
    for (const id of ['item-ratio', 'item-min-qty']) document.getElementById(id).disabled = false;

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
            openOverlay('about-modal');
            requestAnimationFrame(() => aboutCloseBtn?.focus());
        });
    }

    if (aboutCloseBtn && aboutModal) {
        aboutCloseBtn.addEventListener('click', () => {
            closeOverlay('about-modal');
        });
    }

    if (aboutModal) {
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                closeOverlay('about-modal');
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
            title: "欢迎来到 3D 智能装箱模拟器! <br>Welcome to 3D Packing Simulator!",
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
            desc: "配置好货物后，点击此按钮。系统会在后台比较装箱策略；计算中可取消，结果会检查边界、碰撞和支撑。<hr>Click here to trigger multi-core background parallel computation for a packing layout. The calculation can be cancelled."
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
        if (matchMedia('(max-width: 60rem)').matches && !document.body.classList.contains('config-open')) document.getElementById('config-toggle').click();
        closeOverlay('about-modal');
        openOverlay('tour-overlay');
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
        closeOverlay('tour-overlay');
        document.body.style.overflow = '';
        if (tourResizeHandler) {
            window.removeEventListener('resize', tourResizeHandler);
            tourResizeHandler = null;
        }
        if (completed) {
            writePreference('packing_simulator_tour_completed', 'true');
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
            highlightEl.style.boxShadow = '0 0 0 9999px var(--overlay-scrim)';
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
        highlightEl.style.boxShadow = '0 0 0 9999px var(--overlay-scrim)';
        
        // 计算提示气泡的最佳摆放坐标
        const tooltipWidth = Math.min(360, window.innerWidth - 32);
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
        tTop = Math.max(10, Math.min(tTop, window.innerHeight - tooltipEl.offsetHeight - 10));

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

    document.getElementById('cfg-stability').addEventListener('change', () => {
        invalidateAutoLayout();
        if (activeMode === 'manual') checkManualPlacementCollisions();
        updateStats();
    });
    document.getElementById('cfg-bigger-first').addEventListener('change', () => { invalidateAutoLayout(); updateStats(); });
    document.getElementById('tour-modes').addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const mode = event.key === 'Home' ? 'auto' : event.key === 'End' ? 'manual' : activeMode === 'auto' ? 'manual' : 'auto';
        switchMode(mode);
        document.getElementById('tab-' + mode).focus();
    });
    if (new URLSearchParams(location.search).get('mode') === 'manual') switchMode('manual');

    // 首次载入检测
    // The guide remains available in About; opening the app does not block the workbench.

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (packingController) { cancelPacking(); return; }
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

window.addEventListener('pagehide', () => {
    cancelPacking();
    stopAnimation();
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    PackingJobs.dispose();
});

window.addEventListener('pageshow', requestRender);
