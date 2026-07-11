import { Oracle } from './oracle/index.js';
import type { QueueData } from './queue/index.js';
import { Queue } from './queue/index.js';
import { Quote } from './quote/index.js';
import { State } from './state/index.js';

import TTLCache from '@isaacs/ttlcache';
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import { fromBase64 } from '@mysten/sui/utils';
import { BN } from '@switchboard-xyz/common';

export { Oracle, Queue, Quote, State };

// ==============================================================================
// Move value / struct shapes.
//
// In @mysten/sui v2 the JSON-RPC client was removed from `@mysten/sui/client`,
// and with it the `MoveValue` / `MoveStruct` / `SuiObjectResponse` types. We now
// read objects through the transport-agnostic Core API (`ClientWithCoreApi`)
// using the `json` representation. These type aliases reproduce the v1 shapes
// verbatim so the parsing helpers below keep the exact same typing as before.
// ==============================================================================

export interface MoveVariant {
  fields: { [key: string]: MoveValue };
  type: string;
  variant: string;
}

export type MoveStruct =
  | MoveValue[]
  | { fields: { [key: string]: MoveValue }; type: string }
  | { [key: string]: MoveValue };

export type MoveValue =
  | number
  | boolean
  | string
  | MoveValue[]
  | { id: string }
  | MoveStruct
  | null
  | MoveVariant;

/** A single object as returned by the Core API with `include: { json: true }`. */
export type SuiObject = SuiClientTypes.Object<{ json: true }>;

export * from './aggregator/index.js';
export * from './oracle/index.js';
export * from './queue/index.js';
export * from './quote/index.js';
export * from './state/index.js';

export const ON_DEMAND_MAINNET_OBJECT_PACKAGE_ID =
  '0xc3c7e6eb7202e9fb0389a2f7542b91cc40e4f7a33c02554fec11c4c92f938ea3';
export const ON_DEMAND_MAINNET_STATE_OBJECT_ID =
  '0x93d2a8222bb2006d16285ac858ec2ae5f644851917504b94debde8032664a791';
export const ON_DEMAND_TESTNET_OBJECT_PACKAGE_ID =
  '0xdd96e1c8d6d61c4642b9b73eefb1021cc5f93f489b794bca11c81d55fcf43ce2';
export const ON_DEMAND_TESTNET_STATE_OBJECT_ID =
  '0x2086fdde07a8f4726a3fc72d6ef1021343a781d42de6541ca412cf50b4339ad6';

// ==============================================================================
// Caching for Fetch Update Ix

// 1 min cache for sui cache
export const suiQueueCache = new TTLCache<string, QueueData>({
  ttl: 1000 * 60,
});

// ==============================================================================

export interface SwitchboardState {
  switchboardAddress: string;
  guardianQueueId: string;
  oracleQueueId: string;
  mainnet: boolean;
}

export interface CommonOptions {
  switchboardAddress?: string;
  guardianQueueId?: string;
  oracleQueueId?: string;
  chainId?: string;
}

export class SwitchboardClient {
  state: Promise<SwitchboardState | undefined>;

  constructor(readonly client: ClientWithCoreApi) {
    this.state = getSwitchboardState(client);
  }

  /**
   * Fetch the current state of the Switchboard (on-demand package ID, guardian queue ID, oracle queue ID)
   * @param retries Number of retries to fetch the state
   */
  async fetchState(
    options?: CommonOptions,
    retries: number = 3
  ): Promise<SwitchboardState> {
    if (retries <= 0) {
      throw new Error(
        'Failed to fetch Switchboard state after multiple attempts'
      );
    }

    try {
      const state = await this.state;
      if (!state) {
        this.state = getSwitchboardState(this.client, options);
        return this.fetchState(options, retries - 1);
      }

      return {
        switchboardAddress:
          options?.switchboardAddress ?? state.switchboardAddress,
        guardianQueueId: options?.guardianQueueId ?? state.guardianQueueId,
        oracleQueueId: options?.oracleQueueId ?? state.oracleQueueId,
        mainnet: state.mainnet,
      };
    } catch (e: unknown) {
      console.error('Error fetching Switchboard state, retrying...', e);
      return this.fetchState(options, retries - 1);
    }
  }
}

// Helper function to get the Switchboard state
export async function getSwitchboardState(
  client: ClientWithCoreApi,
  options?: CommonOptions
): Promise<SwitchboardState | undefined> {
  try {
    const mainnet = client.core.network === 'mainnet';
    const data = await State.fetch(
      client,
      mainnet
        ? ON_DEMAND_MAINNET_STATE_OBJECT_ID
        : ON_DEMAND_TESTNET_STATE_OBJECT_ID
    );

    return {
      switchboardAddress: options?.switchboardAddress ?? data.onDemandPackageId,
      guardianQueueId: options?.guardianQueueId ?? data.guardianQueue,
      oracleQueueId: options?.oracleQueueId ?? data.oracleQueue,
      mainnet,
    };
  } catch (error) {
    console.error('Failed to retrieve Switchboard state:', error);
  }
}

export function getFieldsFromObject(object: SuiObject): MoveObjectFields {
  // Check that the Core API returned the object's Move fields as JSON
  if (object?.json && typeof object.json === 'object') {
    // Safely return the Move struct 'fields' from the json representation
    return object.json as MoveObjectFields;
  }

  throw new Error('Invalid response data');
}

export class ObjectParsingHelper {
  public static asString(value: MoveValue): string {
    if (typeof value === 'string') {
      return value;
    }
    throw new Error('Invalid Move String');
  }

  public static asNumber(value: MoveValue): number {
    try {
      return parseInt(value as string);
    } catch {
      throw new Error('Invalid Move Number');
    }
  }

  public static asArray(value: MoveValue): MoveValue[] {
    if (Array.isArray(value)) {
      return value;
    }
    throw new Error('Invalid MoveValueArray');
  }

  public static asUint8Array(value: MoveValue): Uint8Array {
    if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
      return new Uint8Array(value as number[]);
    } else if (typeof value === 'string') {
      // fallback because of some changes in the graphql client
      return fromBase64(value);
    }
    throw new Error('Invalid Move Uint8Array');
  }

  public static isBase64(value: MoveValue): boolean {
    return (
      /^[A-Za-z0-9+/]+={0,2}$/.test(value as string) &&
      (value as string).length % 4 === 0
    );
  }

  public static asId(value: MoveValue): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
      const idWrapper = value as { id: string };
      return idWrapper.id;
    }
    throw new Error('Invalid Move Id');
  }

  public static asStruct(value: MoveValue): MoveStruct {
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as MoveStruct;
    }
    throw new Error('Invalid Move Struct');
  }

  // Parse switchboard move decimal into BN, whether or not nested in "fields"
  public static asBN(value: MoveValue): BN {
    if (typeof value !== 'object') {
      throw new Error('Invalid Move BN Input Type');
    }

    const target = 'fields' in value ? value.fields : value;

    if (typeof target === 'object' && 'value' in target && 'neg' in target) {
      return new BN(target.value.toString()).mul(
        target.neg ? new BN(-1) : new BN(1)
      );
    }

    throw new Error('Invalid Move BN');
  }
}

export type MoveObjectFields = {
  [key: string]: MoveValue;
};
