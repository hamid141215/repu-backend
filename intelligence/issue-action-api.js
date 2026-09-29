'use strict';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const TRANSITIONS = {
    OPEN: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'],
    IN_PROGRESS: ['IN_PROGRESS', 'OPEN', 'DONE', 'CANCELLED'],
    DONE: ['DONE', 'IN_PROGRESS', 'OPEN'],
    CANCELLED: ['CANCELLED', 'OPEN']
};
const CREATE_FIELDS = new Set(['title', 'description', 'assigneeUserId', 'dueDate']);
const PATCH_FIELDS = new Set(['title', 'description', 'assigneeUserId', 'dueDate', 'status']);
const { createOutcomeCycle, outcomeView } = require('./action-outcome-service');

function fail(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

function parseId(value, key) {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) fail(400, `Invalid ${key}`);
    if (BigInt(value) > 9223372036854775807n) fail(400, `Invalid ${key}`);
    return value;
}

function parseTitle(value) {
    if (typeof value !== 'string') fail(400, 'Invalid title');
    const title = value.trim();
    if (!title || title.length > 200) fail(400, 'Invalid title');
    return title;
}

function parseDescription(value) {
    if (value == null) return null;
    if (typeof value !== 'string' || value.length > 5000) fail(400, 'Invalid description');
    return value.trim() || null;
}

function parseAssignee(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const id = typeof value === 'number' ? String(value) : value;
    if (typeof id !== 'string' || !/^[1-9]\d{0,8}$/.test(id)) fail(400, 'Invalid assigneeUserId');
    const number = Number(id);
    if (!Number.isSafeInteger(number)) fail(400, 'Invalid assigneeUserId');
    return number;
}

function parseDueDate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Invalid dueDate');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, 'Invalid dueDate');
    return value;
}

function actionView(row) {
    const person = (id, displayName) => id == null ? null : ({ id: String(id), displayName });
    const dueDate = row.due_date == null ? null
        : row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date).slice(0, 10);
    return {
        id: String(row.id), issueId: String(row.issue_id), title: row.title,
        description: row.description ?? null, status: row.status,
        dueDate,
        assignee: person(row.assignee_id, row.assignee_name),
        createdBy: person(row.creator_id, row.creator_name),
        createdAt: row.created_at, updatedAt: row.updated_at,
        completedAt: row.completed_at ?? null, isOverdue: Boolean(row.is_overdue)
    };
}

const ACTION_SELECT = `SELECT a.id, a.issue_id, a.title, a.description, a.status, a.due_date,
    assignee.id AS assignee_id, assignee.name AS assignee_name,
    creator.id AS creator_id, creator.name AS creator_name,
    a.created_at, a.updated_at, a.completed_at,
    (a.due_date < CURRENT_DATE AND a.status NOT IN ('DONE', 'CANCELLED')) AS is_overdue
    FROM operational_actions a
    LEFT JOIN users assignee ON assignee.id = a.assignee_user_id AND assignee.client_id = a.client_id
    LEFT JOIN users creator ON creator.id = a.created_by_user_id AND creator.client_id = a.client_id`;

