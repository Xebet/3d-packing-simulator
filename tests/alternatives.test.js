'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('./helpers/worker-runtime.cjs');
const { checkResult } = require('./helpers/random-cases.cjs');

test('exploration changes real geometry, preserves cargo and returns valid alternative layouts', async () => {
    const { Item, Packer, jobs } = runtime();
    const items = Array.from({ length: 6 }, (_, i) => new Item(String(i), 'Cube', 2, 2, 2));
    const bin = [8, 8, 8];
    let result = await jobs.run(items, bin);
    const signatures = new Set([Packer.layoutSignature(result.items)]);
    for (const seed of [41, 42, 43]) {
        const previous = Packer.layoutSignature(result.items);
        result = await jobs.run(items, bin, { seed, explore: true, excludeSignature: previous, timeBudgetMs: 500 });
        assert.equal(result.noAlternative, undefined);
        checkResult({ items, bin, expected: 6 }, result);
        assert.notEqual(Packer.layoutSignature(result.items), previous);
        signatures.add(Packer.layoutSignature(result.items));
    }
    assert.ok(signatures.size >= 2);
});

test('a unique exact-fit layout is reported honestly rather than relabeling identical boxes', async () => {
    const { Item, Packer, jobs } = runtime();
    const items = [new Item('one', 'One', 4, 4, 4)];
    const result = await jobs.run(items, [4, 4, 4]);
    const alternative = await jobs.run(items, [4, 4, 4], { seed: 23, explore: true, excludeSignature: Packer.layoutSignature(result.items) });
    assert.equal(alternative.noAlternative, true);
});

test('layout identity ignores ordering and ids for identical cargo, and quality compares count before volume', () => {
    const { Item, Packer } = runtime();
    const a = new Item('a', 'A', 1, 1, 1);
    const b = new Item('b', 'A', 1, 1, 1); b.x = 1;
    assert.equal(Packer.layoutSignature([a, b]), Packer.layoutSignature([{ ...b, id: 'other' }, { ...a, id: 'new' }]));
    assert.ok(Packer.comparePackings([a, b], [new Item('big', 'B', 100, 100, 100)]) > 0);
    const almost = { ...a, rw: 1 + 1e-12 };
    assert.equal(Packer.comparePackings([a], [almost]), 0);
});
