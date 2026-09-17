# Plan: a signed (gasless) deposit — what the chain allows, and what it would cost to build

**Status: MEASURED, NOT BUILT. Decision: build design A if anything; design C is the right answer to a
different question.** Written 2026-09-18. Nothing in this document has been compiled, deployed or
run — it is a measurement of the deployed token and vault on Base Sepolia, plus the designs those
measurements leave open. Every raw value below was read from the chain in this session and each is
labelled with the block it was pinned to. §7 lists what is still unverified, and that list is not
short.

**Why this document exists.** "Add EIP-712 / permit to the portfolio" was proposed as a cheap way to
broaden it. The cheap part turned out to depend on which primitive applies, and the assumption
behind it — that the vault's own `permit` is the thing to reach for — is wrong for reasons §2 and §3
give as measurements rather than as opinions. The point of this document is to replace a guess with
the two answers the chain actually gives, so that whatever gets built next is chosen rather than
assumed.

---

## 1. What was measured

Chain **84532 (Base Sepolia)**, RPC `https://sepolia.base.org`. All values pinned to block
**`46946828`** (timestamp **`1789661944`**, hash
`0xb33cfbc06d69a31099c1b2069bcf05fb95f4dc862f5cc081cd10dab187c29b2f`) unless a row says otherwise.
Head at the end of the session was `46946859`.

Asset: **`0x036CbD53842c5426634e7929541eC2318f3dCF7e`**. Vault:
**`0x7941438ee07bea4469ccd4bec583e9fb24037f35`**. Account used as the third-party caller in the
negative probes: **`0xC066ac5D385419B1A8c43A0E146fA439837a8B8c`**, which
`eth_getCode` returns `0x` for — an EOA.

### 1.1 The asset's metadata and its EIP-712 instance

| Call | Raw value | Read as |
|---|---|---|
| `name()(string)` | `"USDC"` | USDC |
| `symbol()(string)` | `"USDC"` | USDC |
| `decimals()(uint8)` | `6` | 6 |
| `version()(string)` | `"2"` | the string `"2"` — this is the **EIP-712 domain's `version` field**, not a claim about the contract's semver |
| `DOMAIN_SEPARATOR()(bytes32)` | `0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818` | see below |
| `totalSupply()(uint256)` | `89316279605724804` | 89,316,279.605724804 USDC |
| `paused()(bool)` | `false` | the token is not paused |
| `admin()(address)` | `0xD48f3032f64e3127883FDa62BC2C47C698d6Baf7` | the proxy's admin |
| `implementation()(address)` | `0xd74cc5d436923b8ba2c179b4bCA2841D8A52C5B5` | see below |

**The domain separator's field set, established by recomputing it rather than by reading a label.**
`keccak256(abi.encode(...))` was computed locally with
EIP-712's `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)`
typehash — `0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f` — and the four
fields:

