'use strict';

// Pure input and allocation rules shared by the UI and regression tests.
const Cargo = {
    MAX_ITEMS: 1000,
    number(raw, min, max, integer = false) {
        if (typeof raw !== 'number' && typeof raw !== 'string') throw new RangeError('请输入有效数值');
        const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
        if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
            throw new RangeError(`请输入 ${min} 到 ${max} 之间的${integer ? '整数' : '数值'}`);
        }
        return value;
    },
    validateInventory(inventory) {
        let total = 0;
        const ids = new Set();
        for (const item of inventory) {
            if (!item.id || ids.has(item.id)) throw new RangeError('产品编号必须唯一');
            ids.add(item.id);
            if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new RangeError('产品名称须为 1 到 80 个字符');
            if (!/^#[\da-f]{6}$/i.test(item.color)) throw new RangeError('产品颜色无效');
            for (const axis of ['l', 'w', 'h']) this.number(item[axis], 0.01, 500);
            this.number(item.weight, 0, 100000);
            this.number(item.qty, 0, this.MAX_ITEMS, true);
            this.number(item.ratio, 0, 100000, true);
            this.number(item.minQty, 0, this.MAX_ITEMS, true);
            total += item.qty;
        }
        if (total > this.MAX_ITEMS) throw new RangeError(`清单合计最多 ${this.MAX_ITEMS} 件，请减少数量`);
        return total;
    },
    allocate(inventory, { l, w, h, emptyWeight, maxWeight }) {
        this.validateInventory(inventory);
        for (const value of [l, w, h]) this.number(value, 5, 500);
        this.number(emptyWeight, 0, 100000);
        this.number(maxWeight, 0.01, 100000);
        if (emptyWeight >= maxWeight) throw new RangeError('承载上限必须大于箱子空重');
        if (!inventory.length) throw new RangeError('请先添加产品，再计算配载数量');
        const quantities = inventory.map(item => item.minQty);
        const volumes = inventory.map(item => item.l * item.w * item.h);
        const fits = inventory.map(item => {
            const a = [item.l, item.w, item.h].sort((x, y) => x - y);
            const b = [l, w, h].sort((x, y) => x - y);
            return a.every((v, i) => v <= b[i]);
        });
        if (fits.some((fit, i) => !fit && quantities[i] > 0)) throw new RangeError('最少数量中存在无法放入容器的产品');
        let count = quantities.reduce((sum, q) => sum + q, 0);
        let weight = quantities.reduce((sum, q, i) => sum + q * inventory[i].weight, 0);
        let volume = quantities.reduce((sum, q, i) => sum + q * volumes[i], 0);
        // shortcut: volume is a 75% estimate, run the 3D solver to verify geometric fit.
        const maxVolume = l * w * h * 0.75;
        if (count > this.MAX_ITEMS) throw new RangeError(`最少数量合计不能超过 ${this.MAX_ITEMS} 件`);
        if (weight > maxWeight - emptyWeight) throw new RangeError('最少数量已超出承载上限');
        if (volume > maxVolume) throw new RangeError('最少数量已超出 75% 安全容积');
        const blocked = inventory.map((item, i) => item.ratio <= 0 || !fits[i]);
        while (count < this.MAX_ITEMS) {
            let best = -1;
            for (let i = 0; i < inventory.length; i++) {
                if (blocked[i]) continue;
                if (weight + inventory[i].weight > maxWeight - emptyWeight || volume + volumes[i] > maxVolume) {
                    blocked[i] = true;
                    continue;
                }
                if (best < 0 || (quantities[i] - inventory[i].minQty) / inventory[i].ratio <
                    (quantities[best] - inventory[best].minQty) / inventory[best].ratio) best = i;
            }
            if (best < 0) break;
            quantities[best]++;
            count++;
            weight += inventory[best].weight;
            volume += volumes[best];
        }
        return quantities;
    }
};

if (typeof module !== 'undefined') module.exports = Cargo;
