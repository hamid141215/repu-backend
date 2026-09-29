'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createIssueActionHandlers, actionView, TRANSITIONS } = require('../intelligence/issue-action-api');

const baseAction = {
    id: '91', issue_id: '41', title: 'تحسين الخدمة', description: null, status: 'OPEN', due_date: null,
    assignee_id: 8, assignee_name: 'مسؤول الفريق', creator_id: 12, creator_name: 'مدير المؤسسة',
    created_at: '2026-09-27T10:00:00Z', updated_at: '2026-09-27T10:00:00Z', completed_at: null,
    is_overdue: false
};

function makeDb(options = {}) {
    const calls = [];
    const db = {
        calls,
        options,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (sql.includes('FROM intelligence_issues')) {
                return { rows: options.issueExists === false ? [] : [{ id: params[0] }] };
            }
            if (sql.includes('SELECT id FROM users WHERE id = $1 AND client_id = $2 AND is_active = true')) {
                const user = options.userLookup ? options.userLookup(params[0], params[1])
                    : { id: params[0], client_id: params[1], is_active: true };
                return { rows: user?.client_id === params[1] && user.is_active ? [{ id: user.id }] : [] };
            }
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
            if (sql.includes('INSERT INTO action_outcomes')) {
                if (options.outcomeInsertError) throw new Error('outcome insert failed');
                return { rows: [{ id: String((options.outcomeInsertCount = (options.outcomeInsertCount ?? 0) + 1)) }] };
            }
            if (sql.includes('SELECT id, name AS display_name')) {
                return { rows: options.assignees ?? [{ id: 8, display_name: 'مسؤول الفريق' }] };
            }
            if (sql.includes('INSERT INTO operational_actions')) return { rows: [{ id: '91' }] };
            if (sql.includes('SELECT id, title, description, assignee_user_id')) {
                return { rows: options.currentAction === null ? [] : [options.currentAction ?? {
                    id: '91', title: baseAction.title, description: null, assignee_user_id: 8,
                    status: options.currentStatus ?? 'OPEN', due_date: null, completed_at: options.completedAt ?? null
                }] };
            }
            if (sql.includes('UPDATE operational_actions SET')) {
                const nextStatus = params.find(value => ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(value));
                if (nextStatus) {
                    options.currentStatus = nextStatus;
                    options.completedAt = nextStatus === 'DONE'
                        ? (options.updateCompletedAt ?? '2026-09-29T12:00:00.000Z') : null;
                }
                return { rowCount: options.updateRowCount ?? 1, rows: [{ completed_at: options.completedAt ?? '2026-09-29T12:00:00.000Z' }] };
            }
            if (sql.includes('FROM operational_actions a')) {
                if (options.listAction === null) return { rows: [] };
                const row = { ...(options.listAction ?? baseAction) };
                if (options.databaseDate) {
                    const dueDate = row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : row.due_date;
                    row.is_overdue = Boolean(dueDate && dueDate < options.databaseDate
                        && !['DONE', 'CANCELLED'].includes(row.status));
                }
                return { rows: [row] };
            }
            return { rows: [] };
        }
    };
    db.connect = async () => ({ query: (sql, params) => db.query(sql, params), release() {} });
    return db;
}

function response() {
    return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

function request(body = {}, extra = {}) {
    return { clientData: { id: 7 }, user: { id: 12 }, role: 'manager', params: { issueId: '41', actionId: '91' }, body, ...extra };
}

test('creates an OPEN action for the current tenant issue and current user', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).create(request({ title: '  تحسين الخدمة  ' }), res);
    assert.equal(res.code, 201);
    const insert = db.calls.find(call => call.sql.includes('INSERT INTO operational_actions'));
    assert.deepEqual(insert.params, [7, '41', 'تحسين الخدمة', null, null, null, 12]);
    assert.match(insert.sql, /'OPEN'/);
});

