'use strict';

// A job owns its workers and timers. Aborting it cannot publish a stale layout.
const PackingJobs = {
    blobURL: null,
    createWorker() {
        if (!this.blobURL) {
            const source = `
                const EPS_OVERLAP = ${EPS_OVERLAP}, EPS_CONTACT = ${EPS_CONTACT}, EPS_STABILITY = ${EPS_STABILITY};
                const EPS_DIMENSION = ${EPS_DIMENSION}, DEFAULT_SUPPORT_RATIO = ${DEFAULT_SUPPORT_RATIO};
                const boxesOverlap = ${boxesOverlap.toString()};
                const Item = ${Item.toString()};
                const Packer = ${Packer.toString()};
                self.onmessage = ({data}) => {
                    try {
                        const items = data.items.map(it => new Item(it.id, it.name, it.w, it.h, it.d, it.color, it.weight));
                        const p = new Packer(...data.bin);
                        const result = data.layer
                            ? p.tryLayerBacktrackingPackWithPartitions(items, data.options.checkStability, data.options.supportRatio, data.start, data.end)
                            : p.runGreedyPackTrials(items, data.options, data.start, data.end - data.start);
                        self.postMessage({result});
                    } catch (error) { self.postMessage({error: error.message}); }
                };`;
            this.blobURL = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
        }
        return new Worker(this.blobURL);
    },
    async run(items, bin, options = {}, { signal, onProgress = () => {} } = {}) {
        const abortError = () => new DOMException('计算已取消', 'AbortError');
        const checkAbort = () => { if (signal?.aborted) throw abortError(); };
        checkAbort();
        const workers = new Set();
        const ids = new Map(items.map(item => [item.id, item]));
        if (ids.size !== items.length) throw new RangeError('Duplicate item ids');
        Packer.assertItems(items);
        const normalized = { checkStability: true, supportRatio: 0.5, biggerFirst: true, seed: 20260617, timeBudgetMs: 8000, ...options };
        let workerFailure = false;
        const hydrate = data => {
            if (!Array.isArray(data)) throw new TypeError('Invalid worker result');
            const seen = new Set();
            return data.map(raw => {
                const original = ids.get(raw.id);
                if (!original || seen.has(raw.id) || !Number.isInteger(raw.rotationType) || raw.rotationType < 0 || raw.rotationType > 5) {
                    throw new RangeError('Worker returned unknown or duplicate items');
                }
                seen.add(raw.id);
                const item = new Item(original.id, original.name, original.w, original.h, original.d, original.color, original.weight);
                item.setRotation(raw.rotationType);
                if ([item.rw - raw.rw, item.rh - raw.rh, item.rd - raw.rd].some(v => !Number.isFinite(v) || Math.abs(v) > 0.001)) throw new RangeError('Invalid worker dimensions');
                item.x = raw.x; item.y = raw.y; item.z = raw.z;
                return item;
            });
        };
        const task = data => new Promise((resolve, reject) => {
            let worker, timer, done = false;
            const finish = (error, result) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                worker?.terminate();
                workers.delete(worker);
                error ? reject(error) : resolve(result);
            };
            const abort = () => finish(abortError());
            try {
                checkAbort();
                worker = this.createWorker();
                workers.add(worker);
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => finish(new Error('后台计算超时，请减少数量后重试')), 15000);
                worker.onerror = () => finish(new Error('后台计算失败，请重试'));
                worker.onmessageerror = () => finish(new Error('后台计算结果无法读取'));
                worker.onmessage = ({ data: reply }) => finish(reply.error ? new Error(reply.error) : null, reply.result);
                worker.postMessage({ ...data, items, bin, options: normalized });
            } catch (error) { finish(error); }
        });
        const accept = data => {
            const packed = hydrate(data);
            const validation = Packer.validatePackingResult(packed, ...bin, normalized.checkStability, normalized.supportRatio);
            if (!validation.valid) throw new RangeError('后台返回了无效布局');
            return packed;
        };
        const cores = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 2) - 1));
        try {
            if (!items.length) return { items: [], unpacked: [] };
            if (typeof Worker !== 'undefined') {
                onProgress(0, '正在搜索分层布局');
                const partitionStep = Math.ceil(30 / cores);
                const layers = await Promise.allSettled(Array.from({ length: cores }, (_, i) => task({ layer: true, start: i * partitionStep, end: Math.min(30, (i + 1) * partitionStep) })));
                checkAbort();
                for (const reply of layers) {
                    if (reply.status === 'fulfilled' && reply.value) {
                        try {
                            const packed = accept(reply.value);
                            if (packed.length === items.length) { onProgress(100, '布局校验完成'); return { items: packed, unpacked: [] }; }
                        } catch { workerFailure = true; }
                    } else if (reply.status === 'rejected') workerFailure = true;
                }
                let completed = 0;
                onProgress(25, '正在比较装箱策略');
                const perWorker = items.length > 200 ? 4 : 12;
                const trials = await Promise.allSettled(Array.from({ length: cores }, (_, i) => task({ start: i * perWorker, end: (i + 1) * perWorker }).finally(() => {
                    if (!signal?.aborted) onProgress(25 + Math.round(++completed / cores * 70), '正在比较装箱策略');
                })));
                checkAbort();
                let best = null;
                for (const reply of trials) {
                    if (reply.status !== 'fulfilled') { workerFailure = true; continue; }
                    try {
                        const packed = accept(reply.value.items);
                        const score = reply.value.score;
                        if (!Number.isFinite(score)) continue;
                        if (!best || packed.length > best.items.length || (packed.length === best.items.length && score > best.score)) best = { items: packed, score };
                    } catch { workerFailure = true; }
                }
                if (best) {
                    const packedIds = new Set(best.items.map(item => item.id));
                    onProgress(100, '布局校验完成');
                    return { items: best.items, unpacked: items.filter(item => !packedIds.has(item.id)), degraded: workerFailure };
                }
            }
            // shortcut: workerless browsers run two bounded trials; enable Workers for deeper search.
            onProgress(30, '后台线程不可用，正在运行基础策略');
            let best = null;
            for (let trial = 0; trial < 2; trial++) {
                await new Promise(resolve => setTimeout(resolve, 0));
                checkAbort();
                const result = new Packer(...bin).runGreedyPackTrials(items, { ...normalized, timeBudgetMs: 100 }, trial, 1);
                if (!best || result.items.length > best.items.length) best = result;
            }
            checkAbort();
            if (!best || !Number.isFinite(best.score)) throw new Error('装箱计算失败，请减少数量后重试');
            onProgress(100, '基础布局校验完成');
            return { ...best, degraded: true };
        } finally {
            workers.forEach(worker => worker.terminate());
        }
    },
    dispose() {
        if (this.blobURL) URL.revokeObjectURL(this.blobURL);
        this.blobURL = null;
    }
};

if (typeof module !== 'undefined') module.exports = PackingJobs;
