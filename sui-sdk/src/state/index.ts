import type { SwitchboardClient } from '../index.js';
import {
  getFieldsFromObject,
  MoveObjectFields,
  ObjectParsingHelper,
} from '../index.js';

import type { ClientWithCoreApi } from '@mysten/sui/client';

export interface StateData {
  id: string;
  guardianQueue: string;
  oracleQueue: string;
  onDemandPackageId: string;
}

export class State {
  constructor(
    readonly client: SwitchboardClient,
    readonly address: string
  ) {}

  /**
   * Get the state data object
   */
  public async loadData(): Promise<StateData> {
    const receivedData = await this.client.client.core
      .getObject({
        objectId: this.address,
        include: { json: true },
      })
      .then(r => getFieldsFromObject(r.object));

    // return the data in camelCase
    return State.parseStateData(receivedData);
  }

  public static parseStateData(receivedData: MoveObjectFields): StateData {
    // build from the result
    return {
      guardianQueue: ObjectParsingHelper.asString(receivedData.guardian_queue),
      id: ObjectParsingHelper.asId(receivedData.id),
      onDemandPackageId: ObjectParsingHelper.asString(
        receivedData.on_demand_package_id
      ),
      oracleQueue: ObjectParsingHelper.asString(receivedData.oracle_queue),
    };
  }

  public static async fetch(
    client: ClientWithCoreApi,
    address: string
  ): Promise<StateData> {
    const receivedData = await client.core
      .getObject({
        objectId: address,
        include: { json: true },
      })
      .then(r => getFieldsFromObject(r.object));
    return State.parseStateData(receivedData);
  }
}