test('cannot create an action for a foreign-tenant issue', async () => {
    const db = makeDb({ issueExists: false }); const res = response();
    await createIssueActionHandlers(db).create(request({ title: 'Action' }), res);
    assert.equal(res.code, 404);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO operational_actions')), false);
    assert.deepEqual(db.calls[0].params, ['41', 7]);
});

test('same-tenant inactive assignee is rejected for POST', async () => {
    const db = makeDb({ userLookup: (id, clientId) => ({ id, client_id: clientId, is_active: false }) }); const res = response();
    await createIssueActionHandlers(db).create(request({ title: 'Action', assigneeUserId: '99' }), res);
    assert.equal(res.code, 400);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO operational_actions')), false);
    const lookup = db.calls.find(call => call.sql.includes('SELECT id FROM users WHERE id ='));
    assert.deepEqual(lookup.params, [99, 7]);
    assert.match(lookup.sql, /client_id = \$2 AND is_active = true/);
});

test('same-tenant inactive assignee is rejected for PATCH', async () => {
    const db = makeDb({ userLookup: (id, clientId) => ({ id, client_id: clientId, is_active: false }) }); const res = response();
    await createIssueActionHandlers(db).update(request({ assigneeUserId: '99' }), res);
    assert.equal(res.code, 400);
    assert.equal(db.calls.some(call => call.sql.includes('UPDATE operational_actions SET')), false);
});

test('active assignee from another tenant is rejected independently', async () => {
    const db = makeDb({ userLookup: id => ({ id, client_id: 8, is_active: true }) }); const res = response();
    await createIssueActionHandlers(db).create(request({ title: 'Action', assigneeUserId: '99' }), res);
    assert.equal(res.code, 400);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO operational_actions')), false);
    const lookup = db.calls.find(call => call.sql.includes('SELECT id FROM users WHERE id ='));
    assert.deepEqual(lookup.params, [99, 7]);
    assert.match(lookup.sql, /client_id = \$2/);
});

test('active cross-tenant assignee is rejected for PATCH', async () => {
    const db = makeDb({ userLookup: id => ({ id, client_id: 8, is_active: true }) }); const res = response();
    await createIssueActionHandlers(db).update(request({ assigneeUserId: '99' }), res);
    assert.equal(res.code, 400);
    assert.equal(db.calls.some(call => call.sql.includes('UPDATE operational_actions SET')), false);
});

test('action may be created without an assignee', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).create(request({ title: 'Action' }), res);
    assert.equal(res.code, 201);
    assert.equal(db.calls.find(call => call.sql.includes('INSERT INTO operational_actions')).params[4], null);
});

test('rejects blank or overlong titles', async () => {
    for (const title of ['', '   ', 'x'.repeat(201)]) {
        const db = makeDb(); const res = response();
        await createIssueActionHandlers(db).create(request({ title }), res);
        assert.equal(res.code, 400);
        assert.equal(db.calls.length, 0);
    }
});

test('rejects invalid calendar due dates and allows date-only values', async () => {
    const invalidDb = makeDb(); const invalid = response();
    await createIssueActionHandlers(invalidDb).create(request({ title: 'Action', dueDate: '2026-02-30' }), invalid);
    assert.equal(invalid.code, 400);
    assert.equal(invalidDb.calls.length, 0);
    const validDb = makeDb(); const valid = response();
    await createIssueActionHandlers(validDb).create(request({ title: 'Action', dueDate: '2026-09-28' }), valid);
    assert.equal(valid.code, 201);
    assert.equal(validDb.calls.find(call => call.sql.includes('INSERT INTO operational_actions')).params[5], '2026-09-28');
});

test('create request cannot choose its initial status', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).create(request({ title: 'Action', status: 'DONE' }), res);
    assert.equal(res.code, 400);
    assert.equal(db.calls.length, 0);
});

