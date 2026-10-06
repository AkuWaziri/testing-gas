# SatoDrops

Tiny programmable rewards powered by Tempo.

## MVP

SatoDrops lets a creator fund a small stablecoin reward, share a claim link, and let eligible recipients claim it on Tempo mainnet.

### Supported stablecoins

- USDC
- USDT
- pathUSD

### Core flow

1. Create a drop
2. Choose stablecoin
3. Set reward per claim
4. Set number of claims
5. Add a short purpose/message
6. Fund the drop
7. Share the claim link
8. Recipient connects a wallet
9. Recipient claims the reward
10. Show the Tempo transaction

### MVP constraints

- Tempo mainnet first
- Exactly three supported stablecoins
- No token creation
- No trading
- No wallet custody
- No social network
- No unnecessary analytics/dashboard complexity

### Product model

A drop contains creator, token, amount per claim, maximum claims, claimed count, optional expiry, message/purpose, funded amount, and claim transaction(s).

The first implementation should keep the contract small and auditable. UI and contract behavior should be built around one core action: **fund a reward, share it, claim it**.

<!-- production rebuild trigger -->


## Mobile wallet connections

SatoDrops uses `@walletconnect/ethereum-provider` for mobile/browser wallet connections. The integration uses a WalletConnect Network Project ID, not a paid Reown AppKit project.

Create/manage the connection project from the free WalletConnect Dashboard:
https://dashboard.walletconnect.com/

Set the resulting Project ID as:

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

The app remains restricted to Tempo mainnet for this connection flow.
