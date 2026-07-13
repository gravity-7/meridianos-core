/**
 * multi-tenant — the DI-3a payoff. Proves TWO different tenants coexist in ONE process with NO
 * shared mutable global and NO singleton mutation, purely by passing two different `config`
 * objects to the core functions. This is a stronger claim than `second-tenant.test.mjs` (★②),
 * which proves the composed core CAN run as a non-PV tenant but does so by temporarily mutating
 * a since-deleted ambient config singleton's `.domain` and restoring it afterward (there was no other
 * way — the module-level consts DI-3a eliminates hadn't been un-baked yet). Here, after DI-3a,
 * every core function reads its config from an injected parameter — there is no singleton left
 * at all — so two tenants' calls can be INTERLEAVED in the same process with zero shared mutable
 * state: two independent `resolvePaths()` calls never affect one another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardMd } from '../render.mjs';
import { checkInvariants } from '../validate.mjs';
import { resolvePaths, reviewerFor } from '../config.mjs';

const A = resolvePaths({
  root: '/tmp/tenant-a',
  domain: {
    agents: ['a1', 'a2'],
    prompts: { implRules: ['- A rule'], reviewCriteria: ['- A criterion'] },
    guardrailCheck: null,
    boardTitle: 'A Board',
    riskToAction: { crypto: 'spend_money' },
    knownRiskTags: ['crypto'],
  },
});
const B = resolvePaths({
  root: '/tmp/tenant-b',
  domain: {
    agents: ['b1', 'b2', 'b3'],
    prompts: { implRules: ['- B rule'], reviewCriteria: ['- B criterion'] },
    guardrailCheck: null,
    boardTitle: 'B Board',
    riskToAction: { firmware: 'deploy' },
    knownRiskTags: ['firmware'],
  },
});

const boardA = {
  tasks: [
    { id: 'A-1', type: 'story', title: 'Tenant A story', status: 'ready-for-impl', priority: 1 },
  ],
};
const boardB = {
  tasks: [
    { id: 'B-1', type: 'story', title: 'Tenant B story', status: 'ready-for-impl', priority: 1 },
  ],
};

test('two tenants coexist in one process via injected config alone — no shared mutable global', () => {
  // 1. buildBoardMd: interleave A then B then A again — each call carries its OWN config, so
  //    nothing leaks between them (there is no module-level const/singleton mutation involved).
  const mdA1 = buildBoardMd(boardA, undefined, A);
  const mdB1 = buildBoardMd(boardB, undefined, B);
  const mdA2 = buildBoardMd(boardA, undefined, A);
  assert.match(mdA1, /^# A Board/);
  assert.match(mdB1, /^# B Board/);
  assert.match(mdA2, /^# A Board/, 'A is unaffected by the interleaved B call');
  assert.doesNotMatch(mdA1, /B Board/);
  assert.doesNotMatch(mdB1, /A Board/);

  // 2. checkInvariants: each tenant's OWN risk taxonomy governs — crypto is legal for A, unknown
  //    for B; firmware is legal for B, unknown for A. Interleaved calls prove no shared state.
  const cryptoBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['crypto'] }] };
  const firmwareBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['firmware'] }] };

  assert.equal(checkInvariants(cryptoBoard, undefined, A).length, 0, 'crypto is legal under A\'s taxonomy');
  assert.equal(checkInvariants(firmwareBoard, undefined, B).length, 0, 'firmware is legal under B\'s taxonomy');
  const cryptoUnderB = checkInvariants(cryptoBoard, undefined, B);
  assert.ok(cryptoUnderB.some((p) => /unknown risk_tag 'crypto'/.test(p)), 'crypto is unknown to B');
  const firmwareUnderA = checkInvariants(firmwareBoard, undefined, A);
  assert.ok(firmwareUnderA.some((p) => /unknown risk_tag 'firmware'/.test(p)), 'firmware is unknown to A');

  // 3. reviewerFor: each tenant's OWN roster, never the other tenant's agents.
  assert.equal(reviewerFor('a1', A.domain.agents), 'a2');
  assert.equal(reviewerFor('b1', B.domain.agents), 'b2');

  // 4. Paths diverge per tenant — proving the un-baked path consts actually vary by config.
  assert.ok(A.boardJson.replace(/\\/g, '/').endsWith('tenant-a/.ai/state/board.json'), A.boardJson);
  assert.ok(B.boardJson.replace(/\\/g, '/').endsWith('tenant-b/.ai/state/board.json'), B.boardJson);

  // 5. There is no singleton to leak through — two fresh resolvePaths() calls with the SAME
  //    injected domain are independent values, not references to one shared mutable object.
  const a1 = resolvePaths({ root: '/tmp/tenant-a', domain: A.domain });
  const a2 = resolvePaths({ root: '/tmp/tenant-a', domain: A.domain });
  assert.equal(a1.domain.boardTitle, 'A Board');
  assert.equal(a2.domain.boardTitle, 'A Board');
  assert.notEqual(a1, a2, 'each resolvePaths() call returns its own independent object');
  assert.notEqual(a1.domain, B.domain, 'tenant A and tenant B never share their domain object');
});
