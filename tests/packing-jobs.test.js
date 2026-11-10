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
    const context = { Item, Packer, Worker, navigator: { hardwareConcurrency: 3 }, module: { exports: {} }, AbortController, DOMException, setTimeout, clearTimeout, performance };
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
