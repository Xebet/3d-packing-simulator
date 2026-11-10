'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cargo = require('../cargo.js');
const item = (id, extra = {}) => ({ id, name: id, l: 10, w: 10, h: 10, qty: 1, weight: 1, color: '#4e88b0', ratio: 1, minQty: 0, ...extra });
const bin = { l: 20, w: 20, h: 20, emptyWeight: 0, maxWeight: 4 };

test('numeric inputs preserve zero and reject blank, nonfinite and fractional quantities', () => {
    assert.equal(Cargo.number('0', 0, 10), 0);
    for (const value of ['', ' ', 'Infinity', '1.5', null, false]) assert.throws(() => Cargo.number(value, 0, 10, true));
});
test('inventory cap applies to the whole list, and rejects duplicate ids or injected colors', () => {
    assert.throws(() => Cargo.validateInventory([item('a', { qty: 600 }), item('b', { qty: 401 })]));
    assert.throws(() => Cargo.validateInventory([item('same'), item('same')]));
    assert.throws(() => Cargo.validateInventory([item('a', { color: '#ffffff; background: url(x)' })]));
});
test('allocation combines minimum quantities with a ratio, respects weight, and does not mutate input', () => {
    const inventory = [item('a', { minQty: 1 }), item('b')];
    const before = structuredClone(inventory);
    const quantities = Cargo.allocate(inventory, bin);
    assert.equal(quantities.reduce((sum, q) => sum + q, 0), 4);
    assert.ok(quantities[0] >= 1);
    assert.deepEqual(inventory, before);
});
test('allocation rejects impossible minimums and skips oversized ratio products', () => {
    assert.throws(() => Cargo.allocate([item('a', { minQty: 5 })], bin));
    assert.throws(() => Cargo.allocate([item('a', { l: 30, minQty: 1 })], bin));
    assert.deepEqual(Cargo.allocate([item('a', { l: 30 }), item('b')], bin), [0, 4]);
});
test('allocation caps tiny weightless cargo and does not exceed the safety volume', () => {
    const q = Cargo.allocate([item('a', { l: 0.01, w: 0.01, h: 0.01, weight: 0 })], bin);
    assert.deepEqual(q, [1000]);
    assert.deepEqual(Cargo.allocate([item('a', { weight: 0 })], bin), [6]);
});
