'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = require('./helpers/worker-runtime.cjs')();
const { randomCases, checkResult, geometryFingerprint } = require('./helpers/random-cases.cjs');

async function main() {
    const seeds = process.env.PACKING_TEST_SEED ? [Number(process.env.PACKING_TEST_SEED)] : [20261110, 20261111, 20261112];
    const rows = [];
    const variations = [];
    const searchBudget = process.env.CI ? 1500 : 400;
    for (const seed of seeds) {
        for (const testCase of randomCases(seed)) {
            const input = testCase.items.map(item => new runtime.Item(item.id, item.name, item.w, item.h, item.d, item.color, item.weight));
            const original = input.map(item => [item.id, item.name, item.w, item.h, item.d, item.weight, item.x, item.y, item.z, item.rotationType]);
            const start = performance.now();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), process.env.CI ? 10000 : 3000);
            let result, error;
            try {
                result = await runtime.jobs.run(input, testCase.bin, { seed, timeBudgetMs: searchBudget }, { signal: controller.signal });
                checkResult(testCase, result);
                assert.deepEqual(input.map(item => [item.id, item.name, item.w, item.h, item.d, item.weight, item.x, item.y, item.z, item.rotationType]), original, 'input was mutated');
            } catch (caught) { error = caught.message; }
            finally { clearTimeout(timer); }
            rows.push({ seed, id: testCase.id, kind: testCase.kind, volumeRelation: testCase.volumeRelation, count: input.length,
                packed: result?.items.length, expected: testCase.expected, elapsedMs: Math.round(performance.now() - start), error });
            console.log((error ? 'FAIL' : 'PASS') + ' ' + testCase.id + ' ' + rows.at(-1).elapsedMs + 'ms' + (error ? ' ' + error : ''));
            if (!error && testCase.kind === 'mixed-quantities') {
                let current = result;
                const bestInitial = runtime.Packer.packingMetrics(current.items);
                let best = current;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const began = performance.now();
                    const guard = new AbortController();
                    const timeout = setTimeout(() => guard.abort(), process.env.CI ? 10000 : 3000);
                    let alternative, failure;
                    try {
                        alternative = await runtime.jobs.run(input, testCase.bin, { explore: true, seed: seed + attempt,
                            timeBudgetMs: searchBudget, excludeSignature: runtime.Packer.layoutSignature(current.items) }, { signal: guard.signal });
                        if (!alternative.noAlternative) {
                            checkResult(testCase, alternative);
                            assert.notEqual(geometryFingerprint(alternative.items), geometryFingerprint(current.items), 'alternative only changes ids');
                            current = alternative;
                            if (runtime.Packer.comparePackings(current.items, best.items) > 0) best = current;
                        }
                    } catch (caught) { failure = caught.message; }
                    finally { clearTimeout(timeout); }
                    variations.push({ seed, id: testCase.id, attempt, elapsedMs: Math.round(performance.now() - began),
                        noAlternative: Boolean(alternative?.noAlternative), before: bestInitial, best: runtime.Packer.packingMetrics(best.items), error: failure });
                }
            }
        }
    }
    const report = { seeds, cases: rows.length, passed: rows.filter(row => !row.error).length, failed: rows.filter(row => row.error),
        variations, variantFailures: variations.filter(row => row.error), rows };
    if (process.env.PACKING_TEST_REPORT) {
        const target = path.resolve(process.env.PACKING_TEST_REPORT);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify({ seeds, cases: report.cases, passed: report.passed, failed: report.failed.length,
        variations: variations.length, variantFailures: report.variantFailures.length }));
    if (report.failed.length || report.variantFailures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