test('create request cannot override tenant, issue, creator or completion metadata', async () => {
    for (const field of ['client_id', 'issue_id', 'created_by_user_id', 'completed_at']) {
        const db = makeDb(); const res = response();
        await createIssueActionHandlers(db).create(request({ title: 'Action', [field]: 999 }), res);
        assert.equal(res.code, 400);
        assert.equal(db.calls.length, 0);
    }
});

test('PATCH is scoped by tenant and a foreign action id behaves as 404', async () => {
    const db = makeDb({ currentAction: null }); const res = response();
    await createIssueActionHandlers(db).update(request({ title: 'Changed' }), res);
    assert.equal(res.code, 404);
    assert.deepEqual(db.calls.find(call => call.sql.includes('SELECT id, title, description, assignee_user_id')).params, ['91', 7]);
});

test('DONE sets completed_at in the database update', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).update(request({ status: 'DONE' }), res);
    assert.equal(res.code, 200);
    const update = db.calls.find(call => call.sql.includes('UPDATE operational_actions SET'));
    assert.ok(update.params.includes('DONE'));
    assert.match(update.sql, /completed_at = NOW\(\)/);
    assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO action_outcomes')));
    assert.ok(db.calls.some(call => call.sql === 'BEGIN'));
    assert.ok(db.calls.some(call => call.sql === 'COMMIT'));
    const updateIndex = db.calls.findIndex(call => call.sql.includes('UPDATE operational_actions SET'));
    const insertIndex = db.calls.findIndex(call => call.sql.includes('INSERT INTO action_outcomes'));
    const commitIndex = db.calls.findIndex(call => call.sql === 'COMMIT');
    assert.ok(updateIndex < insertIndex && insertIndex < commitIndex);
    const cycle = db.calls[insertIndex];
    assert.deepEqual(cycle.params, ['91', 7, 30, 30]);
    assert.match(cycle.sql, /'PENDING'/);
    assert.match(cycle.sql, /a\.completed_at - \(\$3 \* INTERVAL '1 day'\)/);
    assert.match(cycle.sql, /a\.completed_at \+ \(\$4 \* INTERVAL '1 day'\)/);
    assert.match(cycle.sql, /WHERE a\.id = \$1 AND a\.client_id = \$2 AND a\.status = 'DONE'/);
});

test('DONE no-op does not create a duplicate outcome cycle', async () => {
    const db = makeDb({ currentStatus: 'DONE', completedAt: '2026-09-29T12:00:00.000Z' }); const res = response();
    await createIssueActionHandlers(db).update(request({ status: 'DONE' }), res);
    assert.equal(res.code, 200);
    assert.equal(db.calls.filter(call => call.sql.includes('INSERT INTO action_outcomes')).length, 0);
});

test('reopen preserves the previous outcome and a later completion creates another cycle', async () => {
    const db = makeDb({ currentStatus: 'OPEN', updateCompletedAt: '2026-09-29T12:00:00.000Z' });
    const handlers = createIssueActionHandlers(db);
    const firstDone = response();
    await handlers.update(request({ status: 'DONE' }), firstDone);
    assert.equal(firstDone.code, 200);
    db.options.currentStatus = 'DONE';
    const reopened = response();
    await handlers.update(request({ status: 'OPEN' }), reopened);
    assert.equal(reopened.code, 200);
    assert.equal(db.calls.some(call => call.sql.includes('DELETE FROM action_outcomes')), false);
    db.options.currentStatus = 'OPEN';
    db.options.updateCompletedAt = '2026-10-01T12:00:00.000Z';
    const secondDone = response();
    await handlers.update(request({ status: 'DONE' }), secondDone);
    assert.equal(secondDone.code, 200);
    const cycles = db.calls.filter(call => call.sql.includes('INSERT INTO action_outcomes'));
    assert.equal(cycles.length, 2);
    assert.match(cycles[0].sql, /SELECT a\.id, a\.completed_at/);
    assert.match(cycles[1].sql, /SELECT a\.id, a\.completed_at/);
    assert.equal(db.calls.filter(call => call.sql.includes('UPDATE operational_actions SET') && call.sql.includes('completed_at = NOW()')).length, 2);
});

