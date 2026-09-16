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
    const previous = process.env.VAULT_RPC;
    process.env.VAULT_RPC = DEAD;
    try {
      const err = await readDeployment(config).then(
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
    } finally {
      if (previous === undefined) delete process.env.VAULT_RPC;
      else process.env.VAULT_RPC = previous;
    }
  });

  it('names the transport error as the root cause, which is the actionable part', async () => {
    const previous = process.env.VAULT_RPC;
    process.env.VAULT_RPC = DEAD;
    try {
      const err = (await readDeployment(config).catch((e: unknown) => e)) as ChainError;
      assert.match(err.detail, /fetch failed|ECONNREFUSED/i, 'the root cause must be searchable in the detail');
    } finally {
      if (previous === undefined) delete process.env.VAULT_RPC;
      else process.env.VAULT_RPC = previous;
    }
  });

  it('the endpoint quoted is the one actually used, not a default', async () => {
    const previous = process.env.VAULT_RPC;
    process.env.VAULT_RPC = 'http://127.0.0.1:18999';
    try {
      const err = (await readDeployment(config).catch((e: unknown) => e)) as ChainError;
      assert.equal(err.rpcUrl, 'http://127.0.0.1:18999');
      // Quoting the wrong endpoint sends a reader to check a service that is fine. The first
      // version of this test asserted the message does NOT contain `rpcUrl()` -- but `rpcUrl()`
      // is read at call time from an environment this `finally` has already restored, so it
      // returned the DEFAULT and the comparison was guaranteed to pass. An assertion that
      // cannot fail is worse than no assertion: it reads as coverage.
      assert.ok(err.message.includes('18999'), 'the message must quote the endpoint that was used');
    } finally {
      if (previous === undefined) delete process.env.VAULT_RPC;
      else process.env.VAULT_RPC = previous;
    }
  });
});
