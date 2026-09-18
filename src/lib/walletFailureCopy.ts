/**
 * A WALLET FAILURE, SAID IN A SENTENCE -- the wording for each class `walletError.ts` decides.
 *
 * WHY THE WORDING IS A SEPARATE FILE FROM THE CLASSIFIER
 *
 * `txState.ts` already owns two things this must not duplicate: the five phases, and the rule that
 * EIP-1193 `4001` is a neutral cancellation. A classifier in this file would have to import from
 * `txState.ts` for the code, and `txState.ts` would import the sentence back -- a cycle, in a
 * repository whose F2 argument is that every decision has exactly one home. So the decision lives
 * with the taxonomy (`classifyWalletError` in `src/lib/walletError.ts`, next to the phases) and the
 * WORDING lives here, importing types only.
 *
 * Every sentence names the fact and the next action, in the vocabulary `vaultActions.ts` and
 * `txState.ts` already established: nothing was signed, nothing was sent, both chains named by
 * number, and the next move named. None of them claims a transaction state, because every class
 * here is a failure that happened BEFORE anything was signed.
 */
import type { WalletFailureKind } from './walletError.ts';

/** The two facts every chain-shaped sentence needs, passed in rather than written twice. */
export interface ChainIdentity {
  chainId: number;
  chainName: string;
}

/**
 * THE SENTENCE FOR EACH CLASS, or `null` when the page already says it.
 *
 * `rejected` is `null`: `txState.ts` renders a cancellation in its own neutral box beside the form,
 * and a second sentence about the same fact is exactly the "two places deciding one thing" failure
 * this repository keeps removing. `unknown` is `null` for the same structural reason -- an
 * unclassified failure is what the CALLER's fallback exists for, and a generic line here would make
 * that fallback unreachable and the omission invisible.
 */
export function walletFailureText(kind: WalletFailureKind, where: ChainIdentity): string | null {
  switch (kind) {
    case 'rejected':
      return null;
    case 'already-pending':
      return (
        'The wallet already has a request from this page open. Answer it in the wallet -- nothing '
        + 'here is sent until that one is dealt with, and a second click does not replace it.'
      );
    case 'disconnected':
      return (
        'The wallet disconnected while this request was in flight, so nothing was signed and nothing '
        + `was sent. Reconnect it to chain ${where.chainId} (${where.chainName}) and ask again.`
      );
    case 'chain-not-added':
      return (
        `The wallet does not recognise chain ${where.chainId} (${where.chainName}), which is the `
        + 'chain this deployment is on, so nothing could be sent. Offer that chain to the wallet with '
        + 'the switch control above, then ask again.'
      );
    case 'chain-switch-rejected':
      return (
        `The chain switch was cancelled in the wallet, so the wallet is still not on chain `
        + `${where.chainId} (${where.chainName}). Nothing is sent until it is.`
      );
    case 'insufficient-funds':
      // `BROWSER-TEST-PLAN.md` §5 row 6, which recorded this class as having no copy at all. No gas
      // figure is quoted: this app does not pre-compute gas, so any number written here would be
      // invented, and an invented figure is one a reader acts on.
      return (
        'The account cannot pay the gas for this transaction, so nothing was sent. Gas is paid in '
        + `${where.chainName}'s own coin (chain ${where.chainId}), which is not the vault's asset -- `
        + 'fund the account with that coin and ask again.'
      );
    case 'preflight-reverted':
      return (
        'The chain refused this call as written, so no transaction was sent and no gas was spent. '
        + 'The reason the chain gave is below; a figure this form read may have moved since it did.'
      );
    case 'unknown':
      return null;
  }
}

/**
 * WHAT TO SAY WHEN A CHAIN SWITCH DID NOT HAPPEN.
 *
 * `useSwitchChain` is fired from the wallet panel and from both forms, and its error previously
 * reached nothing at all: measured with a stub wallet that refuses `wallet_switchEthereumChain` with
 * MetaMask's own `4902` sentence (`Unrecognized chain ID "0x14a34". Try adding the chain using
 * wallet_addEthereumChain first.`), the page re-rendered the same "Switch the wallet to chain …"
 * refusal and said nothing about the attempt -- so a reader who clicked the control saw no change
 * and no reason.
 *
 * A CANCELLATION IS NOT `null` HERE, and that is the one place this file differs from the rule
 * above. Declining a chain switch leaves the wallet on a chain where this deployment does not exist,
 * which is a fact the reader needs; and the neutral box in the transaction panel is not rendered at
 * all in this case, because no transaction was ever asked for. So the chain-specific sentence is the
 * only thing that can say it.
 *
 * WHAT THE PAGE CANNOT TELL APART HERE, MEASURED RATHER THAN ASSUMED
 *
 * A wallet that has never seen the deployment's chain answers the switch with MetaMask's
 * `Unrecognized chain ID "0x14a34". Try adding the chain using wallet_addEthereumChain first.`
 * (`4902`), and wagmi's `switchChain` then OFFERS the chain (`wallet_addEthereumChain`) and retries
 * -- which is the feature that sentence asks for. Measured against the stub: the error that reaches
 * the app in that case is the ADD's own `4001`, not the chain's `4902`, so `classifyWalletError`
 * sees a rejection and this function renders the chain-switch sentence. Every refusal on this path
 * therefore says the same true thing -- the switch did not happen, the wallet is still elsewhere,
 * and nothing is sent -- and none of them claims which of the two prompts was declined. Saying more
 * would need the 4902 the layer above discards.
 *
 * The kind is passed in rather than classified here for the reason this whole file exists: one
 * decision, one home -- `classifyWalletError` decides, and this function renders. `4001` reaches
 * here already classified as `rejected` (the wallet does not say WHAT was declined), and the caller
 * knows what it asked for, which is why that case becomes the chain-switch sentence.
 */
export function chainSwitchFailureText(
  err: unknown,
  where: ChainIdentity,
  kind: WalletFailureKind,
): string | null {
  if (err === null || err === undefined) return null;
  if (kind === 'rejected') return walletFailureText('chain-switch-rejected', where);
  return walletFailureText(kind, where);
}