```
typehash    0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f
name        keccak256("USDC") = 0xd6aca1be9729c13d677335161321649cccae6a591554772516700f986f942eaa
version     keccak256("2")    = 0xad7c5bef027816a800da1736444fb58a807ef4c9603b7848673f7e3a68eb14a5
chainId     84532            = 0x0000000000000000000000000000000000000000000000000000000000014a34
contract    0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

result: **`0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818`** — byte-for-byte
equal to the on-chain `DOMAIN_SEPARATOR()`. As a control, the same computation with
`version = keccak256("1")` gives `0x9b1f6b9293a1e717bb96666aa586ec1a6907d8508c44ebe6e8c359667e4f3a54`,
which does **not** match, so the match is not an artefact of a search that would have accepted
several inputs.

That field set answers the question asked of it: it is **the EIP-712 `EIP712Domain` type, in the
five-field form that both EIP-2612 and EIP-3009 use** (both EIPs' own example separators are the same
five fields). It is *not* EIP-5267's extension: `eip712Domain()` reverts
(`execution reverted`, no reason string), so the domain cannot be read through the discovery
interface and must be constructed from `name()`, `version()`, `chainId` and the proxy address, as
above. Reading `chainId` and `verifyingContract` out of the separator rather than assuming them is
also what makes the cross-chain replay story checkable: the separator commits to chain `84532` and to
the **proxy** address, not to the implementation.

**The address is also a proxy, and that matters for one detail.** `eth_getCode` on the asset returns
**1,798 bytes** beginning `0x6080604052…` whose dispatch table is `admin()`, `implementation()`,
`upgradeTo(address)`, `upgradeToAndCall(address,bytes)` and `changeAdmin(address)` — Circle's
`FiatTokenProxy`, reading its implementation from storage slot
`0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3`. The implementation
`0xd74cc5d436923b8ba2c179b4bCA2841D8A52C5B5` is **23,464 bytes**. Calling the implementation directly
returns `name() == ""` (it reads the proxy's storage, which is empty there) and a **different**
`DOMAIN_SEPARATOR()` of `0x421370fcee42eb4972daaa49ec4d315610775b5c90f87297ba050f42f4c2213b` — the
same `name`/`version`/`chainId` with `verifyingContract` = the implementation. So the domain is
constructed per-call from `address(this)` and is not cached, and **the address a signer must commit
to is the proxy `0x036CbD…dCF7e`**, which is the address everyone uses anyway.

### 1.2 EIP-2612 (`permit`): PRESENT

The question was whether the calls revert. None of them revert.

| Call | Raw value | Reading |
|---|---|---|
| `DOMAIN_SEPARATOR()(bytes32)` | `0x71f17a3b…c9818` (exit 0) | present — the first of EIP-2612's three required functions |
| `nonces(address)(uint256)` for `0x2aE746C0ff0295c2da1aC338656F247e9758E034` | `0` (exit 0) | present — the second |
| `nonces(address)(uint256)` for `0x0000000000000000000000000000000000000000` | `0` (exit 0) | present, and answering per-owner |
| `nonces(address)(uint256)` for the vault `0x7941438e…7f35` | `0` (exit 0) | present, per-owner |

`permit` itself is a state-changing function, so it was probed with `eth_call` — which runs the real
code and returns the real revert — rather than by sending a transaction. Three probes, each from
`0x2aE746C0ff0295c2da1aC338656F247e9758E034`:

| Probe | Result |
|---|---|
| `permit(owner=0x2aE7…E034, spender=vault, value=1000000, deadline=9999999999, v=0, r=0x0, s=0x0)` | **`execution reverted: EIP2612: invalid signature`** |
| `permit(owner=0x2aE7…E034, spender=vault, 1000000, 9999999999, v=27, r=0x0, s=0x0)` | **`execution reverted: EIP2612: invalid signature`** |
| `permit(owner=0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3, …)` — a **contract** as `owner` | **`execution reverted: EIP2612: invalid signature`** |

**The third probe is the load-bearing one, and it was designed for that reason.** The three outcomes
are distinguishable: a token that has no `permit` reverts with **no reason string** (measured
separately, below); a token that verifies contract accounts would have reached an ERC-1271
`isValidSignature` staticcall to `0xdb9B1e94…` and reverted with whatever that returned, or returned
`0xffffffff`; a token that only runs `ecrecover` reverts with *its own* reason string for a bad
signature. It returned **the token's own reason string**, so `permit` exists **and** recovers
signatures with `ecrecover` alone, with no contract-account path.

> **Correction to the workspace record, measured.** `erc4626-vault/REQUIREMENTS.md` §0 states
> `ERC-4626 requires EIP-20 and EIP-2612`. ERC-4626's header does list
> `Requires: EIP-20, EIP-2612`, but the body says the opposite of "requires": *"EIP-4626 tokenized
> Vaults **MAY** implement EIP-2612 to improve the UX of approving shares on various integrations"*,
> and the 12-method interface it specifies contains no `permit`. §3's measurement of the deployed
> vault agrees with the body, not with the header line. The row should be corrected to
> "**optional** (the header metadata lists it; the specification makes it a MAY)".

### 1.3 EIP-3009 (`transferWithAuthorization` / `receiveWithAuthorization`): PRESENT, with one part that is not

| Call | Raw value | Reading |
|---|---|---|
| `authorizationState(0x2aE7…E034, 0x00…00)` | `false` (exit 0) | present — and it answers, which is the whole test |
| `authorizationState(0x0000…0000, 0x00…00)` | `false` (exit 0) | present, per-authorizer |
| `cancelAuthorization(0x2aE7…E034, 0x00…00, v=0, r=0, s=0)` from `0x2aE7…E034` | `execution reverted: FiatTokenV2: invalid signature` | the optional function is implemented too |
| `isValidSignature(bytes32,bytes)` — ERC-1271 | `execution reverted` (no reason string) | **NOT implemented** |
| `eip712Domain()` — EIP-5267 | `execution reverted` (no reason string) | **NOT implemented** |

The two "present" answers that matter are the ones that separate *the function exists* from *the
proxy fell through*. A proxy whose fallback delegates to an implementation it cannot find reverts
with **no** reason string; so does an implementation that has no such selector. Both were measured
as the control:

```
0xdeadbeef                        -> Error: server returned an error response: error code 3: execution reverted
0x12345678                        -> Error: server returned an error response: error code 3: execution reverted
```

**no `Error: execution reverted: <reason>` line at all.** Every 3009 probe above came back with a
reason string that names the token's own source (`FiatTokenV2: invalid signature`,
`FiatTokenV2: caller must be the payee`) or, for 2612, the string from Circle's permit module
(`EIP2612: invalid signature`). A reason string cannot come from a function that does not exist.
`authorizationState` was therefore established by its successful return, and the two
authorization-transfer functions by which reason string they produced.

**The one finding here that changes a design.** The ordering of the checks inside
`receiveWithAuthorization` was probed by varying which address was passed as `to`, from the fixed
third-party caller `0xC066ac5D…`:

| Probe (caller is always `0xC066ac5D…`) | Result |
|---|---|
| `receiveWithAuthorization(from=0x2aE7…, to=0x0000…dEaD, …)` | `FiatTokenV2: caller must be the payee` |
| `receiveWithAuthorization(from=0x2aE7…, to=0xC066ac5D… (the caller), …)` | `FiatTokenV2: invalid signature` |
| `transferWithAuthorization(from=0x2aE7…, to=0x0000…dEaD, …)` from `0xC066ac5D…` | `FiatTokenV2: invalid signature` |

Row 2 is the discriminator: changing only `to` — to the caller's own address — moved the revert from
the payee check to the signature check. So **`receiveWithAuthorization` enforces
`to == msg.sender` before it looks at the signature**, and `transferWithAuthorization` has no such
check. Both are exactly what EIP-3009 specifies and what Circle's `FiatTokenV2` implements; the
measurement is what makes it usable as a design constraint rather than as a remembered fact.

### 1.4 The vault: no signature-based entry point exists

`cast selectors` over the deployed runtime bytecode (**5,070 bytes** at
`0x7941438e…7f35`) returns **29 selectors**. Classified by state mutability, with the signature that
hashes to each selector:

| Selector | Signature | Mutability |
|---|---|---|
| `0x6e553f65` | `deposit(uint256,address)` | nonpayable |
| `0x94bf804d` | `mint(uint256,address)` | nonpayable |
| `0xb460af94` | `withdraw(uint256,address,address)` | nonpayable |
| `0xba087652` | `redeem(uint256,address,address)` | nonpayable |
| `0xe203ad06` | `reportYield(uint256)` | nonpayable |
| `0x095ea7b3` | `approve(address,uint256)` | nonpayable |
| `0xa9059cbb` | `transfer(address,uint256)` | nonpayable |
| `0x23b872dd` | `transferFrom(address,address,uint256)` | nonpayable |
| `0xf2fde38b` | `transferOwnership(address)` | nonpayable |
| `0x715018a6` | `renounceOwnership()` | nonpayable |

plus 20 view/pure selectors (`totalAssets`, `totalSupply`, `asset`, `decimals`, `name`, `symbol`,
`balanceOf`, `allowance`, the four `max*`, the four `preview*`, the two `convert*`). Each of the ten
signatures above was hashed with `cast sig` and each hash matches a selector in the bytecode — so
this is the deployed contract's own dispatch table, not the ABI file's opinion of it.

**Among the 29 there is no `permit`, no `nonces`, no `DOMAIN_SEPARATOR`, and no `*WithAuthorization`.**
The vault implements `ERC4626` and `Ownable` and does not inherit OpenZeppelin's `ERC20Permit`, which
is consistent with the source ([`YieldVault.sol`](web3-development-execute/projects/erc4626-vault/src/YieldVault.sol)
is 147 lines, of which the vault's own logic is `reportYield` and `_decimalsOffset`).

> **Correction, added after this document was first published, and left visible rather than deleted.
> The paragraph that stood here claimed the deployment record's ABI omitted five selectors the
> bytecode contains. That claim was WRONG, the record is complete, and the error was mine — a
> mislabelling, not a reading of the record.** When `cast selectors` printed the dispatch table it
> printed a selector on the left and an argument list on the right, and the argument lists for the
> five shapes that share one argument count — `maxMint(address)`, `maxWithdraw(address)`,
> `maxRedeem(address)`, `previewMint(uint256)` and `previewWithdraw(uint256)` — were paired with
> selectors one position away from their own. Five wrong names, then, and "five names I cannot find
> in the ABI" followed from the wrong names rather than from the ABI.
>
> **The check that settles it, and should have been run before the claim was written.** Compute
> `keccak` of each signature the bytecode *claims* and see whether it equals the selector next to it:
>
> | Selector in the bytecode | The name it was given here | `cast sig` of that name | `cast sig` of the *other* candidate |
> |---|---|---|---|
> | `0x0a28a477` | `previewMint(uint256)` | `0xb3d7f6b9` — **differs** | `previewWithdraw(uint256)` → `0x0a28a477` — matches |
> | `0xb3d7f6b9` | `maxMint(address)` | `0xc63d75b6` — **differs** | `previewMint(uint256)` → `0xb3d7f6b9` — matches |
> | `0xc63d75b6` | `maxWithdraw(address)` | `0xce96cb77` — **differs** | `maxMint(address)` → `0xc63d75b6` — matches |
> | `0xce96cb77` | `maxRedeem(address)` | `0xd905777e` — **differs** | `maxWithdraw(address)` → `0xce96cb77` — matches |
> | `0xd905777e` | `previewWithdraw(uint256)` | `0x0a28a477` — **differs** | `maxRedeem(address)` → `0xd905777e` — matches |
>
> Every row's last column matches. A selector is the first four bytes of the keccak of its
> signature, so a selector that matches a name is that name; five selectors that match under their
> correct names were never missing. Comparing the record's declared functions against the deployed
> dispatch table, computed the same way, gives **29 declared, 29 on chain, 0 bytecode-only, 0
> record-only**.
>
> **`erc4626-vault/deployments/base-sepolia.json` was not changed, and nothing needed changing.** It
> is a canonical record carrying a `sourceCommit`, and the episode is a reason to keep it that way:
> editing it on the strength of a derived claim would have detached it from the artifact it names in
> order to fix a mistake that was in the derivation.

The five functions that were called while checking the claim above all answer, and they are worth
keeping as measured facts about the deployed vault rather than as evidence of a gap: `name()` →
`"Yield Vault Share"`, `symbol()` → `"yvSHARE"`, `asset()` →
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, and `maxDeposit(0x2aE7…E034)` →
`115792089237316195423570985008687907853269984665640564039457584007913129639935`
(`type(uint256).max`, as ERC-4626 requires when there is no limit). One further probe belongs to the
same set and produced a revert rather than a value: `transferFrom(0x2aE7…E034, 0xC066ac5D…, 1)`
called by that owner reverts
`ERC20InsufficientAllowance(0x2aE746C0ff0295c2da1aC338656F247e9758E034, 0, 1)` — which is the
allowance being zero, not a missing function.

**So: `deposit`, `mint`, `withdraw` and `redeem` are not the whole story** (the vault also exposes the
ERC-20 surface, `approve` / `transfer` / `transferFrom` on its own shares, plus ownership transfer),
**and there is no signature-based deposit** either way. A signature-based deposit cannot be a new
call into this vault: `deposit(assets, receiver)` pulls the assets **from `msg.sender`** through
`SafeERC20.safeTransferFrom`, so the only addresses that can deposit are those that already hold the
assets and have approved the vault. A third party cannot be `msg.sender` for someone else's assets.
**It requires a new contract.**

### 1.5 Vault state at the same block, for the arithmetic a relayer would need

| Call | Raw value |
|---|---|
| `totalAssets()(uint256)` | `21000000` (21.0 USDC) |
| `totalSupply()(uint256)` | `21000000000000000000` (21e18) |
| `convertToAssets(1e18)` | `1000000` → **price 1.1** |
| `previewDeposit(1000000)` | `1000000000000000000` (1e18 = 1 share) |
| `decimals()(uint8)` | `18` — shares, not the asset's 6 |
| `owner()(address)` | `0x2aE746C0ff0295c2da1aC338656F247e9758E034` |
| `asset()`'s `balanceOf(vault)` | `21000000` |
| USDC `balanceOf(0x2aE7…E034)` | `19000000` (19.0 USDC) |
| USDC `allowance(0x2aE7…E034 → vault)` | `0` |
| vault `balanceOf(0x2aE7…E034)` | `21000000000000000000` (21e18 = 21 shares) |

The last row is the account whose deposit is the measured example in §5 design C, and the figure is
consistent with the one `BROWSER-TEST-PLAN.md` §5 records (20 → 21). The asset→share ratio moves as
`reportYield` is called, so anything that signs a *share* amount must bind it to a deadline or to a
minimum, which §6 takes up.

---

## 2. Which primitives are available

| Primitive | On this USDC | Evidence |
|---|---|---|
| EIP-2612 `permit` / `nonces` / `DOMAIN_SEPARATOR` | **Yes** | §1.2 — all three answer; `permit` returns its own reason string for a bad signature |
| EIP-3009 `transferWithAuthorization` | **Yes** | §1.3 — own reason string; no payee restriction |
| EIP-3009 `receiveWithAuthorization` | **Yes**, and it enforces `to == msg.sender` | §1.3, row 2 of the ordering probe |
| EIP-3009 `authorizationState` | **Yes** | §1.3 — returns `false`, not a revert |
| EIP-3009 `cancelAuthorization` | **Yes** | §1.3 — own reason string |
| ERC-1271 contract-account signatures | **No** | `isValidSignature` reverts with no reason; §7 records what that does and does not settle |
| EIP-5267 `eip712Domain()` discovery | **No** | reverts; the domain must be built from `name()` / `version()` / `chainId` / address |
| EIP-712 domain, five-field form | **Yes** | §1.1 — recomputed and matched exactly |
| EIP-7702 delegation, on this chain | **Yes, and measured in use** | §5 design C |
| Any signature entry point on the **vault** | **No** | §1.4 — 29 selectors, none of them a signature path |

Two of these are limits rather than capabilities, and both are load-bearing:

**No ERC-1271 means no contract-account signer, at all.** Both `permit` and the two 3009 functions
verify with `ecrecover` only. A Safe, an ERC-4337 smart account, or **an account carrying an EIP-7702
delegation** cannot authorise a 2612 permit or a 3009 authorization that these two paths will accept.
That is not a small caveat here, because §5's design C requires an account that *does* carry a 7702
delegation. Design C and designs A/B/D are therefore not variations on one theme; they are disjoint,
and a user cannot be served by both.

**No EIP-5267 means the domain cannot be discovered.** A signer must be handed
`name = "USDC"`, `version = "2"`, `chainId = 84532` and the proxy address. Three of those four are
constants, but only after being measured — and the failure mode of getting one wrong is a signature
that the token rejects with the token's own "invalid signature" message, which is indistinguishable
from a bug in the signing code.

---

## 3. The viable designs

Four. A, B and D all need a new contract; C needs no contract of ours but needs a delegated
implementation the account must already have. The mechanics below follow from §1's measurements, and
each one names the measurement it rests on.

### A. EIP-3009 into a relayer/router contract

```
user  (off-chain)  signs  ReceiveWithAuthorization {
    from         = user
    to           = ROUTER          <- the payee is the router, not the vault
    value        = assets
    validAfter   = now
    validBefore  = deadline
    nonce        = 32 random bytes
}
relayer            -> ROUTER.depositWithAuthorization(auth, minShares, receiver)
ROUTER             -> USDC.receiveWithAuthorization(auth...)   // works: ROUTER is the payee
ROUTER             -> USDC.approve(vault, assets)
ROUTER             -> vault.deposit(assets, receiver)          // ROUTER is msg.sender, holds the assets
```

- **Why `receiveWithAuthorization` and not `transferWithAuthorization`.** Both exist (§2) and the
  obvious choice is the one without the payee restriction, because a relayer is not the payee. It is
  the wrong choice: EIP-3009's own security section says so, and §1.3 row 2 gives the mechanism. With
  `transferWithAuthorization`, the signed `to` is a parameter of a **public** call, so a watcher can
  consume the authorization with a `to` of its own choosing. If the watcher sets `to` = this router,
  the router receives funds with no user attached and the deposit never happens. If the watcher sets
  `to` = its own contract, the user's funds land in a contract the user never chose. With
  `receiveWithAuthorization`, the check `to == msg.sender` means **only the router can execute the
  user's authorization, and only with `to` = the router** — the token itself enforces that the
  transfer and whatever the router does next are in one transaction.
- **Replay protection is not ours to build.** `authorizationState(user, nonce)` is on the token
  (§1.3) and `nonce` is 32 random bytes, so two authorizations can be outstanding at once. A second
  submission of the same authorization reverts inside the token and therefore reverts the whole
  router transaction — the deposit cannot happen twice. If the signed nonce is also mapped in the
  router, that mapping is redundant; it is worth having only if the router wants to record something
  the token does not.
- **Atomicity is the strongest property of this design.** The router cannot take the funds without
  also depositing them, because `transferFrom`-with-no-receiver does not exist here: the token moves
  the assets as part of the same call. **If the deposit reverts, the transfer reverts**, the
  authorization is not consumed, and the user's signature is still good.
- **Atomicity does not mean trustless.** The user signs an amount to the router; the router then
  chooses `receiver` and the vault call. `receiver` and a minimum-shares bound must therefore be part
  of what the user signs, which means the router verifies **two** signatures: the token's
  authorization and the router's own EIP-712 `DepositIntent`. That is what B is, wearing A's
  clothing — and it is the honest description of this design.
- **What it moves.** The vault's `Deposit` event reports `sender = ROUTER, owner = receiver`. The
  ownership is right and the "who submitted" is the router, which is a fact an indexer already has to
  cope with: `BROWSER-TEST-PLAN.md` §5 records the same shape from the 7702 path, where the deposit's
  `sender` was the user's account and its transaction `from` was a third EOA.

### B. EIP-712 `DepositIntent` + `permit` + `transferFrom`

```
user  (off-chain)  signs  DepositIntent { owner, receiver, assets, minShares, nonce, deadline }
                   and   Permit { owner, spender = ROUTER, value = assets, nonce, deadline }