test('action update rolls back if outcome cycle insert fails', async () => {
    const db = makeDb({ outcomeInsertError: true }); const res = response();
    await createIssueActionHandlers(db).update(request({ status: 'DONE' }), res);
    assert.equal(res.code, 500);
    assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(db.calls.some(call => call.sql === 'COMMIT'), false);
});

test('reopening a completed action clears completed_at', async () => {
    const db = makeDb({ currentStatus: 'DONE', completedAt: '2026-09-28T10:00:00Z' }); const res = response();
    await createIssueActionHandlers(db).update(request({ status: 'IN_PROGRESS' }), res);
    assert.equal(res.code, 200);
    const update = db.calls.find(call => call.sql.includes('UPDATE operational_actions SET'));
    assert.ok(update.params.includes('IN_PROGRESS'));
    assert.match(update.sql, /completed_at = NULL/);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO action_outcomes')), false);
});

test('PATCH without status does not update completed_at or status', async () => {
    const db = makeDb({ currentStatus: 'DONE', completedAt: '2026-09-28T10:00:00Z' }); const res = response();
    await createIssueActionHandlers(db).update(request({ title: 'Updated title' }), res);
    assert.equal(res.code, 200);
    const update = db.calls.find(call => call.sql.includes('UPDATE operational_actions SET'));
    assert.doesNotMatch(update.sql, /completed_at\s*=|\bstatus\s*=/);
    assert.deepEqual(update.params, ['Updated title', '91', 7]);
});

test('PATCH assigneeUserId=null clears the assignment', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).update(request({ assigneeUserId: null }), res);
    assert.equal(res.code, 200);
    const update = db.calls.find(call => call.sql.includes('UPDATE operational_actions SET'));
    assert.match(update.sql, /assignee_user_id = \$1/);
    assert.deepEqual(update.params, [null, '91', 7]);
});

test('PATCH dueDate=null clears the due date', async () => {
    const db = makeDb({ currentAction: {
        id: '91', title: 'Action', description: null, assignee_user_id: 8,
        status: 'OPEN', due_date: '2026-10-01', completed_at: null
    } }); const res = response();
    await createIssueActionHandlers(db).update(request({ dueDate: null }), res);
    assert.equal(res.code, 200);
    const update = db.calls.find(call => call.sql.includes('UPDATE operational_actions SET'));
    assert.match(update.sql, /due_date = \$1/);
    assert.deepEqual(update.params, [null, '91', 7]);
});

test('CANCELLED does not set completed_at and only reopens to OPEN', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).update(request({ status: 'CANCELLED' }), res);
    assert.equal(res.code, 200);
    assert.match(db.calls.find(call => call.sql.includes('UPDATE operational_actions SET')).sql, /completed_at = NULL/);
    assert.deepEqual(TRANSITIONS.CANCELLED, ['CANCELLED', 'OPEN']);
});

test('all required status transitions are accepted server-side', async () => {
    const allowed = [
        ['OPEN', 'IN_PROGRESS'], ['OPEN', 'DONE'], ['OPEN', 'CANCELLED'],
        ['IN_PROGRESS', 'OPEN'], ['IN_PROGRESS', 'DONE'], ['IN_PROGRESS', 'CANCELLED'],
        ['DONE', 'OPEN'], ['DONE', 'IN_PROGRESS'], ['CANCELLED', 'OPEN']
    ];
    for (const [currentStatus, nextStatus] of allowed) {
        const db = makeDb({ currentStatus, completedAt: currentStatus === 'DONE' ? '2026-09-28T10:00:00Z' : null });
        const res = response();
        await createIssueActionHandlers(db).update(request({ status: nextStatus }), res);
        assert.equal(res.code, 200, `${currentStatus} -> ${nextStatus}`);
        assert.ok(db.calls.some(call => call.sql.includes('UPDATE operational_actions SET')), `${currentStatus} -> ${nextStatus}`);
    }
});

