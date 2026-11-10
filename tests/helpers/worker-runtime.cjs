'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker: Thread } = require('node:worker_threads');

// Execute the actual generated browser worker source on Node threads, without WebGL or mocks.
module.exports = function workerRuntime(root = path.resolve(__dirname, '../..')) {
    const context = vm.createContext({ module: { exports: {} }, performance, DOMException, setTimeout, clearTimeout,
        navigator: { hardwareConcurrency: 5 },
        Blob: class { constructor(parts) { this.source = parts.join(''); } },
        URL: { createObjectURL: blob => blob.source, revokeObjectURL() {} },
        Worker: class {
            constructor(source) {
                this.thread = new Thread(`const { parentPort } = require('node:worker_threads');
                    const self = { postMessage: data => parentPort.postMessage(data) };
                    ${source}
                    parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
                this.thread.on('message', data => this.onmessage?.({ data }));
                this.thread.on('error', error => this.onerror?.(error));
            }
            postMessage(data) { this.thread.postMessage(data); }
            terminate() { this.thread.terminate(); }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'packer.js'), 'utf8'), context);
    const { Item, Packer } = context.module.exports;
    vm.runInContext(fs.readFileSync(path.join(root, 'packing-jobs.js'), 'utf8'), context);
    return { Item, Packer, jobs: context.module.exports };
};
