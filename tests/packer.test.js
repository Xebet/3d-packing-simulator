'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boxesOverlap, Item, Packer } = require('../packer.js');

test('rejects invalid item and container dimensions', () => {
    assert.throws(() => new Item('bad', 'Bad', 0, 1, 1), RangeError);
    assert.throws(() => new Item('bad', 'Bad', 1, -1, 1), RangeError);
    assert.throws(() => new Packer(1, Number.NaN, 1), RangeError);
});

test('packs same-name items with different dimensions without overlap', () => {
    const items = [
        new Item('same-1', 'Same', 2, 2, 2),
        new Item('same-2', 'Same', 3, 2, 2)
    ];
    const packer = new Packer(4, 4, 2);
    packer.pack(items, { checkStability: false });

    const validation = Packer.validatePackingResult(packer.items, 4, 4, 2, false);
    assert.equal(packer.items.length, 2);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('support index checks adjacent tolerance buckets', () => {
    const index = Packer.createSupportIndex();
    const support = new Item('support', 'Support', 1, 10.024, 1);
    index.add(support);

    assert.deepEqual(index.get(10.026).map(item => item.id), ['support']);
    assert.equal(index.get(10.2).length, 0);
});

test('gravity drop ignores projected items above the current item', () => {
    const candidate = new Item('candidate', 'Candidate', 2, 2, 2);
    candidate.y = 5;
    const above = new Item('above', 'Above', 2, 2, 2);
    above.y = 10;

    assert.equal(Packer.getGravityDropY(candidate, [above], 20, { maxLandingY: candidate.y }), 0);
});

test('boxesOverlap treats adjacent boxes as non-overlapping', () => {
    const a = { x: 0, y: 0, z: 0, w: 2, h: 2, d: 2 };
    const b = { x: 2, y: 0, z: 0, w: 2, h: 2, d: 2 };
    const c = { x: 1, y: 0, z: 0, w: 2, h: 2, d: 2 };
    assert.equal(boxesOverlap(a, b), false);
    assert.equal(boxesOverlap(a, c), true);
});

test('seeded greedy trials are deterministic', () => {
    const makeItems = () => [
        new Item('a', 'A', 9, 7, 5),
        new Item('b', 'B', 8, 6, 4),
        new Item('c', 'C', 7, 5, 3),
        new Item('d', 'D', 6, 4, 2)
    ];
    const first = new Packer(20, 20, 20).runGreedyPackTrials(makeItems(), { seed: 42 }, 20, 3);
    const second = new Packer(20, 20, 20).runGreedyPackTrials(makeItems(), { seed: 42 }, 20, 3);
    const project = result => result.items.map(item => [item.id, item.x, item.y, item.z, item.rotationType]);
    assert.deepEqual(project(first), project(second));
});

test('representative 49-item layout remains valid', () => {
    const items = [];
    for (let i = 0; i < 9; i++) items.push(new Item(`A_${i}`, 'A', 16, 8, 29));
    for (let i = 0; i < 24; i++) items.push(new Item(`B_${i}`, 'B', 13, 6, 29));
    for (let i = 0; i < 16; i++) items.push(new Item(`C_${i}`, 'C', 6, 6, 29));

    const packer = new Packer(40, 50, 60);
    packer.pack(items, { checkStability: true, supportRatio: 0.5 });
    const validation = Packer.validatePackingResult(packer.items, 40, 50, 60, true, 0.5);
    assert.equal(packer.items.length, 49);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});