test('unsupported status transitions are rejected server-side', async () => {
    for (const [currentStatus, nextStatus] of [['DONE', 'CANCELLED'], ['CANCELLED', 'DONE'], ['CANCELLED', 'IN_PROGRESS']]) {
        const db = makeDb({ currentStatus, completedAt: currentStatus === 'DONE' ? '2026-09-28T10:00:00Z' : null });
        const res = response();
        await createIssueActionHandlers(db).update(request({ status: nextStatus }), res);
        assert.equal(res.code, 400, `${currentStatus} -> ${nextStatus}`);
        assert.equal(db.calls.some(call => call.sql.includes('UPDATE operational_actions SET')), false);
    }
});

test('overdue is derived in SQL and serialized as a boolean', async () => {
    const db = makeDb({ listAction: { ...baseAction, due_date: '2026-09-01', is_overdue: true } }); const res = response();
    await createIssueActionHandlers(db).list(request(), res);
    const actionQuery = db.calls.find(call => call.sql.includes('FROM operational_actions a'));
    assert.match(actionQuery.sql, /a\.due_date < CURRENT_DATE AND a\.status NOT IN \('DONE', 'CANCELLED'\)/);
    assert.equal(res.body.items[0].isOverdue, true);
});

test('overdue semantics exclude today, future, DONE and CANCELLED actions', async () => {
    const today = '2026-09-28';
    const cases = [
        { due_date: '2026-09-27', status: 'OPEN', expected: true },
        { due_date: today, status: 'OPEN', expected: false },
        { due_date: '2026-09-29', status: 'OPEN', expected: false },
        { due_date: '2026-09-27', status: 'DONE', expected: false },
        { due_date: '2026-09-27', status: 'CANCELLED', expected: false }
    ];
    for (const item of cases) {
        const db = makeDb({ databaseDate: today, listAction: { ...baseAction, ...item } }); const res = response();
        await createIssueActionHandlers(db).list(request(), res);
        assert.equal(res.body.items[0].isOverdue, item.expected, `${item.status}, due ${item.due_date}`);
    }
});

test('historical action retains a disabled assignee display name', async () => {
    const action = { ...baseAction, assignee_id: 8, assignee_name: 'Former team member' };
    const db = makeDb({ listAction: action }); const res = response();
    await createIssueActionHandlers(db).list(request(), res);
    const query = db.calls.find(call => call.sql.includes('FROM operational_actions a'));
    assert.match(query.sql, /LEFT JOIN users assignee/);
    assert.doesNotMatch(query.sql, /assignee\.is_active/);
    assert.equal(res.body.items.length, 1);
    assert.deepEqual(res.body.items[0].assignee, { id: '8', displayName: 'Former team member' });
});

test('GET actions verifies issue tenant before listing actions', async () => {
    const db = makeDb(); const res = response();
    await createIssueActionHandlers(db).list(request(), res);
    assert.equal(db.calls[0].params[1], 7);
    assert.match(db.calls[1].sql, /a\.client_id = \$1 AND a\.issue_id = \$2/);
    assert.deepEqual(db.calls[1].params, [7, '41']);
    assert.equal(res.body.items.length, 1);
});

test('GET actions returns 404 for a foreign issue', async () => {
    const db = makeDb({ issueExists: false }); const res = response();
    await createIssueActionHandlers(db).list(request(), res);
    assert.equal(res.code, 404);
    assert.equal(db.calls.length, 1);
});

