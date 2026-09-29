'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('issue action UI renders pending, insufficient and terminal outcome states with non-causal disclaimer', () => {
    const source = fs.readFileSync(path.join(__dirname, '../spa/src/routes/issues.tsx'), 'utf8');
    for (const phrase of ['النتيجة بعد التنفيذ', 'قيد الرصد', 'بيانات غير كافية', 'تحسن', 'لم يظهر تغير واضح', 'تراجع']) {
        assert.ok(source.includes(phrase), `missing UI label: ${phrase}`);
    }
    assert.ok(source.includes('تكتمل فترة الرصد في'));
    assert.ok(source.includes('قبل التنفيذ'));
    assert.ok(source.includes('بعد التنفيذ'));
    assert.ok(source.includes('لا يثبت السببية'));
    assert.ok(source.includes('دورة سابقة'));
    assert.match(source, /action\.outcomes\?\.length/);
    assert.doesNotMatch(source, /evidenceText|evidence_text|feedback/);
});

test('outcome UI types contain only counts, rates, dates and state, not review/evidence content', () => {
    const types = fs.readFileSync(path.join(__dirname, '../spa/src/types/issues.ts'), 'utf8');
    const outcomeBlock = types.slice(types.indexOf('export interface ActionOutcome {'), types.indexOf('export interface ActionOutcomesResponse'));
    assert.ok(outcomeBlock.includes('baselineWindow'));
    assert.ok(outcomeBlock.includes('postWindow'));
    assert.ok(outcomeBlock.includes('deltaNegativeRate'));
    assert.doesNotMatch(outcomeBlock, /evidence|feedback|email|phone|provider|prompt/i);
});
