'use strict';
const assert = require('node:assert/strict');

function randomCases(seed = 20261110) {
    let state = seed >>> 0;
    const random = () => { state = Math.imul(state, 1664525) + 1013904223 >>> 0; return state / 4294967296; };
    const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
    const cases = [];
    const add = (kind, bin, specs, expected) => {
        const items = specs.flatMap((spec, type) => Array.from({ length: spec.qty }, (_, index) => ({
            id: `${cases.length}_${type}_${index}`, name: type % 2 ? '同名产品' : '产品' + type,
            w: spec.dim[0], h: spec.dim[1], d: spec.dim[2], color: '#5682a3', weight: integer(0, 20) / 10
        })));
        const volume = items.reduce((sum, item) => sum + item.w * item.h * item.d, 0);
        const capacity = bin.reduce((a, b) => a * b);
        cases.push({ id: `${kind}-${cases.length}`, kind, bin, items, expected, volumeRelation: Math.abs(volume - capacity) < 0.001 ? 'equal' : volume < capacity ? 'less' : 'greater' });
    };
    for (let group = 0; group < 8; group++) {
        const bin = [integer(16, 40), integer(16, 40), integer(16, 40)];
        add('smaller-dimensions', bin, [{ dim: bin.map(v => integer(1, v - 1)), qty: 1 }], 1);
        add('exact-dimensions', bin, [{ dim: [bin[2], bin[0], bin[1]], qty: integer(1, 3) }], 1);
        add('oversized-dimensions', bin, [{ dim: [Math.max(...bin) + 0.01, 2, 3], qty: integer(1, 4) }], 0);
        const size = integer(5, 10), grid = [integer(2, 3), integer(2, 3), integer(2, 3)];
        const capacity = grid.reduce((a, b) => a * b);
        for (const [kind, qty] of [['below-capacity', capacity - integer(1, 3)], ['exact-capacity', capacity], ['above-capacity', capacity + integer(1, 8)]]) {
            add(kind, grid.map(v => v * size), [{ dim: [size, size, size], qty }], Math.min(qty, capacity));
        }
        add('mixed-quantities', bin, Array.from({ length: integer(2, 5) }, () => ({ dim: bin.map(v => integer(2, Math.floor(v * 0.7))), qty: integer(1, 5) })));
        add('mixed-oversized', bin, [
            { dim: [Math.max(...bin) + 1, 2, 2], qty: integer(1, 4) },
            { dim: [1, 1, 1], qty: integer(1, 5) }
        ]);
    }
    add('empty', [20, 20, 20], [], 0);
    add('volume-is-not-fit', [3, 3, 3], [{ dim: [2, 2, 2], qty: 2 }], 1);
    add('mixed-exact-capacity', [20, 20, 20], [{ dim: [10, 10, 20], qty: 2 }, { dim: [20, 10, 10], qty: 2 }], 4);
    add('near-boundary-oversized', [20, 20, 20], [{ dim: [20.01, 20, 20], qty: 1 }], 0);
    for (const qty of [12, 16]) add('preset-' + (33 + qty), [40, 50, 60], [
        { dim: [16, 8, 29], qty: 9 }, { dim: [13, 6, 29], qty: 24 }, { dim: [6, 6, 29], qty }
    ], 33 + qty);
    for (const qty of [128, 500, 1000]) add('large-quantity', [20, 20, 20], [{ dim: [5, 5, 5], qty }], 64);
    return cases;
}

// Independent checks: do not use the production overlap or support helpers as an oracle.
function checkResult(testCase, result) {
    const { items, bin } = testCase;
    assert.ok(Array.isArray(result.items) && Array.isArray(result.unpacked));
    const source = new Map(items.map(item => [item.id, item]));
    const seen = new Set();
    for (const item of [...result.items, ...result.unpacked]) {
        assert.ok(source.has(item.id), 'unknown item');
        assert.ok(!seen.has(item.id), 'duplicate item');
        seen.add(item.id);
        for (const key of ['w', 'h', 'd', 'name', 'color', 'weight']) assert.equal(item[key], source.get(item.id)[key], 'mutated ' + key);
    }
    assert.equal(seen.size, items.length, 'lost items');
    const packed = result.items;
    for (const item of packed) {
        assert.ok([item.x, item.y, item.z, item.rw, item.rh, item.rd].every(Number.isFinite));
        const original = [item.w, item.h, item.d].sort((a, b) => a - b);
        const rotated = [item.rw, item.rh, item.rd].sort((a, b) => a - b);
        assert.deepEqual(rotated, original, 'not a legal rotation');
        [item.x, item.y, item.z].forEach((v, i) => assert.ok(v >= -0.001 && v + [item.rw, item.rh, item.rd][i] <= bin[i] + 0.001, 'out of bounds'));
        let area = 0;
        for (const other of packed) {
            if (item === other) continue;
            const overlap = [Math.min(item.x + item.rw, other.x + other.rw) - Math.max(item.x, other.x),
                Math.min(item.y + item.rh, other.y + other.rh) - Math.max(item.y, other.y),
                Math.min(item.z + item.rd, other.z + other.rd) - Math.max(item.z, other.z)];
            assert.ok(!overlap.every(v => v > 0.001), 'overlapping cargo');
            if (Math.abs(other.y + other.rh - item.y) < 0.05) area += Math.max(0, overlap[0]) * Math.max(0, overlap[2]);
        }
        if (item.y > 0) assert.ok(area / (item.rw * item.rd) >= 0.5 - 0.001, 'unsupported cargo');
    }
    if (testCase.expected !== undefined) assert.equal(packed.length, testCase.expected, 'known capacity missed');
}
function geometryFingerprint(items) {
    return items.map(item => JSON.stringify([item.name, item.w, item.h, item.d, item.weight,
        item.x, item.y, item.z, item.rw, item.rh, item.rd])).sort().join('|');
}
module.exports = { randomCases, checkResult, geometryFingerprint };
