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

test('offline application blocks remote requests, inline scripts and embedded objects', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /script-src 'self'/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.doesNotMatch(html, /\son\w+\s*=/i);
    assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
});

test('repository includes project and third-party license files', () => {
    assert.equal(fs.existsSync(path.join(root, 'LICENSE')), true);
    assert.equal(fs.existsSync(path.join(root, 'vendor', 'THREE-LICENSE.txt')), true);
});