function createIssueActionHandlers(db) {
    const sendError = (res, error) => res.status(error.statusCode || 500)
        .json({ error: error.statusCode ? error.message : 'Database Error' });
    const requireUser = req => {
        const id = Number(req.user?.id);
        if (!Number.isSafeInteger(id) || id < 1) fail(403, 'User session required');
        return id;
    };
    const validAssignee = async (clientId, userId, executor = db) => {
        if (userId == null) return;
        const { rows } = await executor.query(
            'SELECT id FROM users WHERE id = $1 AND client_id = $2 AND is_active = true',
            [userId, clientId]
        );
        if (!rows[0]) fail(400, 'Invalid assignee');
    };

    return {
        assignees: async (req, res) => {
            try {
                const { rows } = await db.query(
                    `SELECT id, name AS display_name FROM users
                     WHERE client_id = $1 AND is_active = true ORDER BY name, id`,
                    [req.clientData.id]
                );
                res.json({ success: true, items: rows.map(row => ({ id: String(row.id), displayName: row.display_name })) });
            } catch (error) { sendError(res, error); }
        },

        list: async (req, res) => {
            try {
                const issueId = parseId(req.params.issueId, 'issueId');
                const clientId = req.clientData.id;
                const issue = await db.query(
                    'SELECT id FROM intelligence_issues WHERE id = $1 AND client_id = $2',
                    [issueId, clientId]
                );
                if (!issue.rows[0]) return res.status(404).json({ error: 'Issue not found' });
                const { rows } = await db.query(`${ACTION_SELECT}
                    WHERE a.client_id = $1 AND a.issue_id = $2
                    ORDER BY (a.status IN ('DONE', 'CANCELLED')) ASC,
                        a.due_date ASC NULLS LAST, a.created_at DESC`, [clientId, issueId]);
                const items = rows.map(actionView);
                if (items.length) {
                    const { rows: outcomeRows } = await db.query(`SELECT o.id, o.action_id, o.completed_at_snapshot,
                        o.baseline_start, o.baseline_end, o.post_start, o.post_end, o.status,
                        o.baseline_negative_count, o.baseline_total_count, o.baseline_negative_rate,
                        o.post_negative_count, o.post_total_count, o.post_negative_rate,
                        o.delta_negative_rate, o.measured_at
                        FROM action_outcomes o
                        JOIN operational_actions a ON a.id = o.action_id
                        JOIN intelligence_issues i ON i.id = a.issue_id AND i.client_id = a.client_id
                        WHERE o.action_id = ANY($1::bigint[]) AND a.client_id = $2
                        ORDER BY o.completed_at_snapshot DESC, o.id DESC`, [items.map(item => item.id), clientId]);
                    const outcomesByAction = new Map();
                    for (const row of outcomeRows) {
                        const actionKey = String(row.action_id);
                        if (!outcomesByAction.has(actionKey)) outcomesByAction.set(actionKey, []);
                        outcomesByAction.get(actionKey).push(outcomeView(row));
                    }
                    for (const item of items) item.outcomes = outcomesByAction.get(item.id) || [];
                }
                res.json({ success: true, items });
            } catch (error) { sendError(res, error); }
        },

        outcomes: async (req, res) => {
            try {
                const actionId = parseId(req.params.actionId, 'actionId');
                const clientId = req.clientData.id;
                const owned = await db.query(`SELECT a.id FROM operational_actions a
                    JOIN intelligence_issues i ON i.id = a.issue_id AND i.client_id = a.client_id
                    WHERE a.id = $1 AND a.client_id = $2`, [actionId, clientId]);
                if (!owned.rows[0]) return res.status(404).json({ error: 'Action not found' });
                const { rows } = await db.query(`SELECT o.id, o.action_id, o.completed_at_snapshot,
                    o.baseline_start, o.baseline_end, o.post_start, o.post_end, o.status,
                    o.baseline_negative_count, o.baseline_total_count, o.baseline_negative_rate,
                    o.post_negative_count, o.post_total_count, o.post_negative_rate,
                    o.delta_negative_rate, o.measured_at
                    FROM action_outcomes o
                    JOIN operational_actions a ON a.id = o.action_id
                    JOIN intelligence_issues i ON i.id = a.issue_id AND i.client_id = a.client_id
                    WHERE o.action_id = $1 AND a.client_id = $2
                    ORDER BY o.completed_at_snapshot DESC, o.id DESC`, [actionId, clientId]);
                res.json({ success: true, items: rows.map(outcomeView) });
            } catch (error) { sendError(res, error); }
        },

        create: async (req, res) => {
            try {
                const issueId = parseId(req.params.issueId, 'issueId');
                const clientId = req.clientData.id;
                const createdBy = requireUser(req);
                const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
                if (Object.keys(body).some(key => !CREATE_FIELDS.has(key))) fail(400, 'Invalid create fields');
                const title = parseTitle(body.title);
                const description = parseDescription(body.description);
                const assigneeUserId = parseAssignee(body.assigneeUserId);
                const dueDate = parseDueDate(body.dueDate);
                const issue = await db.query(
                    'SELECT id FROM intelligence_issues WHERE id = $1 AND client_id = $2',
                    [issueId, clientId]
                );
                if (!issue.rows[0]) return res.status(404).json({ error: 'Issue not found' });
                await validAssignee(clientId, assigneeUserId);
                const creator = await db.query(
                    'SELECT id FROM users WHERE id = $1 AND client_id = $2 AND is_active = true',
                    [createdBy, clientId]
                );
                if (!creator.rows[0]) fail(403, 'User session required');
                const inserted = await db.query(`INSERT INTO operational_actions
                    (client_id, issue_id, title, description, assignee_user_id, status, due_date, created_by_user_id)
                    VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7) RETURNING id`,
                [clientId, issueId, title, description, assigneeUserId ?? null, dueDate ?? null, createdBy]);
                const { rows } = await db.query(`${ACTION_SELECT} WHERE a.client_id = $1 AND a.id = $2`,
                    [clientId, inserted.rows[0].id]);
                res.status(201).json({ success: true, action: actionView(rows[0]) });
            } catch (error) { sendError(res, error); }
        },

        update: async (req, res) => {
            let connection = null;
            let transactionStarted = false;
            try {
                requireUser(req);
                const actionId = parseId(req.params.actionId, 'actionId');
                const clientId = req.clientData.id;
                const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
                const keys = Object.keys(body);
                if (!keys.length || keys.some(key => !PATCH_FIELDS.has(key))) fail(400, 'Invalid update fields');
                connection = typeof db.connect === 'function' ? await db.connect() : db;
                await connection.query('BEGIN');
                transactionStarted = true;
                const { rows: currentRows } = await connection.query(`SELECT id, title, description, assignee_user_id,
                    status, due_date, completed_at FROM operational_actions
                    WHERE id = $1 AND client_id = $2 FOR UPDATE`, [actionId, clientId]);
                const current = currentRows[0];
                if (!current) {
                    await connection.query('ROLLBACK');
                    transactionStarted = false;
                    return res.status(404).json({ error: 'Action not found' });
                }

                const title = body.title === undefined ? current.title : parseTitle(body.title);
                const description = body.description === undefined ? current.description : parseDescription(body.description);
                const assigneeUserId = body.assigneeUserId === undefined
                    ? current.assignee_user_id : parseAssignee(body.assigneeUserId);
                const dueDate = body.dueDate === undefined ? current.due_date : parseDueDate(body.dueDate);
                const status = body.status === undefined ? current.status : body.status;
                if (!STATUSES.includes(status) || !TRANSITIONS[current.status]?.includes(status)) fail(400, 'Invalid status transition');
                if (body.assigneeUserId !== undefined) await validAssignee(clientId, assigneeUserId, connection);
                const values = [];
                const assignments = [];
                const add = (column, value) => {
                    values.push(value);
                    assignments.push(`${column} = $${values.length}`);
                };
                if (body.title !== undefined) add('title', title);
                if (body.description !== undefined) add('description', description);
                if (body.assigneeUserId !== undefined) add('assignee_user_id', assigneeUserId);
                if (body.dueDate !== undefined) add('due_date', dueDate);
                if (body.status !== undefined) {
                    add('status', status);
                    if (status === 'DONE' && current.status !== 'DONE') {
                        assignments.push('completed_at = NOW()');
                    } else if (status === 'DONE') {
                        assignments.push('completed_at = COALESCE(completed_at, NOW())');
                    } else {
                        assignments.push('completed_at = NULL');
                    }
                }
                assignments.push('updated_at = NOW()');
                values.push(actionId, clientId);
                let where = `id = $${values.length - 1} AND client_id = $${values.length}`;
                if (body.status !== undefined) {
                    values.push(current.status);
                    where += ` AND status = $${values.length}`;
                }
                const { rowCount } = await connection.query(
                    `UPDATE operational_actions SET ${assignments.join(', ')} WHERE ${where}`,
                    values
                );
                if (rowCount === 0) {
                    await connection.query('ROLLBACK');
                    transactionStarted = false;
                    return res.status(409).json({ error: 'Action changed; reload and retry' });
                }
                if (status === 'DONE' && current.status !== 'DONE') {
                    await createOutcomeCycle(connection, actionId, clientId);
                }
                const { rows } = await connection.query(`${ACTION_SELECT} WHERE a.client_id = $1 AND a.id = $2`,
                    [clientId, actionId]);
                if (!rows[0]) {
                    await connection.query('ROLLBACK');
                    transactionStarted = false;
                    return res.status(404).json({ error: 'Action not found' });
                }
                await connection.query('COMMIT');
                transactionStarted = false;
                res.json({ success: true, action: actionView(rows[0]) });
            } catch (error) {
                if (transactionStarted) {
                    try { await connection.query('ROLLBACK'); } catch (_) {}
                }
                sendError(res, error);
            } finally {
                if (connection && connection !== db && typeof connection.release === 'function') connection.release();
            }
        }
    };
}

module.exports = { createIssueActionHandlers, actionView, parseDueDate, TRANSITIONS };
