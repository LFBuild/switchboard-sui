> **Note — this is a fork.** This repository is a fork of [switchboard-xyz/sui](https://github.com/switchboard-xyz/sui), maintained by FullSail for the migration of the TypeScript SDK from `@mysten/sui` v1 to v2. It is not an official Switchboard release. The upstream project is licensed under Apache 2.0; see [`LICENSE`](./LICENSE).

# Switchboard On-Demand on Sui

Switchboard is a multi-chain, permissionless oracle protocol allowing developers to fully control how data is relayed on-chain to their smart contracts.

**Original documentation:** [docs.switchboard.xyz](https://docs.switchboard.xyz)

## Active Deployments

The Switchboard On-Demand service is currently deployed on the following networks:

Sui packages get a new address on every upgrade, so each network has two that matter:

| | Mainnet | Testnet |
| --- | --- | --- |
| **Original package** — what object type tags reference, and what the SDK exports as `ON_DEMAND_*_OBJECT_PACKAGE_ID`. Never changes. | [0xc3c7e6eb…f938ea3](https://suiscan.xyz/mainnet/object/0xc3c7e6eb7202e9fb0389a2f7542b91cc40e4f7a33c02554fec11c4c92f938ea3) | [0xdd96e1c8…cf43ce2](https://suiscan.xyz/testnet/object/0xdd96e1c8d6d61c4642b9b73eefb1021cc5f93f489b794bca11c81d55fcf43ce2) |
| **Latest package** — what Move calls target. Read from the on-chain state object, not hardcoded. | v4 [0xa8108657…c44e210](https://suiscan.xyz/mainnet/object/0xa81086572822d67a1559942f23481de9a60c7709c08defafbb1ca8dffc44e210) | v8 [0x0ea79f9c…3c4ac1e](https://suiscan.xyz/testnet/object/0x0ea79f9c3fa1e3f701885a00bf26f92a297223165f26529767d2f7d1e3c4ac1e) |
| **State object** — the SDK's entry point (`ON_DEMAND_*_STATE_OBJECT_ID`). | [0x93d2a822…2664a791](https://suiscan.xyz/mainnet/object/0x93d2a8222bb2006d16285ac858ec2ae5f644851917504b94debde8032664a791) | [0x2086fdde…b4339ad6](https://suiscan.xyz/testnet/object/0x2086fdde07a8f4726a3fc72d6ef1021343a781d42de6541ca412cf50b4339ad6) |

`SwitchboardClient` resolves the latest package itself, so the only address you normally need is the state object, which the SDK already knows.

## Prerequisites

- **Node.js ≥ 22**
- **`@mysten/sui` v2** — a peer dependency.

## Typescript-SDK Installation

This fork is not published to a registry — it is consumed directly as a git dependency from this public repository. Add it to your project's `package.json`:

```jsonc
{
  "dependencies": {
    "@fullsailfinance/switchboard-sui-sdk-v2": "git+https://github.com/LFBuild/switchboard-sui.git#mysten-sui-v2",
  },
}
```

Or via the CLI:

### Yarn

```bash
yarn add @fullsailfinance/switchboard-sui-sdk-v2@git+https://github.com/LFBuild/switchboard-sui.git#mysten-sui-v2
```

### NPM

```bash
npm install "git+https://github.com/LFBuild/switchboard-sui.git#mysten-sui-v2"
```

### PNPM

```bash
pnpm add "git+https://github.com/LFBuild/switchboard-sui.git#mysten-sui-v2"
```

## Creating an Aggregator and Sending Transactions

Building a feed in Switchboard can be done using the Typescript SDK, or it can be done with the [Switchboard Web App](https://ondemand.switchboard.xyz/sui/mainnet). Visit our [docs](https://docs.switchboard.xyz/docs) for more on designing and creating feeds.

### Building Feeds

```typescript
import {
  CrossbarClient,
  SwitchboardClient,
  Aggregator,
  ON_DEMAND_MAINNET_QUEUE,
  ON_DEMAND_TESTNET_QUEUE,
} from "@fullsailfinance/switchboard-sui-sdk-v2";

// for initial testing and development, you can use the public
// https://crossbar.switchboard.xyz instance of crossbar
const crossbar = new CrossbarClient("https://crossbar.switchboard.xyz");

// ... define some jobs ...

const queue = isMainnetSui ? ON_DEMAND_MAINNET_QUEUE : ON_DEMAND_TESTNET_QUEUE;

// Store some job definition
const { feedHash } = await crossbarClient.store(queue.toBase58(), jobs);

// Create a SwitchboardClient using the SuiClient configured with your favorite RPC on testnet or mainnet
const sb = new SwitchboardClient(suiClient);

// try creating a feed
const feedName = "BTC/USDT";

// Require only one oracle response needed
const minSampleSize = 1;

// Allow update data to be up to 60 seconds old
const maxStalenessSeconds = 60;

// If jobs diverge more than 1%, don't allow the feed to produce a valid update
const maxVariance = 1e9;

// Require only 1 job response
const minJobResponses = 1;

//==========================================================
// Feed Initialization On-Chain
//==========================================================

let transaction = new Transaction();

// add the tx to the PTB
await Aggregator.initTx(sb, transaction, {
  feedHash,
  name: feedName,
  authority: userAddress,
  minSampleSize,
  maxStalenessSeconds,
  maxVariance,
  minResponses: minJobResponses,
});

// Send the transaction
const res = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction,
  options: {
    showEffects: true,
  },
});

// Capture the created aggregator ID
let aggregatorId;
res.effects?.created?.forEach((c) => {
  if (c.reference.objectId) {
    aggregatorId = c.reference.objectId;
  }
});

// Wait for transaction confirmation
await client.waitForTransaction({
  digest: res.digest,
});

// Log the transaction effects
console.log(res);
```

## Updating Feeds

With Switchboard On-Demand, passing the PTB into the feed update method handles the update automatically.

```typescript
const aggregator = new Aggregator(sb, aggregatorId);

// Create the PTB transaction
let feedTx = new Transaction();

// Fetch and log the oracle responses
const response = await aggregator.fetchUpdateTx(feedTx);
console.log("Fetch Update Oracle Response: ", response);

// Send the transaction
const res = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: feedTx,
  options: {
    showEffects: true,
  },
});

// Wait for transaction confirmation
await client.waitForTransaction({
  digest: res.digest,
});

// Log the transaction effects
console.log({ aggregatorId, res });
```

Note: Ensure the Switchboard Aggregator update is the first action in your PTB or occurs before referencing the feed update.

## Adding Switchboard to Move Code

To integrate Switchboard with Move, add the following dependencies to Move.toml:

```toml
[dependencies.Switchboard]
git = "https://github.com/switchboard-xyz/sui.git"
subdir = "on_demand/"
rev = "mainnet" # testnet or mainnet

[dependencies.Sui]
git = "https://github.com/MystenLabs/sui.git"
subdir = "crates/sui-framework/packages/sui-framework"
rev = "framework/mainnet" # testnet or mainnet
# override = true # Uncomment if you need to override the Sui dependency
```

Once dependencies are configured, updated aggregators can be referenced easily.

## Example Move Code for Using Switchboard Values

In the example.move module, use the Aggregator and CurrentResult types to access the latest feed data.

```move
module example::switchboard;

use switchboard::aggregator::{Aggregator, CurrentResult};
use switchboard::decimal::Decimal;

public entry fun use_switchboard_value(aggregator: &Aggregator) {

    // Get the latest update info for the feed
    let current_result = aggregator.current_result();

    // Access various result properties
    let result: Decimal = current_result.result();        // Median result
    let result_u128: u128 = result.value();               // Result as u128
    let min_timestamp_ms: u64 = current_result.min_timestamp_ms(); // Oldest data timestamp
    let max_timestamp_ms: u64 = current_result.max_timestamp_ms(); // Latest data timestamp
    let range: Decimal = current_result.range();          // Range of results
    let mean: Decimal = current_result.mean();            // Average (mean)
    let stdev: Decimal = current_result.stdev();          // Standard deviation
    let max_result: Decimal = current_result.max_result();// Max result
    let min_result: Decimal = current_result.min_result();// Min result
    let neg: bool = result.neg();                         // Check if negative (ignore for prices)

    // Use the computed result as needed...
}
```

This implementation allows you to read and utilize Switchboard data feeds within Move. If you have any questions or need further assistance, please contact the Switchboard team.

## Oracle Quote Integration (New - October 2025 Switchboard Upgrade)

The quote flow provides a more flexible way to consume oracle data by allowing you to create a quote verifier in your program and then fetch quotes on-demand. This approach gives you more control over when and how oracle data is consumed.

### Overview

Quotes work in two main steps:

1. **Create a Quote Verifier**: Set up a verifier in your Move program that can validate oracle quotes
2. **Fetch Quotes**: Use the SDK to fetch oracle consensus data and create quotes that can be used in subsequent transactions

Alternatively you can:

1. **Manually verify and sequence updates**: You can manually check

### Step 1: Creating a Quote Verifier

First, create a quote verifier in your Move program:

```typescript
import { Quote, SwitchboardClient } from "@fullsailfinance/switchboard-sui-sdk-v2";
import { Transaction } from "@mysten/sui/transactions";

const client = new SwitchboardClient(suiClient);
const tx = new Transaction();

// Create a new quote verifier
const verifier = await Quote.createVerifierTx(client, tx, {
  queue: queueId, // The oracle queue ID
});

// Execute the transaction to create the verifier
const result = await suiClient.signAndExecuteTransaction({
  transaction: tx,
  signer: keypair,
});
```

### Step 2: Fetching Quotes

Once you have a verifier, you can fetch quotes using the SDK:

```typescript
import { fetchQuoteUpdate } from "@fullsailfinance/switchboard-sui-sdk-v2";

const tx = new Transaction();

// Fetch quote updates for specific feed hashes
const quotes = await fetchQuoteUpdate(
  client,
  ["0x7418dc6408f5e0eb4724dabd81922ee7b0814a43abc2b30ea7a08222cd1e23ee"], // Feed ID's
  tx,
);

// The quotes object can now be used in subsequent move calls
tx.moveCall({
  target: "YOUR_PACKAGE::your_module::use_quotes",
  arguments: [
    quotes, // The quotes object from fetchQuoteUpdate
    // ... other arguments
  ],
});

// Execute the transaction
const result = await suiClient.signAndExecuteTransaction({
  transaction: tx,
  signer: keypair,
});
```

### Move Integration for Quotes

In your Move code, you can work with quotes using the quote verifier.

```move
module example::quote_consumer;

use switchboard::quote::{Self, QuoteVerifier, Quotes};
use switchboard::decimal::Decimal;

public struct State has key {
    id: UID,
    quote_verifier: QuoteVerifier,
}

// Initialize your program with a quote verifier
public fun init_with_verifier(ctx: &mut TxContext, queue: ID) {
    let verifier = switchboard::quote::new_verifier(ctx, queue);

    transfer::share_object(State {
        id: object::new(ctx),
        quote_verifier: verifier,
    });
}

// Use quotes in your program logic
public entry fun consume_quotes(
    program: &mut State,
    quotes: Quotes,
    ctx: &mut TxContext
) {
    // Verify and extract quote data
    let quote_data = program.quote_verifier.verify_quotes(&quotes);

    // Access individual quotes by feed hash
    let feed_hash = b"7418dc6408f5e0eb4724dabd81922ee7b0814a43abc2b30ea7a08222cd1e23ee";
    if (quote_data.contains(feed_hash)) {
        let quote = quote_data.get(feed_hash);
        let result: Decimal = quote.result();
        let value_u128 = result.value();
        let timestamp: u64 = quote.timestamp_ms();

        // Use the quote data in your program logic...
    };
}
```

# Surge

_coming soon_

**DISCLAIMER: ORACLE CODE AND CORE LOGIC ARE AUDITED - THE AUDIT FOR THIS ON-CHAIN ADAPTER IS PENDING**
