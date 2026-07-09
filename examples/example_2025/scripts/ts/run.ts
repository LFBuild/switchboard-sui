/**
 * Switchboard Oracle Quote Verifier Example
 * 
 * This script demonstrates how to:
 * 1. Create a QuoteConsumer with an embedded Quote Verifier
 * 2. Fetch real-time oracle data from Switchboard's oracle network
 * 3. Verify and update the on-chain price using the Quote Verifier
 * 
 * Prerequisites:
 * - Sui CLI installed
 * - Deployed example_2025 contract
 * - Environment variables configured (see .env.example)
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 as fromB64 } from "@mysten/sui/utils";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { SwitchboardClient, Quote } from "@switchboard-xyz/sui-sdk";

// ============================================================================
// Configuration
// ============================================================================

const config = {
  // RPC URL (default: Sui testnet)
  rpcUrl: process.env.SUI_RPC_URL || "https://fullnode.testnet.sui.io:443",

  // Network (mainnet | testnet | devnet | localnet)
  network: (process.env.SUI_NETWORK || "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet"
    | "localnet",

  // Keystore configuration
  keystoreIndex: parseInt(process.env.KEYSTORE_INDEX || "0"),
  
  // Your deployed package address
  examplePackageId: process.env.EXAMPLE_PACKAGE_ID || "0xed9da5e073dc032c6135c95fae89bdcfb2f6e9c6590c2e947926ce887d154480",
  
  // Feed to track (default: BTC/USD)
  feedHash: process.env.FEED_HASH || "0x4cd1cad962425681af07b9254b7d804de3ca3446fbfd1371bb258d2c75059812",
  
  // Number of oracles to query
  numOracles: parseInt(process.env.NUM_ORACLES || "3"),
  
  // Quote Consumer parameters
  maxAgeMs: parseInt(process.env.MAX_AGE_MS || "300000"), // 5 minutes
  maxDeviationBps: parseInt(process.env.MAX_DEVIATION_BPS || "1000"), // 10%
};

// ============================================================================
// Helper Functions
// ============================================================================

function loadKeypair(): Ed25519Keypair {
  try {
    const keystorePath = path.join(
      os.homedir(),
      ".sui",
      "sui_config",
      "sui.keystore"
    );
    const keystore = JSON.parse(fs.readFileSync(keystorePath, "utf-8"));

    if (keystore.length < config.keystoreIndex + 1) {
      throw new Error(`Keystore has fewer than ${config.keystoreIndex + 1} keys.`);
    }

    const secretKey = fromB64(keystore[config.keystoreIndex]);
    return Ed25519Keypair.fromSecretKey(secretKey.slice(1));
  } catch (error) {
    console.error("Error loading keypair:", error);
    throw new Error("Failed to load keypair. Ensure your Sui keystore is set up.");
  }
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  console.log("🚀 Switchboard Oracle Quote Verifier Example\n");
  console.log("Configuration:");
  console.log(`  RPC URL: ${config.rpcUrl}`);
  console.log(`  Package: ${config.examplePackageId}`);
  console.log(`  Feed: ${config.feedHash}`);
  console.log(`  Oracles: ${config.numOracles}\n`);

  // Initialize Sui client
  const client = new SuiGrpcClient({
    baseUrl: config.rpcUrl,
    network: config.network,
  });

  // Initialize Switchboard client and fetch state
  console.log("📡 Connecting to Switchboard...");
  const sb = new SwitchboardClient(client);
  const state = await sb.fetchState();
  
  console.log("✅ Switchboard Connected:");
  console.log(`   Oracle Queue: ${state.oracleQueueId}`);
  console.log(`   Guardian Queue: ${state.guardianQueueId}`);
  console.log(`   Network: ${state.mainnet ? 'Mainnet' : 'Testnet'}\n`);

  // Load user keypair
  const keypair = loadKeypair();
  const userAddress = keypair.getPublicKey().toSuiAddress();
  console.log(`👤 User Address: ${userAddress}\n`);

  // ============================================================================
  // Step 1: Create Quote Consumer
  // ============================================================================

  console.log("📝 Step 1: Creating QuoteConsumer with Quote Verifier...");
  console.log(`   Max Age: ${config.maxAgeMs}ms (${config.maxAgeMs / 1000}s)`);
  console.log(`   Max Deviation: ${config.maxDeviationBps} bps (${config.maxDeviationBps / 100}%)`);

  const createTx = new Transaction();

  // Call create_quote_consumer on your contract
  createTx.moveCall({
    target: `${config.examplePackageId}::example_2025::create_quote_consumer`,
    arguments: [
      createTx.pure.id(state.oracleQueueId),
      createTx.pure.u64(config.maxAgeMs),
      createTx.pure.u64(config.maxDeviationBps),
    ],
  });

  const createRes = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: createTx,
    include: {
      effects: true,
      objectTypes: true,
    },
  });
  const createTxn = createRes.Transaction ?? createRes.FailedTransaction;

  // Extract the QuoteConsumer ID from the response
  let quoteConsumerId: string | null = null;
  for (const change of createTxn.effects?.changedObjects ?? []) {
    const objectType = createTxn.objectTypes?.[change.objectId];
    if (
      change.idOperation === "Created" &&
      objectType?.includes("::example_2025::QuoteConsumer")
    ) {
      quoteConsumerId = change.objectId;
      console.log(`✅ QuoteConsumer Created: ${quoteConsumerId}\n`);
      break;
    }
  }

  if (!quoteConsumerId) {
    throw new Error("❌ Failed to create QuoteConsumer");
  }

  // Wait for object to be available
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ============================================================================
  // Step 2: Fetch Oracle Data
  // ============================================================================

  console.log("🔍 Step 2: Fetching Oracle Data from Switchboard...");
  console.log(`   Feed Hash: ${config.feedHash}`);
  console.log(`   Requesting data from ${config.numOracles} oracles...`);

  const updateTx = new Transaction();

  // Fetch signed oracle data via Crossbar
  // This returns a Quotes object that contains:
  // - Signatures from multiple oracles
  // - Price data for the requested feed
  // - Timestamp and slot information
  const quotes = await Quote.fetchUpdateQuote(sb, updateTx, {
    feedHashes: [config.feedHash],
    numOracles: config.numOracles,
  });

  console.log("✅ Oracle data fetched successfully\n");

  // ============================================================================
  // Step 3: Verify and Update Price
  // ============================================================================

  console.log("🔐 Step 3: Verifying and Updating Price...");
  console.log("   The Quote Verifier will:");
  console.log("   1. Verify oracle signatures");
  console.log("   2. Check quote freshness (<10s old)");
  console.log("   3. Validate price deviation (<10%)");
  console.log("   4. Store the verified price\n");

  // Call update_price on your contract
  // This will trigger the Quote Verifier to validate the oracle data
  updateTx.moveCall({
    target: `${config.examplePackageId}::example_2025::update_price`,
    arguments: [
      updateTx.object(quoteConsumerId), // Your QuoteConsumer object
      quotes, // Signed oracle data from Crossbar
      updateTx.pure.vector("u8", Array.from(Buffer.from(config.feedHash.replace("0x", ""), "hex"))),
      updateTx.object("0x6"), // Sui Clock object
    ],
  });

  const updateRes = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: updateTx,
    include: {
      effects: true,
      events: true,
    },
  });
  const updateTxn = updateRes.Transaction ?? updateRes.FailedTransaction;

  // ============================================================================
  // Display Results
  // ============================================================================

  console.log("📊 Results:\n");

  if (updateTxn.effects?.status.success) {
    console.log("✅ Price Update Successful!");
  } else {
    console.log("❌ Price Update Failed");
    console.log("Status:", updateTxn.effects?.status);
  }

  // Display emitted events
  if (updateTxn.events && updateTxn.events.length > 0) {
    console.log("\n📢 Events Emitted:\n");

    for (const event of updateTxn.events) {
      if (event.eventType.includes("PriceUpdated")) {
        const data = event.json as any;
        console.log("🎯 PriceUpdated Event:");
        console.log(`   Feed Hash: ${Buffer.from(data.feed_hash).toString('hex')}`);
        console.log(`   Old Price: ${data.old_price || 'N/A'}`);
        console.log(`   New Price: ${data.new_price}`);
        console.log(`   Timestamp: ${new Date(parseInt(data.timestamp)).toISOString()}`);
        console.log(`   Oracles Confirmed: ${data.num_oracles}`);
      } else if (event.eventType.includes("QuoteValidationFailed")) {
        const data = event.json as any;
        console.log("⚠️  QuoteValidationFailed Event:");
        console.log(`   Feed Hash: ${Buffer.from(data.feed_hash).toString('hex')}`);
        console.log(`   Reason: ${Buffer.from(data.reason).toString()}`);
        console.log(`   Timestamp: ${new Date(parseInt(data.timestamp)).toISOString()}`);
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✨ Example completed successfully!");
  console.log("=".repeat(80));
  console.log("\nWhat just happened:");
  console.log("1. ✅ Created a QuoteConsumer with a Quote Verifier");
  console.log("2. ✅ Fetched real-time price data from multiple Switchboard oracles");
  console.log("3. ✅ Verified oracle signatures on-chain");
  console.log("4. ✅ Validated price freshness and deviation");
  console.log("5. ✅ Stored the verified price in your contract");
  console.log("\nYour contract now has access to verified, real-time oracle data!");
  console.log(`QuoteConsumer ID: ${quoteConsumerId}`);
}

// Run the script
main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});