test('GET outcomes scopes the action through the current tenant issue and returns cycle rows newest first', async () => {
    const db = makeDb();
    db.query = async function (sql, params = []) {
        this.calls.push({ sql, params });
        if (sql.includes('JOIN intelligence_issues i') && sql.includes('WHERE a.id = $1')) return { rows: [{ id: '91' }] };
        if (sql.includes('FROM action_outcomes o')) return { rows: [{
            id: '11', action_id: '91', completed_at_snapshot: '2026-09-29T12:00:00Z',
            baseline_start: '2026-08-30T12:00:00Z', baseline_end: '2026-09-29T12:00:00Z',
            post_start: '2026-09-29T12:00:00Z', post_end: '2026-10-29T12:00:00Z',
            status: 'PENDING', baseline_negative_count: null, baseline_total_count: null,
            baseline_negative_rate: null, post_negative_count: null, post_total_count: null,
            post_negative_rate: null, delta_negative_rate: null, measured_at: null,
            email: 'private@example.test', evidence_text: 'private review text'
        }] };
        return { rows: [] };
    };
    const res = response();
    await createIssueActionHandlers(db).outcomes(request({}, { params: { actionId: '91' } }), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.items[0].status, 'PENDING');
    assert.equal(res.body.items[0].actionId, '91');
    assert.equal(JSON.stringify(res.body).includes('private@example.test'), false);
    assert.equal(JSON.stringify(res.body).includes('private review text'), false);
    assert.equal(db.calls[0].params[1], 7);
    assert.match(db.calls[0].sql, /a\.client_id = \$2/);
});

test('GET outcomes hides a foreign action as 404 without client override', async () => {
    const db = makeDb({ listAction: null });
    db.query = async function (sql, params = []) {
        this.calls.push({ sql, params });
        return { rows: [] };
    };
    const res = response();
    await createIssueActionHandlers(db).outcomes(request({}, { params: { actionId: '91' }, query: { client_id: '8' } }), res);
    assert.equal(res.code, 404);
    assert.equal(db.calls.length, 1);
    assert.deepEqual(db.calls[0].params, ['91', 7]);
});

test('GET issue actions attaches outcome cycles in one batch ordered newest first', async () => {
    const db = makeDb();
    const baseOutcome = (id, completedAt) => ({
        id, action_id: '91', completed_at_snapshot: completedAt,
        baseline_start: '2026-08-30T12:00:00Z', baseline_end: completedAt,
        post_start: completedAt, post_end: '2026-10-29T12:00:00Z', status: 'PENDING',
        baseline_negative_count: null, baseline_total_count: null, baseline_negative_rate: null,
        post_negative_count: null, post_total_count: null, post_negative_rate: null,
        delta_negative_rate: null, measured_at: null, review_text: 'not returned'
    });
    db.query = async function (sql, params = []) {
        this.calls.push({ sql, params });
        if (sql.includes('FROM intelligence_issues')) return { rows: [{ id: '41' }] };
        if (sql.includes('FROM operational_actions a')) return { rows: [baseAction] };
        if (sql.includes('FROM action_outcomes o')) return { rows: [
            baseOutcome('12', '2026-09-30T12:00:00Z'), baseOutcome('11', '2026-09-29T12:00:00Z')
        ] };
        return { rows: [] };
    };
    const res = response();
    await createIssueActionHandlers(db).list(request(), res);
    assert.equal(res.body.items[0].outcomes.length, 2);
    assert.equal(res.body.items[0].outcomes[0].id, '12');
    assert.equal(JSON.stringify(res.body).includes('not returned'), false);
    assert.equal(db.calls.filter(call => call.sql.includes('FROM action_outcomes o')).length, 1);
});

test('assignee and creator responses contain only id and displayName', async () => {
    const view = actionView({ ...baseAction, assignee_email: 'private@example.test', assignee_phone: '0500000000' });
    assert.deepEqual(view.assignee, { id: '8', displayName: 'مسؤول الفريق' });
    assert.deepEqual(view.createdBy, { id: '12', displayName: 'مدير المؤسسة' });
    assert.equal('email' in view.assignee, false);
    assert.equal('phone' in view.assignee, false);
    const db = makeDb({ assignees: [{ id: 8, display_name: 'مسؤول الفريق', email: 'private@example.test' }] }); const res = response();
    await createIssueActionHandlers(db).assignees(request(), res);
    assert.deepEqual(res.body.items, [{ id: '8', displayName: 'مسؤول الفريق' }]);
    const listDb = makeDb(); const listRes = response();
    await createIssueActionHandlers(listDb).list(request(), listRes);
    const query = listDb.calls.find(call => call.sql.includes('FROM operational_actions a'));
    assert.match(query.sql, /assignee\.client_id = a\.client_id/);
    assert.match(query.sql, /creator\.client_id = a\.client_id/);
    assert.equal('email' in listRes.body.items[0], false);
    assert.equal('phone' in listRes.body.items[0], false);
});

