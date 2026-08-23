'use strict';

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

const results = [];

function assert(name, cond, extra) {
    results.push({ name, pass: Boolean(cond), extra: extra || '' });
    const mark = cond ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${name}${extra ? ' — ' + extra : ''}`);
}

async function req(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { _raw: text };
    }
    return { status: res.status, json };
}

async function main() {
    const stamp = Date.now();
    const email1 = `agents-api-${stamp}@example.com`;
    const email2 = `agents-api-${stamp}-b@example.com`;
    const password = 'TestPass123!';

    const health = await req('GET', '/api/health');
    assert('GET /api/health', health.status === 200 && health.json.status === 'ok', `status=${health.status}`);

    const reg1 = await req('POST', '/api/owners/register', { body: { email: email1, password } });
    assert('POST /api/owners/register owner1', reg1.status === 201, `status=${reg1.status}`);
    const owner1Id = reg1.json && reg1.json.id;

    const login1 = await req('POST', '/api/owners/login', { body: { email: email1, password } });
    assert('POST /api/owners/login owner1', login1.status === 200 && Boolean(login1.json.token), `status=${login1.status}`);
    const token1 = login1.json && login1.json.token;

    const reg2 = await req('POST', '/api/owners/register', { body: { email: email2, password } });
    assert('POST /api/owners/register owner2', reg2.status === 201, `status=${reg2.status}`);
    const owner2Id = reg2.json && reg2.json.id;

    const login2 = await req('POST', '/api/owners/login', { body: { email: email2, password } });
    assert('POST /api/owners/login owner2', login2.status === 200 && Boolean(login2.json.token), `status=${login2.status}`);
    const token2 = login2.json && login2.json.token;

    const unauthCreate = await req('POST', '/api/agents', { body: { agent_name: 'No Auth' } });
    assert('POST /api/agents unauthorized', unauthCreate.status === 401, `status=${unauthCreate.status}`);

    const missingName = await req('POST', '/api/agents', { token: token1, body: { owner_id: owner1Id } });
    assert('POST /api/agents missing agent_name', missingName.status === 400, `status=${missingName.status}`);

    const emptyName = await req('POST', '/api/agents', { token: token1, body: { agent_name: '   ' } });
    assert('POST /api/agents empty agent_name', emptyName.status === 400, `status=${emptyName.status}`);

    const otherOwner = await req('POST', '/api/agents', {
        token: token1,
        body: { agent_name: 'Hijack', owner_id: owner2Id }
    });
    assert('POST /api/agents other owner_id', otherOwner.status === 403, `status=${otherOwner.status}`);

    const badOwnerId = await req('POST', '/api/agents', {
        token: token1,
        body: { agent_name: 'Bad Owner', owner_id: 'abc' }
    });
    assert('POST /api/agents invalid owner_id', badOwnerId.status === 400, `status=${badOwnerId.status}`);

    const protectedCreate = await req('POST', '/api/agents', {
        token: token1,
        body: { agent_name: 'Cheat', reputation_score: 99 }
    });
    assert('POST /api/agents protected reputation_score', protectedCreate.status === 400, `status=${protectedCreate.status}`);

    const created = await req('POST', '/api/agents', {
        token: token1,
        body: {
            agent_name: 'Alpha Bot',
            owner_id: owner1Id,
            is_active: true,
            kill_switch: false
        }
    });
    const agent = created.json;
    const createOk = created.status === 201
        && agent
        && agent.agent_name === 'Alpha Bot'
        && agent.owner_id === owner1Id
        && typeof agent.api_key === 'string'
        && agent.api_key.startsWith('ap_')
        && agent.api_key.length > 20
        && agent.is_active === true
        && agent.kill_switch === false
        && Number(agent.reputation_score) === 50;
    assert('POST /api/agents create', createOk, `status=${created.status} id=${agent && agent.id}`);
    const agentId = agent && agent.id;
    const apiKeyOnce = agent && agent.api_key;

    const listed = await req('GET', '/api/agents');
    const listedAgent = Array.isArray(listed.json) && listed.json.find((a) => a.id === agentId);
    assert(
        'GET /api/agents list',
        listed.status === 200 && Array.isArray(listed.json) && Boolean(listedAgent) && !Object.prototype.hasOwnProperty.call(listedAgent, 'api_key'),
        `status=${listed.status} hasApiKey=${listedAgent && Object.prototype.hasOwnProperty.call(listedAgent, 'api_key')}`
    );

    const one = await req('GET', `/api/agents/${agentId}`);
    assert(
        'GET /api/agents/:id',
        one.status === 200 && one.json.id === agentId && one.json.agent_name === 'Alpha Bot' && !Object.prototype.hasOwnProperty.call(one.json, 'api_key'),
        `status=${one.status}`
    );

    const missing = await req('GET', '/api/agents/999999');
    assert('GET /api/agents/:id not found', missing.status === 404, `status=${missing.status}`);

    const badId = await req('GET', '/api/agents/abc');
    assert('GET /api/agents/:id invalid id', badId.status === 400, `status=${badId.status}`);

    const patchUnauth = await req('PATCH', `/api/agents/${agentId}`, { body: { agent_name: 'X' } });
    assert('PATCH /api/agents/:id unauthorized', patchUnauth.status === 401, `status=${patchUnauth.status}`);

    const patchOther = await req('PATCH', `/api/agents/${agentId}`, {
        token: token2,
        body: { agent_name: 'Stolen' }
    });
    assert('PATCH /api/agents/:id forbidden other owner', patchOther.status === 403, `status=${patchOther.status}`);

    const patchProtected = await req('PATCH', `/api/agents/${agentId}`, {
        token: token1,
        body: { reputation_score: 99, win_rate: 1, success_rate: 1 }
    });
    assert('PATCH /api/agents/:id protected metrics', patchProtected.status === 400, `status=${patchProtected.status}`);

    const patched = await req('PATCH', `/api/agents/${agentId}`, {
        token: token1,
        body: { agent_name: 'Alpha Bot Renamed', is_active: false, kill_switch: true }
    });
    assert(
        'PATCH /api/agents/:id owner update',
        patched.status === 200
            && patched.json.agent_name === 'Alpha Bot Renamed'
            && patched.json.is_active === false
            && patched.json.kill_switch === true
            && !Object.prototype.hasOwnProperty.call(patched.json, 'api_key'),
        `status=${patched.status}`
    );

    const persisted = await req('GET', `/api/agents/${agentId}`);
    assert(
        'GET persistence after PATCH',
        persisted.status === 200
            && persisted.json.agent_name === 'Alpha Bot Renamed'
            && persisted.json.is_active === false
            && persisted.json.kill_switch === true
            && persisted.json.owner_id === owner1Id
            && !Object.prototype.hasOwnProperty.call(persisted.json, 'api_key'),
        `status=${persisted.status}`
    );

    const delUnauth = await req('DELETE', `/api/agents/${agentId}`);
    assert('DELETE /api/agents/:id unauthorized', delUnauth.status === 401, `status=${delUnauth.status}`);

    const delOther = await req('DELETE', `/api/agents/${agentId}`, { token: token2 });
    assert('DELETE /api/agents/:id forbidden other owner', delOther.status === 403, `status=${delOther.status}`);

    const deleted = await req('DELETE', `/api/agents/${agentId}`, { token: token1 });
    assert('DELETE /api/agents/:id owner', deleted.status === 200 && deleted.json.id === agentId, `status=${deleted.status}`);

    const gone = await req('GET', `/api/agents/${agentId}`);
    assert('GET deleted agent', gone.status === 404, `status=${gone.status}`);

    const health2 = await req('GET', '/api/health');
    assert('GET /api/health still ok', health2.status === 200, `status=${health2.status}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
    if (apiKeyOnce) {
        console.log('api_key issued on create only (length):', apiKeyOnce.length);
    }
    if (failed.length) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('TEST RUNNER ERROR:', err);
    process.exit(1);
});