relayer            -> ROUTER.depositWithIntent(intent, sigIntent, permit, sigPermit)
ROUTER             verifies sigIntent against intent.owner; nonce unused; now <= deadline
ROUTER             -> USDC.permit(intent.owner, address(this), intent.assets, permitDeadline, v, r, s)
ROUTER             -> USDC.transferFrom(intent.owner, address(this), intent.assets)
ROUTER             -> vault.deposit(intent.assets, intent.receiver)
```

- **Two signatures, not one**, unless `permit`'s allowance is already in place from an earlier grant —
  in which case the intent alone is enough and one signature really is enough. Which of the two it is
  depends on the user's history, and the UI has to handle both.
- **The intent is the design's one genuinely new piece of security-critical code**, and it is not
  optional: without it a relayer holds a valid `permit` and can call
  `transferFrom(owner, relayer, value)` and keep the assets. The intent is what converts a blanket
  allowance into a single, bounded instruction.
- **Replay protection is ours to build** — a per-owner nonce in the router, since the token's
  `nonces(owner)` is consumed by the permit and says nothing about the intent. A `DepositIntent`
  signed without a router-side nonce is replayable within its deadline.
- **The permit nonce is the token's problem, and it is sequential.** `nonces(owner)` was `0` for every
  address probed (§1.2). Two intents signed before either is submitted will collide on the permit
  nonce and the second will revert — the exact problem EIP-3009's rationale section says sequential
  nonces have and random 32-byte nonces do not.

### C. EIP-7702 delegated execution (the MetaMask pattern already measured here)

The account `0x2aE746C0ff0295c2da1aC338656F247e9758E034` is not an EOA at `latest`. `eth_getCode`
returns 23 bytes — the whole value is `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b` — which is
EIP-7702's designator `0xef0100` followed by a delegate, and that delegate answers
`NAME() → "EIP7702StatelessDeleGator"`, `VERSION() → "1.3.0"`,
`delegationManager() → 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`,
`entryPoint() → 0x0000000071727De22E5E9d8BAf0edAc6f37da032`. This was re-read in this session and
matches `BROWSER-TEST-PLAN.md` §5's 2026-09-17 amendment exactly. That file's account of the deposit
— a **type `0x4`** transaction to the DelegationManager, whose input begins `0xcef6d209`
(`redeemDelegations(bytes[],bytes32[],bytes[])`) and whose `authorizationList` names the same
delegate — is the measured example, and it is the only measured gasless-style deposit in this
workspace.

What design C would be:

- The user's account **acts as itself**: it holds the assets, it is `msg.sender` to the vault, and the
  vault's `Deposit` event names it as both `sender` and `owner`. No intermediate custody, so the
  atomicity question of A and B does not arise.
- What has to exist: a delegate implementation implementing the user's intent (MetaMask's
  `EIP7702StatelessDeleGator` is one), the delegation lifecycle, and a **submitter** holding ETH. The
  submitter pays for a type-`0x4` transaction. It is not a "sign once, someone else pays" *protocol*
  that can be written in a week; it is that flow inside an existing framework — here, MetaMask's
  Delegation Framework 1.3.0, whose `DelegationManager` also reports `paused() → false`.
- **It cannot be combined with A or B.** A 7702-delegated account is a contract account. §2 measured
  that this USDC has no ERC-1271, so such an account cannot sign a `permit` or a 3009 authorization
  that the token will accept. The 7702 path replaces the token-level signature permission; it does not
  layer on top of it.

### D. `permit` + deposit in one transaction, no intent signature

Get the user's `permit` signature only, and have the router call `USDC.permit(user, router, assets,
deadline, v, r, s)` and then `vault.deposit(assets, receiver)` **with `receiver` chosen by the user at
submit time** — i.e. the intent is not signed, and the router (or the front end's own relayer) is
trusted for the `receiver` leg.

This is the cheapest thing that works and it is the one to reject explicitly. The permit authorises
`value = assets` to the router and says nothing about the vault, so the router may deposit into the
vault for itself, or simply keep the funds. The permit's `deadline` bounds the window, and nothing
else does. It is only defensible when the relayer **is** the user (a self-funded "gasless" mode where
the app's own hot key submits for the app's own user), which is a different product from a relayer
service. Recorded here because it is the design someone will propose as "the simple version", and the
reason it is simple is that it dropped the security property.

### What each design costs the user

| | Signatures | Transactions the user's own key must send | Who ends up in the vault's `Deposit.owner` | Can a contract account use it? |
|---|---|---|---|---|
| A | 2 (3009 authorization + router intent) | 0 | `receiver` (bound by the intent) | no — no ERC-1271 on the token |
| B | 1 or 2 (intent, plus permit if no allowance) | 0 | `receiver` (bound by the intent) | no — same reason |
| C | framework-specific | 0 (the submitter sends the type-`0x4`) | the account itself | **it is** the contract account |
| D | 1 (permit) | 0 | whatever the router decides | no — same reason |

---

## 4. Recommendation

**Worth building, in this order:**

1. **Design A**, with the router intent of design B folded in. It is the only design whose security
   property is enforced by *someone else's* contract — the token's `to == msg.sender` check — rather
   than by code we write and hope to test well, and it needs no allowance, no ordered nonce, and no
   contract-account support. Binding `receiver` and `minShares` into the router-signed intent is not
   optional; without it A degenerates into D.
2. **Design B** as the fallback for users who already have an allowance, or when a 3009 authorization
   is not available. Its extra cost is a router-side nonce and a second signature path.
3. **Design C** if — and only if — the goal is to demonstrate EIP-7702 competence specifically. It is
   the most interesting *system* of the four and the least ours: the measured example ran through
   MetaMask's Delegation Framework, so "building" it means integrating a framework, and the workspace
   has already measured what that looks like without writing any of it.

**A distraction, and worth saying so plainly:**

- **Design D.** It is a design whose security argument is "trust the relayer", presented as a smaller
  version of a design whose security argument is a checked signature. If a relayer is trusted anyway,
  the honest presentation is "a custodial deposit helper", not "gasless deposits".
- **"Adding EIP-712" as a portfolio line by itself.** EIP-712 is the signature *envelope*; the two
  things worth demonstrating are that a specific **primitive** was found to exist on a specific
  deployment (measured, argued from a reason string, with the negative control in §1.3), and that the
  permission it grants is **narrower than the relayer's ability to misuse it**. Learning "how to sign
  typed data with viem" is an afternoon and is not the part an interviewer is probing.
- **A signature-based `redeem`.** The same four designs would be rebuilt for the withdrawal leg, with
  the vault's own share token as the asset — and that token has no `permit` and no 3009 either (§1.4),
  so the withdrawal leg would need an **upgraded vault** (or a share wrapper) rather than a new
  router. It roughly doubles the work for a much weaker demo, because "someone else paid for my
  withdrawal" is not a UX problem anyone has.

**Which of these is worth an interviewer's attention for Web3 backend / blockchain integration /
full-stack dApp roles.** Design A, built and demonstrated end to end, touches every one of them:

| Role signal | What design A exercises |
|---|---|
| blockchain integration | reading a deployed token's real capability instead of its documentation, and designing around the part that is missing (ERC-1271) |
| backend | a relayer service: submission, retry, nonce tracking, gas accounting, replay **rejection** at the application layer, and a refusal path when the intent does not validate |
| full-stack dApp | `eth_signTypedData_v4` in the wallet, the domain built from measured constants, and an error surface that distinguishes a rejected signature from a consumed nonce from a revert |
| security reasoning | the difference between "the relayer cannot steal" (nonce + intent bound to `receiver`) and "the relayer cannot censor" (it can — §6) |

Design C is impressive but is an integration exercise against someone else's framework, and its most
valuable output is the measurement already written down in `BROWSER-TEST-PLAN.md`. It is a good
answer to "what do you know about account abstraction" and a poor answer to "build me a gasless
deposit", because the gasless part is MetaMask's.

---

## 5. Effort, honestly

Calibration from this workspace rather than from a feeling: [`YieldVault.sol`](web3-development-execute/projects/erc4626-vault/src/YieldVault.sol)
is 147 lines and its own logic is roughly 30 of them, and the delivery around it is 2,052 lines
across `YieldVault.t.sol` (32 tests), `YieldVault.invariants.t.sol` (1 invariant test driving five
handler functions), `YieldVaultFork.t.sol` (12 fork tests, all reported as `0 passed; 12 skipped` in
the run made during this session, which is its own unverified item in §7), plus the public site and
the dApp. **The surrounding work is one to two orders of magnitude larger than the contract**, and
the estimates below are dominated by that ratio, not by the Solidity.

| Design | Contract | Everything around it | Realistic total |
|---|---|---|---|
| **A** (3009 + router intent) | ~120–180 lines: `receiveWithAuthorization` passthrough, EIP-712 intent verify, per-owner nonce, `receiver`/`minShares` binding, reentrancy guard. | Fork harness against Base Sepolia with anvil; the EIP-712 signing helper used by *both* the test and the front end (two implementations of the domain is exactly the defect this repo's single-source rule exists for); ~40–60 tests including every negative path in §6; the relayer service; the front-end signing flow; deployment and a record. | **3–5 weeks** for one person working carefully, to the standard the rest of this workspace holds. The contract alone is 2–4 days; the first fork test that signs a real authorization is a day on its own if the domain helper is not already written. |
| **A**, as a demo only | same contract | unit tests + an anvil-fork test with one hard-coded signed authorization; no relayer service, no monitoring, no front end. | **1–1.5 weeks.** This is what "broaden the portfolio" probably costs, and it should be labelled as a demo rather than as a feature. |
| **B** (intent + permit + `transferFrom`) | ~100–150 lines, close to A but with the permit call and a router nonce replacing the token's. | As A, **plus** the permit-versus-allowance branch in the tests and the UI, and the sequential-nonce collision case. | **3–5 weeks**; the marginal cost over A is the second signature path and its two states, not the contract. |
| **D** (permit + deposit, trust the relayer) | ~40 lines. | As A minus the intent tests. | **3–5 days**, and the reason is that it does not do the job. Recorded to show the cost of the property that was dropped. |
| **C** (7702, via a framework) | none of ours — a MetaMask `EIP7702StatelessDeleGator` 1.3.0 is already deployed. | Learning the framework's delegation and redemption data model; a submitter that pays gas; the type-`0x4` submission path; and the fact that §1.3's measured `Deposit` shape is what tests must assert against. | **1–2 weeks for a demonstration**, no upper bound for production, because the submitter becomes an operational component with gas funded by someone. |

Two things are deliberately not in the table and both cost real time: a **relayer's gas economics**
(who funds the submitter, what happens when the balance runs out, and whether the service can be
driven to spend gas on reverting transactions), and **monitoring** — the workspace's own
`delivery-checklists/` names key management, deployment and monitoring as operations that a skill
library does not cover. Neither is a place to be optimistic.

**A floor to state plainly.** The vault this would deposit into is a **testnet deployment holding 21
USDC of test money with no audit**. Any of these designs can be built on it; none of them should be
described as production-ready until the contract has been reviewed by someone other than its author
and the relayer's failure modes have been exercised against a funded submitter.

---

## 6. Security: what a reviewer will ask

Each row is written to be answerable from a measurement in this document or from a named piece of
code, not from an intention.

| Question | Design A | Design B | Design C |
|---|---|---|---|
| **Replay protection** | the token's `authorizationState(user, nonce)` (§1.3). A router-side nonce is also needed for the **intent**, so that a signed intent cannot be reused against a second authorization. | two nonces, and they behave differently: the token's `nonces(owner)` is **sequential** (§1.2) and the router's intent nonce is ours. Submitting intents out of order breaks them. | the framework's `getDelegationHash` / `disabledDelegations`, plus the account's own nonce — the delegation is the replay unit |
| **Nonce / authorization state, and who owns it** | `_authorizationStates[authorizer][nonce]` on the token: we read it, the token writes it, and we never shadow it | `allowance[owner][spender]` on the token for the permit leg, and our own `mapping(owner => nonce)` for the intent leg | the DelegationManager's storage, read through `disabledDelegations` and the delegation hash |
| **Who can submit** | anyone, and that is safe: `receiveWithAuthorization` requires `to == msg.sender` and `to` is the router (§1.3, row 2), so only this router can execute the call, and the router always deposits in the same transaction | anyone holding the intent, bounded by the router's nonce and deadline | the submitter, who pays the gas; the delegation determines what it may do |
| **What the relayer can do with the signature** | **It cannot redirect the funds.** The 3009 transfer's payee is fixed at the router by the token's own check, and the router's `receiver` and `minShares` come from the signed intent. **It can withhold** — refuse to submit and let the deadline pass. That is EIP-2612's own documented residual (signed permits are censorable); the mitigation is a short deadline and a fallback to the ordinary approve+deposit flow, not a contract change. It can also choose **when** to submit, and since the vault's share price is `1.1` and moves with `reportYield` (§1.5), a delay changes the shares received: `minShares` in the intent is what bounds it. | same, plus: a valid permit with **no** intent, or an intent whose `owner`/`receiver` are not checked against the permit's `owner`, is a blanket allowance to the router. The intent check is the whole of the protection and it must be the first thing the function does. | the submitter cannot change what the delegation authorises; it chooses the ordering. The framework's own domain (`getDomainHash()` → `0xe71b8491d8c286677a45fed98624307811de12477341393c8399d0e58648242f`, measured) is what binds it |
| **Is the relayer trusted?** | **Trusted for liveness, not for custody.** Say it in exactly those words: it can decline to submit, and it can delay. It cannot take the assets and it cannot send the shares to someone else. | same, with a larger surface: the router must verify the intent **before** the permit, or the permit leg becomes the blanket allowance above | the submitter is trusted for liveness; the delegation framework is a new dependency with its own audit history and its own admin — `DelegationManager.paused()` was measured `false`, and a `pause` is an availability risk nobody in this design controls |
| **Reentrancy** | the router receives ERC-20s from a token it does not control and then calls a vault it does not control. A `nonReentrant` guard on the entry point, and the intent nonce marked used **before** the external calls. | same, and the `transferFrom` leg makes the ordering matter more | the framework's manager is the caller; the account executes |
| **Slippage / share-price movement** | `minShares` in the signed intent, compared against the value `deposit` returns. Without it, the signature fixes an asset amount and the shares are whatever the pool says at submission time. | same | the framework's execution calldata carries it |
| **Deadline handling** | `validBefore` on the token **and** a deadline on the intent; both must be checked, because a valid intent with an expired authorization reverts at the token and wastes the relayer's gas rather than the user's | same | the delegation's own caveat/expiry |
| **Token-level failure modes that are not ours** | `paused() == true`, a blacklisted sender or recipient, or a zero-amount transfer. `paused()` was measured `false` and the token is upgradeable behind a proxy whose admin is `0xD48f3032f64e3127883FDa62BC2C47C698d6Baf7` (measured) — **which is also a statement that today's measured capability can change without notice.** The router must surface these as their own errors, not as a generic revert. | same | same |
| **What the user is told they signed** | `to = ROUTER` is the single most confusing field, because the user's mental model is "deposit into the vault" and the signature names a router. The signing UI must show the vault address and the router address, and the fact that the funds reach the vault in the same transaction. | the permit's `spender` is the router, and the intent names the vault | the delegation names the delegate |
| **Can a smart-wallet user be served at all?** | **No.** §2: no ERC-1271 on the token. The front end must detect contract-account users and fall back to the ordinary approve+deposit path rather than presenting a signature the token will reject. | No, same reason. | That is the user this design serves |

---

## 7. What is NOT verified

This list is the point of the document as much as the measurements are.

1. **No signature was ever produced or verified against this token.** Every probe in §1.2 and §1.3
   used a deliberately invalid signature and read the revert. **The valid-signature path has not been
   exercised.** What is established is that the code path exists, names itself, and rejects a bad
   signature — the part a wrong signature *cannot* prove, namely that a correct one is accepted and
   the transfer completes, is untested.
2. **`transferWithAuthorization` and `receiveWithAuthorization` have never moved a token here.** No
   `AuthorizationUsed` event exists in this workspace's measurements, and the real event topic
   `0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5` was computed rather than
   observed in a log.
3. **No contract was written, compiled, deployed or tested.** No router, no intent, no test, no relay.
   The line counts in §5 are estimates of a contract that does not exist.
4. **No relayer was run**, so submission, retry, gas accounting and error classification are all
   design text.
5. **`isValidSignature` reverting with no reason string is strong but not decisive evidence of "no
    ERC-1271".** A correct ERC-1271 function reverts on a malformed signature — `bytes` of `0x00` is
   malformed, and a compliant implementation may revert rather than return `0xffffffff`. What the two
   §1.2 probes establish is that `permit` did **not** reach a contract-account verification step for a
   contract `owner`; they do not, on their own, prove that `isValidSignature` is absent. **The
   decisive probe is a valid ERC-1271 signature from a contract that implements it**, and it was not
   run.
6. **~~The five selectors missing from the deployment record's ABI are recorded, not fixed.~~
   RETRACTED — the claim in §1.4 this item referred to was false and has been corrected there.** The
   record declares 29 functions, the deployed bytecode has 29 selectors, and the two sets are equal:
   0 bytecode-only, 0 record-only. The "five missing selectors" were five mislabelled *names* produced
   by this document, and §1.4 now carries the `cast sig` table that shows it. What remains genuinely
   open from that episode is narrow and stated for completeness: **`erc4626-vault`'s
   `web3-development-execute/projects/erc4626-vault/scripts/check-deployment-record.mjs` has no check
   that compares the record's ABI against the deployed dispatch table at all.** It verifies
   the reader-required keys, that `abi` contains the `Deposit` and `Withdraw` **events**, and the
   on-chain facts via a self-contained minimal ABI — so a record whose ABI were genuinely short would
   pass it. That is a real gap in the checker's coverage and it is not something this episode measured;
   it is inferred from reading the script, and the script was not modified.
7. **`erc4626-vault/test/YieldVaultFork.t.sol` reported `0 passed; 12 skipped`** in the run made during
   this session, so **the fork layer was not exercised** and nothing in this document leans on it. The
   reason is a documented design choice, not a defect: `setUp` reads `vm.envOr('MAINNET_RPC_URL', '')`
   and returns early when it is empty, and each test calls `vm.skip(true)` — "offline: every test
   skips". An earlier revision of this item called that behaviour "failing loudly", which is wrong;
   the `revert("MAINNET_RPC_URL not set: fork test must not silently pass")` line that phrase comes
   from belongs to a **different** fixture — this workspace's `toolchain/smoke/` Forge projects, not
   this repository. Corrected here so the two are not conflated again.
8. **No gas measurement.** Every figure a relayer would be sized against — the cost of a 3009 relay
   versus a permit relay, the extra cost of the intent, the cost of a type-`0x4` submission — is
   unmeasured. The §5 estimates are not derived from gas.
9. **The measured 7702 example is quoted, not re-derived.** §3's design C restates
   `BROWSER-TEST-PLAN.md` §5's finding and re-confirms the account's `0xef0100` code and the
   delegation manager's identity; the transaction's type, input and `authorizationList` were **not**
   re-read in this session.
10. **Nothing was changed in the published console.** `/vault/manage` still offers `deposit` and
    `redeem` through `approve` + `deposit`, which is correct and should stay until one of these designs
    is actually built.
11. **The `REQUIREMENTS.md` correction in §1.2 is written here, not applied there.** The workspace
    rule is that a superseded fact gets recorded with its source rather than deleted, so the row should
    be changed in place — that edit has not been made.

---

## Appendix: reproducing the measurements

All commands use this workspace's `cast` at
`web3-development-execute/toolchain/foundry/cast.exe` and `--rpc-url https://sepolia.base.org`.