test('PATCH rejects attempts to alter immutable or tenant fields before database access', async () => {
    for (const field of ['client_id', 'issue_id', 'created_by_user_id', 'created_at', 'completed_at']) {
        const db = makeDb(); const res = response();
        await createIssueActionHandlers(db).update(request({ [field]: 999 }), res);
        assert.equal(res.code, 400);
        assert.equal(db.calls.length, 0);
    }
});

test('legacy API-key owner cannot POST or PATCH without req.user.id', async () => {
    const createDb = makeDb(); const createRes = response();
    await createIssueActionHandlers(createDb).create(request({ title: 'Action' }, { role: 'owner', user: null }), createRes);
    assert.equal(createRes.code, 403);
    assert.equal(createDb.calls.length, 0);

    const patchDb = makeDb(); const patchRes = response();
    await createIssueActionHandlers(patchDb).update(request({ title: 'Updated' }, { role: 'owner', user: null }), patchRes);
    assert.equal(patchRes.code, 403);
    assert.equal(patchDb.calls.length, 0);
});

test('roles are restricted structurally at authenticated route middleware', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /app\.get\('\/api\/intelligence\/issues\/:issueId\/actions', authenticate/);
    assert.match(source, /app\.post\('\/api\/intelligence\/issues\/:issueId\/actions', authenticate, requireRole\('owner', 'manager'\)/);
    assert.match(source, /app\.patch\('\/api\/intelligence\/actions\/:actionId', authenticate, requireRole\('owner', 'manager'\)/);
    assert.match(source, /app\.get\('\/api\/intelligence\/actions\/:actionId\/outcomes', authenticate/);
    assert.match(source, /const requireRole = \(\.\.\.allowed\).*allowed\.includes\(req\.role\)/s);
});

test('schema migration defines constrained actions and only targeted indexes', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../db/intelligence-schema.js'), 'utf8');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS operational_actions/);
    assert.match(schema, /issue_id BIGINT NOT NULL REFERENCES intelligence_issues\(id\) ON DELETE CASCADE/);
    assert.match(schema, /assignee_user_id INTEGER REFERENCES users\(id\) ON DELETE SET NULL/);
    assert.match(schema, /created_by_user_id INTEGER REFERENCES users\(id\) ON DELETE SET NULL/);
    assert.match(schema, /CHECK \(status IN \('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'\)\)/);
    assert.match(schema, /due_date DATE/);
    assert.match(schema, /completed_at TIMESTAMPTZ/);
    assert.match(schema, /idx_operational_actions_issue_order/);
    assert.match(schema, /idx_operational_actions_assignee/);
});

test('action outcome schema is idempotent, constrained and unique per completion cycle', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../db/intelligence-schema.js'), 'utf8');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS action_outcomes/);
    assert.match(schema, /REFERENCES operational_actions\(id\) ON DELETE CASCADE/);
    assert.match(schema, /UNIQUE \(action_id, completed_at_snapshot\)/);
    assert.match(schema, /INSUFFICIENT_DATA', 'IMPROVED', 'UNCHANGED', 'WORSENED/);
    assert.match(schema, /baseline_negative_count <= baseline_total_count/);
    assert.match(schema, /delta_negative_rate BETWEEN -1 AND 1/);
    assert.match(schema, /idx_action_outcomes_pending_post_end/);
});
