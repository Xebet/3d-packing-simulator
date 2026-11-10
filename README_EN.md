# 3D Packing Simulator & Interactive Layout System

[简体中文](README.md) | **English**

A high-performance, responsive 3D bin packing visualization system built using Three.js and parallel multi-core Web Workers. It runs 100% client-side, keeps its runtime dependencies in the repository for offline use, and is ready for cloud deployment via GitHub Pages.

---

## 🌐 Live Demo
* **GitHub Pages**: [https://Xebet.github.io/3d-packing-simulator/](https://Xebet.github.io/3d-packing-simulator/)

---

## ⚡ Key Features

### 1. Multi-Core Asynchronous Parallel Packer
* **Background Workers**: Calculation is offloaded to background `Web Workers` spawned dynamically according to `navigator.hardwareConcurrency` (up to 8 workers, leaving a logical core available for the browser).
* **Fully Responsive UI**: Search runs in cancellable background jobs. Worker creation failures use two short, time-limited main-thread trials; search depth can be lower in that mode.
* **CPU Maximization**: Utilizes multi-core CPUs to run greedy strategies in parallel after a bounded layer-search phase.

### 2. High-Performance Packing Engine
* **Layer Backtracking Solver (DFS)**: Slices the container along shared dimension axes to solve as a 2D grid using DFS backtracking. Perfect for highly-constrained scenarios (e.g. perfectly packing the extreme 49-item set).
* **Multi-Start Heuristics**: Evaluates placements using contact area maximization and height-depth lexicographical scoring to minimize centers of gravity and reduce voids.
* **Stability Check**: A geometric bottom-support check requires at least 50% surface contact; it does not certify load-bearing or transport stability.

### 3. Dual-Mode Interactive 3D Workspace
* **Auto Mode**: Renders the computed layout automatically and provides a step-by-step playback controller (Timeline Slider).
* **Manual Mode**: Drag-and-drop items manually using standard 3D Transform Controls (Gizmos). Features auto snap-to-grid (1cm), gravity drop helper, and real-time collision detection (highlighting overlapping boxes in red).

### 4. Workbench & Accessibility
* Follows the system theme by default and updates live. Choose Light, Dark, or System from the theme selector; the choice survives reloads.
* Responsive configuration disclosure, visible keyboard focus, keyboard tabs, modal focus containment, and reduced-motion support.
* Auto/manual layouts survive mode switches. Product deletion and manual removal offer Undo for 10 seconds.

---

## 📂 Project Architecture

* `index.html`: The UI skeleton and layout.
* `style.css`: Modern visual styles, animations, responsive workbench layout.
* `cargo.js`: Pure inventory validation and weight/volume quantity allocation.
* `packing-jobs.js`: Cancellable worker jobs, bounded fallback, and result validation.
* `theme.js`: Applies the theme preference before the first paint, following the system by default.
* `tokens.css` / `base.css`: Offline light/dark design tokens and shared accessible defaults.
* `packer.js`: Core algorithmic module including `Item`, `Packer`, and 2D backtracking solver.
* `app.js`: Application controller. Manages the Three.js scene, input validation, focus, and UI lifecycle.
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

## Explore another layout

After calculating, use the alternative-layout button below the main calculation button to explore another packing order, orientation, and layer partition with a different seed. The page compares packed count, volume, and stack height. The restore-best button restores the best result found for the current inputs.

A different layout is not necessarily better. The best candidate ranks by packed count, then volume, then lower stack height. If the current constraints admit no new layout within the search budget, the existing layout stays visible. Editing the inputs resets the saved best result.

## Randomized testing

`npm run test:random` runs 219 dimension/quantity combinations across three fixed seeds and 72 alternative searches using the production worker source on real Node threads. It independently checks bounds, overlap, support, legal rotation, and item conservation. Some exact-fill fixtures have known capacity; general random cases do not claim a proven optimum.

Set `PACKING_TEST_SEED` to reproduce one input set and `PACKING_TEST_REPORT` to write a JSON report. CI runs these checks and uploads `randomized-packing-report`.

See [the randomized test and performance report](docs/randomized-testing.md) (Chinese).

## Browser verification

With Chrome and a local or global installation of `puppeteer-core`, run `npm run test:browser`. Set `CHROME_PATH` when Chrome is not in its usual location; `PUPPETEER_ROOT` can point to an existing package root. The app itself still needs no installation.

## Limits and privacy

- Packing is a heuristic search, not a proof of a global optimum. The full inventory is capped at 1,000 items.
- Layer search applies to at most 128 items and 64 layers, with node and time limits. Larger inputs use the greedy search. Each worker is terminated after 15 seconds.
- Quantity allocation uses a 75% volume estimate plus the configured weight limit, then runs the 3D solver. Geometric packing itself does not remove overweight cargo; the workspace labels excess weight.
- A 50% overlap threshold is a geometric support rule, not a structural or load-bearing certification.
- No remote runtime requests are needed. The page CSP blocks network connections, inline scripts, embedded objects, and form submissions. Inline styles remain enabled for the live 3D controls.
- Only theme and guide preferences use local storage; inventory/layouts remain in the current tab. There is no server or account storage.

See [the optimization and review record](docs/optimization-review.md) (Chinese) for verified changes and remaining limits.

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
