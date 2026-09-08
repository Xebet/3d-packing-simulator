# 3D Packing Simulator & Interactive Layout System

[简体中文](README_ZH.md) | English

A high-performance, responsive 3D bin packing visualization system built using Three.js and parallel multi-core Web Workers. It runs 100% client-side, keeps its runtime dependencies in the repository for offline use, and is ready for cloud deployment via GitHub Pages.

---

## 🌐 Live Demo
* **GitHub Pages**: [https://Xebet.github.io/3d-packing-simulator/](https://Xebet.github.io/3d-packing-simulator/)

---

## ⚡ Key Features

### 1. Multi-Core Asynchronous Parallel Packer
* **Background Workers**: Calculation is offloaded to background `Web Workers` spawned dynamically according to `navigator.hardwareConcurrency` (up to 8 threads).
* **Fully Responsive UI**: The main browser thread remains 100% responsive (no lag, no "Page not responding" warnings) during deep calculations.
* **CPU Maximization**: Utilizes multi-core CPUs to run parallel greedy packing trials and layer partitions simultaneously.

### 2. High-Performance Packing Engine
* **Layer Backtracking Solver (DFS)**: Slices the container along shared dimension axes to solve as a 2D grid using DFS backtracking. Perfect for highly-constrained scenarios (e.g. perfectly packing the extreme 49-item set).
* **Multi-Start Heuristics**: Evaluates placements using contact area maximization and height-depth lexicographical scoring to minimize centers of gravity and reduce voids.
* **Stability Check**: Real-time 3D bottom support ratio validation (requiring at least 50% surface contact) ensures physically stable stacking.

### 3. Dual-Mode Interactive 3D Workspace
* **Auto Mode**: Renders the optimal layout automatically and provides a step-by-step playback controller (Timeline Slider).
* **Manual Mode**: Drag-and-drop items manually using standard 3D Transform Controls (Gizmos). Features auto snap-to-grid (1cm), gravity drop helper, and real-time collision detection (highlighting overlapping boxes in red).

### 4. Rich Themes & WCAG Accessibility
* Supports seamless Day/Night theme toggles.
* High color contrast ratios optimized for light and dark environments (perfect contrast on panels, buttons, and alert modals).

---

## 📂 Project Architecture

* `index.html`: The UI skeleton and layout.
* `style.css`: Modern visual styles, animations, responsive glassmorphism panels, and themes.
* `packer.js`: Core algorithmic module including `Item`, `Packer`, and 2D backtracking solver.
* `app.js`: Application controller. Manages Three.js WebGL scene, UI event handlers, and multi-core Worker orchestration.
* `test_suite.html`: Integrated headless-ready browser unit and integration test runner.
* `tests/`: Node.js regression tests for the packing engine.
* `vendor/`: Pinned Three.js runtime and controls used by the offline application.
* `.github/workflows/test.yml`: Automated syntax and algorithm checks.

---

## 🛠️ Installation & Usage

### Local Offline Usage
No installation required! Since it has no backend dependencies, simply clone or download the files and double-click `index.html` to run.
```bash
git clone https://github.com/Xebet/3d-packing-simulator.git
cd 3d-packing-simulator
# Double click index.html to run
```

### Run Tests
Open `test_suite.html` in any browser to execute the visual test suite, or use Node.js 20+ for CI-friendly regression tests:

```bash
npm test
npm run check
```

---

## 📖 Core Algorithmic Details

### Volumetric Weight Formula
The application automatically calculates the volumetric (dimensional) weight and compares it against actual weight:
$$\text{Dimensional Weight (kg)} = \frac{L(\text{cm}) \times W(\text{cm}) \times H(\text{cm})}{\text{Volumetric Divisor}}$$
If the dimensional weight is greater than the actual weight, the system highlights it to warn you of volume-based carrier billing.

### Stability Check
For any placed item $i$ at height $y > 0$, the ratio of the supported surface area is calculated by checking overlap with items directly underneath:
$$\text{Support Ratio} = \frac{\sum \text{Area}(\text{Overlap with bottom items})}{\text{Base Area of Item } i} \ge 0.5$$

---

## 📜 License
This project is open-source and available under the [MIT License](LICENSE).