```powershell
$cast = "web3-development-execute\toolchain\foundry\cast.exe"
$RPC  = "https://sepolia.base.org"
$TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
$VAULT = "0x7941438ee07bea4469ccd4bec583e9fb24037f35"
$A     = "0x2aE746C0ff0295c2da1aC338656F247e9758E034"
$B     = "0xC066ac5D385419B1A8c43A0E146fA439837a8B8c"   # a third-party EOA (eth_getCode -> 0x)
$Z32   = "0x0000000000000000000000000000000000000000000000000000000000000000"
$BLOCK = 46946828

# --- the vault's own dispatch table, straight from the deployed bytecode ---
& $cast selectors (& $cast code $VAULT --rpc-url $RPC)

# --- EIP-2612 present? ---
& $cast call $TOKEN "DOMAIN_SEPARATOR()(bytes32)" --block $BLOCK --rpc-url $RPC
& $cast call $TOKEN "nonces(address)(uint256)" $A --block $BLOCK --rpc-url $RPC
& $cast call $TOKEN "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)" `
      $A $VAULT 1000000 9999999999 0 $Z32 $Z32 --from $A --rpc-url $RPC
#   -> Error: execution reverted: EIP2612: invalid signature

# --- EIP-3009 present? ---
& $cast call $TOKEN "authorizationState(address,bytes32)(bool)" $A $Z32 --block $BLOCK --rpc-url $RPC
#   -> false
& $cast call $TOKEN "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)" `
      $A 0x000000000000000000000000000000000000dEaD 1000000 0 9999999999 $Z32 0 $Z32 $Z32 --from $B --rpc-url $RPC
#   -> Error: execution reverted: FiatTokenV2: caller must be the payee        (to != caller)
& $cast call $TOKEN "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)" `
      $A $B 1000000 0 9999999999 $Z32 0 $Z32 $Z32 --from $B --rpc-url $RPC
#   -> Error: execution reverted: FiatTokenV2: invalid signature              (to == caller: the check order)

# --- the negative control: a selector that plainly does not exist reverts with NO reason ---
& $cast call $TOKEN "0xdeadbeef" --from $A --rpc-url $RPC
#   -> Error: server returned an error response: error code 3: execution reverted

# --- the domain separator, recomputed and compared ---
$enc = & $cast abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" `
  0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f `
  (& $cast keccak "USDC") (& $cast keccak "2") 84532 $TOKEN
& $cast keccak $enc
#   -> 0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818  (matches)
```

Three habits these commands encode, because each one is a mistake that was available here:

- **Probe the negative control.** `0xdeadbeef` and `0x12345678` are called for no other reason than to
  establish what "this function does not exist" sounds like on this proxy, so that a reason string in
  a positive result means something.
- **Pin the block.** `--block 46946828` on every read, so a later reader can reproduce the same numbers
  after `reportYield` has moved the share price again.
- **Prefer a reason string to a theory.** "It said `EIP2612: invalid signature`" is a fact about the
  code path that ran; "USDC supports EIP-2612" is a belief about Circle's documentation, and it happens
  to be true here for reasons the reason string is better at explaining.
