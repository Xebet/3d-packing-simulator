'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Item, Packer } = require('../packer.js');

function setup(respond) {
    const calls = [], workers = [];
    class Worker {
        constructor() { this.terminated = false; workers.push(this); }
        postMessage(data) { calls.push(data); queueMicrotask(() => respond?.(this, data)); }
        terminate() { this.terminated = true; }
    }
    const context = { Item, Packer, EPS_OVERLAP: 0.001, Worker, navigator: { hardwareConcurrency: 3 }, module: { exports: {} }, AbortController, DOMException, setTimeout, clearTimeout, performance };
    vm.runInNewContext(fs.readFileSync(require.resolve('../packing-jobs.js'), 'utf8'), context);
    const jobs = context.module.exports;
    jobs.createWorker = () => new context.Worker();
    return { jobs, workers, calls, context };
}
const items = () => [new Item('a', 'A', 2, 2, 2), new Item('b', 'B', 2, 2, 2)];

test('forwards options in both worker phases and computes unpacked ids from trusted input', async () => {
    const { jobs, calls, workers } = setup((worker, data) => {
        if (data.layer) worker.onmessage({ data: { result: null } });
        else {
            const result = new Packer(...data.bin).runGreedyPackTrials(data.items, data.options, 0, 1);
            result.unpacked = [{ id: 'forged' }];
            worker.onmessage({ data: { result } });
        }
    });
    const result = await jobs.run(items(), [4, 4, 4], { biggerFirst: false });
    assert.equal(result.items.length, 2);
    assert.equal(result.unpacked.length, 0);
    assert.ok(calls.some(call => call.layer));
    assert.ok(calls.some(call => !call.layer));
    assert.ok(calls.every(call => call.options.biggerFirst === false));
    assert.ok(workers.every(worker => worker.terminated));
});
test('abort rejects promptly, terminates all workers and ignores late results', async () => {
    const { jobs, workers } = setup();
    const controller = new AbortController();
    const pending = jobs.run(items(), [4, 4, 4], {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(workers.every(worker => worker.terminated));
    for (const worker of workers) worker.onmessage?.({ data: { result: [] } });
});
test('worker creation errors fall back to bounded trials and return a validated result', async () => {
    const { jobs } = setup();
    jobs.createWorker = () => { throw new Error('Worker blocked'); };
    const result = await jobs.run(items(), [4, 4, 4]);
    assert.equal(result.items.length, 2);
    assert.equal(result.degraded, true);
    assert.equal(Packer.validatePackingResult(result.items, 4, 4, 4).valid, true);
});
test('malformed or duplicated worker geometry cannot enter the result', async () => {
    const { jobs } = setup((worker, data) => {
        const bad = { ...data.items[0], x: NaN, rotationType: 0 };
        worker.onmessage({ data: { result: data.layer ? [bad, bad] : { items: [bad, bad], score: 1e20 } } });
    });
    const result = await jobs.run(items(), [4, 4, 4]);
    assert.equal(result.degraded, true);
    assert.equal(result.items.length, 2);
    assert.equal(Packer.validatePackingResult(result.items, 4, 4, 4).valid, true);
});

test('worker timeouts release resources and fall back instead of hanging the job', async () => {
    const { jobs, workers, context } = setup();
    context.setTimeout = (fn, ms) => setTimeout(fn, ms === 15000 ? 5 : ms);
    const result = await jobs.run(items(), [4, 4, 4]);
    assert.equal(result.items.length, 2);
    assert.equal(result.degraded, true);
    assert.ok(workers.every(worker => worker.terminated));
});

test('first validated complete result returns without waiting for a stuck losing worker', async () => {
    const { jobs, workers, context } = setup((worker, data) => {
        if (workers.indexOf(worker) !== 0) return;
        const result = new Packer(...data.bin).runGreedyPackTrials(data.items, data.options, 0, 1);
        worker.onmessage({ data: { result: result.items } });
    });
    const timers = new Set();
    context.setTimeout = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; };
    context.clearTimeout = timer => { timers.delete(timer); clearTimeout(timer); };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 200);
    try {
        const result = await jobs.run(items(), [4, 4, 4], {}, { signal: controller.signal });
        assert.equal(result.items.length, 2);
        assert.ok(workers.every(worker => worker.terminated));
        assert.equal(timers.size, 0);
    } finally { clearTimeout(timeout); }
});

test('oversized items are left unpacked without preventing fitting cargo or starting pointless jobs', async () => {
    const { jobs, calls } = setup();
    const huge = new Item('huge', 'Huge', 5, 5, 5);
    const result = await jobs.run([huge], [4, 4, 4]);
    assert.equal(result.items.length, 0);
    assert.equal(result.unpacked[0].id, huge.id);
    assert.equal(calls.length, 0);
});

test('small layer tasks are dynamically assigned without exceeding the worker limit', async () => {
    const { jobs, workers, calls } = setup((worker, data) => {
        setTimeout(() => {
            const result = data.layer ? null : new Packer(...data.bin).runGreedyPackTrials(data.items, data.options, 0, 1);
            worker.onmessage({ data: { result } });
        }, 1);
    });
    let activeMaximum = 0;
    const create = jobs.createWorker;
    jobs.createWorker = () => {
        const worker = create();
        activeMaximum = Math.max(activeMaximum, workers.filter(worker => !worker.terminated).length);
        return worker;
    };
    await jobs.run(items(), [4, 4, 4]);
    assert.equal(calls.filter(call => call.layer).length, 8);
    assert.ok(activeMaximum <= 2);
    assert.ok(workers.every(worker => worker.terminated));
});
