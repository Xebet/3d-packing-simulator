# 3D Packing Simulator & Interactive Layout System
# 3D 智能装箱模拟器与交互式排布系统

A high-performance, responsive 3D bin packing visualization system built using Three.js and parallel multi-core Web Workers. It runs 100% client-side, offline, and is ready for cloud deployment via GitHub Pages.

这是一个基于 Three.js 和多核并行 Web Workers 的高性能、响应式 3D 智能装箱排布与可视化系统。系统采用 100% 纯前端架构，支持离线运行，并完美兼容 GitHub Pages 静态托管发布。

---

## 🌐 Live Demo / 在线演示
* **GitHub Pages**: [https://Xebet.github.io/3d-packing-simulator/](https://Xebet.github.io/3d-packing-simulator/)

---

## ⚡ Key Features / 核心特性

### 1. Multi-Core Asynchronous Parallel Packer (多核异步并行装箱)
* **Background Workers**: Calculation is offloaded to background `Web Workers` spawned dynamically according to `navigator.hardwareConcurrency` (up to 8 threads).
* **Fully Responsive UI**: The main browser thread remains 100% responsive (no lag, no "Page not responding" warnings) during deep calculations.
* **CPU Maximization**: Utilizes multi-core CPUs to run parallel greedy packing trials and layer partitions simultaneously.
* **后台并发计算**：根据用户 CPU 线程数动态编译并启动多个后台 Web Workers 进行计算，避免主线程卡死，彻底杜绝浏览器“页面无响应”弹窗。
* **高响应性交互**：在深度计算期间，3D 视口可自由旋转拖拽，进度条与 Spinner 提供实时动画反馈。

### 2. High-Performance Packing Engine (高性能装箱算法)
* **Layer Backtracking Solver (分层回溯求解)**: Slices the container along shared dimension axes to solve as a 2D grid using DFS backtracking. Perfect for highly-constrained scenarios (e.g. perfectly packing the extreme 49-item set).
* **Multi-Start Heuristics (多起点贪心试错)**: Evaluates placements using contact area maximization and height-depth lexicographical scoring to minimize centers of gravity and reduce voids.
* **物理重力支撑校验 (Gravity & Stability)**: Real-time 3D bottom support ratio validation (requiring at least 50% surface contact) ensures physically stable堆叠.
* **分层回溯求解器**：自动分析公维特征，将 3D 降维为 2D 片层，使用带稳定限制的深度优先搜索（DFS）回溯，解决传统贪心算法易漏装的极限难题。
* **多策略贪心试错**：结合空间接触面积最大化及词典序高度深度评分，强力压低重心、消灭空洞。

### 3. Dual-Mode Interactive 3D Workspace (双模式交互式 3D 工作区)
* **Auto Mode**: Renders the optimal layout automatically and provides a step-by-step playback controller (Timeline Slider).
* **Manual Mode**: Drag-and-drop items manually using standard 3D Transform Controls (Gizmos). Features auto snap-to-grid (1cm), gravity drop drop helper, and real-time collision detection (highlighting overlapping boxes in red).
* **自动模式**：一键计算完成自动装箱，提供时间轴控制器进行步骤动画分步演示。
* **手动模式**：双击选择物体，通过 3D 拖拽手柄（Gizmo）自由移动。支持 1cm 自动网格吸附、一键重力落底以及红光碰撞/溢出边界警示。

### 4. Rich Themes & WCAG Accessibility (丰富主题与无障碍兼容)
* Supports seamless Day/Night theme toggles.
* High color contrast ratios optimized for light and dark environments (perfect contrast on panels, buttons, and alert modals).
* 支持一键切换日夜间护眼模式。
* 针对日间模式进行了高对比度优化，符合无障碍阅读设计规范，色彩和谐精美。

---

## 📂 Project Architecture / 项目结构

* `index.html`: The UI skeleton and layout.
* `style.css`: Modern visual styles, animations, responsive glassmorphism panels, and themes.
* `packer.js`: Core algorithmic module including `Item`, `Packer`, and 2D backtracking solver.
* `app.js`: Application controller. Manages Three.js WebGL scene, UI event handlers, and multi-core Worker orchestration.
* `test_suite.html`: Integrated headless-ready browser unit and integration test runner.

---

## 🛠️ Installation & Usage / 安装与使用

### Local Offline Usage (本地离线使用)
No installation required! Since it has no backend dependencies, simply clone or download the files and double-click `index.html` to run.
无需任何环境安装！直接下载项目文件，双击打开 `index.html` 即可运行。
```bash
git clone https://github.com/Xebet/3d-packing-simulator.git
cd 3d-packing-simulator
# Double click index.html to run / 双击 index.html 直接运行
```

### Run Tests (运行集成测试)
Open `test_suite.html` in any browser to execute the automated packing test suite.
在浏览器中打开 `test_suite.html` 即可自动执行算法正确性及极限测试。

---

## 📖 Core Algorithmic Details / 算法剖析

### Volumetric Weight Formula (泡货与计费重公式)
The application automatically calculates the volumetric (dimensional) weight and compares it against actual weight:
$$\text{Dimensional Weight (kg)} = \frac{L(\text{cm}) \times W(\text{cm}) \times H(\text{cm})}{\text{Volumetric Divisor}}$$
If the dimensional weight is greater than the actual weight, the system highlights it to warn you of volume-based carrier billing.

### Stability Check (支撑校验)
For any placed item $i$ at height $y > 0$, the ratio of the supported surface area is calculated by checking overlap with items directly underneath:
$$\text{Support Ratio} = \frac{\sum \text{Area}(\text{Overlap with bottom items})}{\text{Base Area of Item } i} \ge 0.5$$

---

## 📜 License / 开源协议
This project is open-source and available under the [MIT License](LICENSE).
本项目遵循 MIT 开源协议。
