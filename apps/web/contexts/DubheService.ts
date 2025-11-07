import {
  Dubhe,
  loadMetadata,
  NetworkType,
  SuiMoveNormalizedModules,
  SuiTransactionBlockResponse,
  Transaction,
} from '@0xobelisk/sui-client';
import { PACKAGE_ID, NETWORK, DUBHE_SCHEMA_ID } from 'contracts/deployment';
import { InventoryItem, ITEM_EFFECT, ItemCategory, LOCATION_TYPE, Monster } from '@/game/types/typedef';
import { PlayerLocation } from '@/game/utils/data-manager';
import { TILE_SIZE } from '@/game/config';
import { DubheGraphqlClient } from '@0xobelisk/graphql-client';
import { DubheGrpcClient } from '@0xobelisk/grpc-client';
import contractMetadata from 'contracts/metadata.json';
import dubheMetadata from 'contracts/dubhe.config.json';

export interface CraftPath {
  id: string;
  output_item_id: string;
  input_item_ids: string[];
  input_quantities: string[];
  output_quantities: string;
}

export interface ItemMetadata {
  item_id: string;
  description: string;
  icon_url: string;
  is_transferable: boolean;
  item_type: {
    [key: string]: string;
  };
  name: string;
}
/**
 * Wallet Utils Class - Provides methods for game interaction with wallet
 */
export class DubheService {
  dubhe: Dubhe;
  network: NetworkType;
  endpoint: {
    http: string;
    ws: string;
    grpc: string;
  };
  graphqlClient: DubheGraphqlClient;
  grpcClient: DubheGrpcClient;
  #selectedPlayerAddress: string | null = null;

  constructor() {
    let PRIVATEKEY = process.env.NEXT_PUBLIC_PRIVATE_KEY;
    if (NETWORK === 'localnet') {
      this.endpoint = {
        http: 'http://127.0.0.1:4000/graphql',
        ws: 'ws://127.0.0.1:4000/graphql',
        grpc: 'http://127.0.0.1:8080',
      };
    } else if (NETWORK === 'testnet') {
      this.endpoint = {
        http: 'https://testnet-indexer.numeron.world',
        ws: 'wss://testnet-indexer.numeron.world',
        grpc: 'https://testnet-indexer.numeron.world',
      };
    }

    const dubhe = new Dubhe({
      networkType: NETWORK,
      packageId: PACKAGE_ID,
      metadata: contractMetadata as SuiMoveNormalizedModules,
      secretKey: NETWORK === 'localnet' ? PRIVATEKEY : undefined,
    });
    this.dubhe = dubhe;
    this.network = NETWORK;
    this.graphqlClient = new DubheGraphqlClient({
      endpoint: this.endpoint.http,
      dubheMetadata,
    });
    this.grpcClient = new DubheGrpcClient({
      baseUrl: this.endpoint.grpc,
    });
  }

  /**
   * Get current connected wallet account info
   * @returns Account info object or null (if wallet not connected)
   */
  getCurrentAccount() {
    return {
      address: this.#selectedPlayerAddress || this.dubhe.getAddress(),
      email: '',
    };
  }

  /**
   * Set the current player address to control
   * @param address The player address to use for transactions
   */
  setCurrentPlayer(address: string): void {
    console.log(`[DubheService] Setting current player to: ${address}`);
    this.#selectedPlayerAddress = address;
  }

  /**
   * Get the selected player address
   * @returns The currently selected player address or null
   */
  getSelectedPlayer(): string | null {
    return this.#selectedPlayerAddress;
  }

  /**
   * Detect chain type from address format
   * @param address The address to analyze
   * @returns 'sui' | 'evm' | 'solana'
   */
  public detectChainType(address: string): 'sui' | 'evm' | 'solana' {
    // Remove 0x prefix if present for length checking
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

    // Sui address: 0x + 64 hex characters (32 bytes)
    if (address.startsWith('0x') && cleanAddress.length === 64 && /^[0-9a-fA-F]+$/.test(cleanAddress)) {
      return 'sui';
    }

    // EVM address: 0x + 40 hex characters (20 bytes)
    if (address.startsWith('0x') && cleanAddress.length === 40 && /^[0-9a-fA-F]+$/.test(cleanAddress)) {
      return 'evm';
    }

    // Solana address: Base58 encoded, typically 32-44 characters, no 0x prefix
    // Base58 uses characters: 1-9, A-Z, a-z excluding 0, O, I, l
    if (!address.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'solana';
    }

    // Default to sui if can't determine
    console.warn(`Unable to determine chain type for address: ${address}, defaulting to sui`);
    return 'sui';
  }

  public async signAndExecuteTransaction({
    tx,
    onSuccess,
    onError,
  }: {
    tx: Transaction;
    onSuccess?: (result: SuiTransactionBlockResponse) => void;
    onError?: (error: Error) => void;
  }): Promise<SuiTransactionBlockResponse | null> {
    try {
      // Use selected player address if set, otherwise use dubhe address
      const sender = this.getCurrentAccount().address;
      console.log('sui address (selected player):', sender);
      return await this.dubhe.signAndSendTxn({
        tx,
        onSuccess,
        onError,
      });
    } catch (error) {
      console.error('Transaction execution failed:', error);
      return null;
    }
  }

  async getPlayerPosition(): Promise<{ x: number; y: number; location: PlayerLocation }> {
    const playerPosition = await this.graphqlClient.getTableByCondition('position', {
      player: this.getCurrentAccount().address,
    });

    if (playerPosition) {
      return {
        x: Number(playerPosition.x) * TILE_SIZE,
        y: Number(playerPosition.y) * TILE_SIZE,
        location: LOCATION_TYPE[0],
      };
    }
    return { x: 0, y: 0, location: { area: 'main_1', isInterior: false } };
  }

  /**
   * Check if wallet is currently connected
   * @returns Boolean indicating if wallet is connected
   */
  public isWalletConnected(): boolean {
    return true;
  }

  /**
   * Get current connected wallet address
   * @returns Wallet address string or null (if wallet not connected)
   */
  public getWalletAddress(): string | null {
    return this.getCurrentAccount()?.address || null;
  }

  public getEndpoint(): { http: string; ws: string; grpc: string } {
    return this.endpoint;
  }

  /**
   * Get current user's email address
   * @returns Email address string or null (if wallet not connected)
   */
  public getEmailAddress(): string | null {
    return this.getCurrentAccount()?.email || null;
  }

  /**
   * Logout current wallet
   */
  public logout(): void {
    // No wallet connection to logout from
    console.log('Logout not needed');
  }

  /**
   * Redirect to authentication page
   */
  public redirectToAuth(): void {
    // No authentication needed
    console.log('Authentication not needed');
  }
}
