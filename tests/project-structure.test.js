'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('offline runtime dependencies are present and referenced locally', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const asset of ['three.min.js', 'OrbitControls.js', 'TransformControls.js']) {
        assert.equal(fs.existsSync(path.join(root, 'vendor', asset)), true, `${asset} is missing`);
        assert.match(html, new RegExp(`\\./vendor/${asset.replace('.', '\\.')}\\b`));
    }
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i);
});

test('worker jobs receive the biggerFirst option in both strategies', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const forwardedOptions = app.match(/options:\s*\{\s*checkStability,\s*supportRatio,\s*biggerFirst/g) || [];
    assert.equal(forwardedOptions.length, 2);
});

test('repository includes project and third-party license files', () => {
    assert.equal(fs.existsSync(path.join(root, 'LICENSE')), true);
    assert.equal(fs.existsSync(path.join(root, 'vendor', 'THREE-LICENSE.txt')), true);
});
