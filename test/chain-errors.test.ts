/**
 * Chain-read failures, and the sentence they become.
 *
 * THE BUG THESE EXIST FOR
 *
 * When the RPC endpoint is down, viem throws an error whose `message` is a full diagnostic
 * dump -- the URL, the JSON-RPC request body, `Raw Call Arguments`, a docs link and a version
 * number. The page rendered that verbatim inside the failure panel. It was found by
 * screenshotting the failure path, not by reading the code: in source it is one `.message`.
 *
 * A screenshot is not a regression test, so this file pins the behaviour: a transport failure
 * must produce a SHORT sentence naming the endpoint, and the dump must be available but
 * separate. The distinction is the whole point -- a reader needs the sentence, whoever
 * debugs it needs the dump, and one must not bury the other.
 *
 * These call the real `readDeployment` with a transport pointed at a closed port, so the
 * error under test is one viem actually produced rather than one constructed to match my
 * assumption about its shape. That assumption was wrong once already.
 *
 * THE ENDPOINT IS PASSED IN, AND THE TESTS GOT SHORTER BECAUSE OF IT
 *
 * They used to set `process.env.VAULT_RPC` and restore it in a `finally`, because the endpoint
 * came from the environment at call time. It is an argument now -- the browser has no
 * request-time environment, see `src/lib/chain.ts` -- so each test states the endpoint it means
 * and there is no global to restore. One test's assertion also became honest: it used to check
 * that the message contains a port that `rpcUrl()` would NOT return, except `rpcUrl()` had
 * already been restored to the default by the time the assertion ran, so the comparison could
 * not fail. With the value in hand, the check is just `assert.equal`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ChainError, readDeployment } from '../src/lib/chain.ts';

/** A port nothing listens on. 9 is the discard port; nothing in this workspace uses it. */
const DEAD = 'http://127.0.0.1:9';

const config = {
  chainId: 31337,
  vault: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as const,
  asset: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const,
};

describe('chain read failures become sentences, not dumps', () => {
  it('a dead endpoint produces a ChainError naming the endpoint', async () => {
    const err = await readDeployment(config, DEAD).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ChainError, `expected a ChainError, got ${String(err)}`);
    assert.equal(err.kind, 'unreachable');
    assert.equal(err.rpcUrl, DEAD);
    assert.match(err.message, /is not reachable/);
    assert.match(err.message, new RegExp(DEAD.replace(/[.:/]/g, '\\$&')));
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE SCREENFUL OF JSON: the reader-facing
    // message must NOT be viem's diagnostic dump.
    assert.ok(!/Raw Call Arguments/.test(err.message), 'the message must not be the viem dump');
    assert.ok(!/viem@/.test(err.message), 'the message must not contain a version banner');
    assert.ok(err.message.length < 300, `the message is ${err.message.length} chars; it should be a sentence`);
    // ...and the dump must still be available, just somewhere else.
    assert.ok(err.detail.length > err.message.length, 'the technical detail must be preserved');
  });

  it('names the transport error as the root cause, which is the actionable part', async () => {
    const err = (await readDeployment(config, DEAD).catch((e: unknown) => e)) as ChainError;
    assert.match(err.detail, /fetch failed|ECONNREFUSED/i, 'the root cause must be searchable in the detail');
  });

  it('the endpoint quoted is the one actually used, not a default', async () => {
    const endpoint = 'http://127.0.0.1:18999';
    const err = (await readDeployment(config, endpoint).catch((e: unknown) => e)) as ChainError;
    assert.equal(err.rpcUrl, endpoint);
    // Quoting the wrong endpoint sends a reader to check a service that is fine.
    assert.ok(err.message.includes('18999'), 'the message must quote the endpoint that was used');
  });
});
