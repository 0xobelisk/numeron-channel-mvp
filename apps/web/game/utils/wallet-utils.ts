import { Dubhe, NetworkType, SuiMoveNormalizedModules, Transaction } from '@0xobelisk/sui-client';
import { NETWORK, PACKAGE_ID } from 'contracts/deployment';
import { SuiTransactionBlockResponse } from '@0xobelisk/sui-client';
import { DubheGraphqlClient } from '@0xobelisk/graphql-client';
import { DubheGrpcClient } from '@0xobelisk/grpc-client';
import contractMetadata from 'contracts/metadata.json';
import dubheMetadata from 'contracts/dubhe.config.json';

/**
 * Wallet Utils Class - Provides methods for game interaction with wallet
 */
class WalletUtils {
  private static instance: WalletUtils;
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

  private constructor() {
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
      secretKey: NETWORK === 'localnet' ? PRIVATEKEY : undefined,
      metadata: contractMetadata as SuiMoveNormalizedModules,
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
   * Get WalletUtils singleton instance
   */
  public static getInstance(): WalletUtils {
    if (!WalletUtils.instance) {
      WalletUtils.instance = new WalletUtils();
    }
    return WalletUtils.instance;
  }

  /**
   * Get current connected wallet account info
   * @returns Account info object or null (if wallet not connected)
   */
  public getCurrentAccount() {
    return {
      address: this.#selectedPlayerAddress || this.dubhe.getAddress(),
      email: '',
    };
  }

  /**
   * Set the current player address to control
   * @param address The player address to use for transactions
   */
  public setCurrentPlayer(address: string): void {
    console.log(`[WalletUtils] Setting current player to: ${address}`);
    this.#selectedPlayerAddress = address;
  }

  /**
   * Get the selected player address
   * @returns The currently selected player address or null
   */
  public getSelectedPlayer(): string | null {
    return this.#selectedPlayerAddress;
  }

  /**
   * Detect chain type from address format
   * @param address The address to analyze
   * @returns 'sui' | 'evm' | 'solana'
   */
  private detectChainType(address: string): 'sui' | 'evm' | 'solana' {
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

  // public async signAndExecuteTransaction({
  //   tx,
  //   onSuccess,
  //   onError,
  // }: {
  //   tx: Transaction;
  //   onSuccess?: (result: SuiTransactionBlockResponse) => void;
  //   onError?: (error: Error) => void;
  // }): Promise<SuiTransactionBlockResponse | null> {
  //   try {
  //     if (this.network === 'localnet') {
  //       console.log('sui address', this.dubhe.getAddress());
  //       return await this.dubhe.signAndSendTxn({
  //         tx,
  //         onSuccess,
  //         onError,
  //       });
  //     }

  //     if (!window.customWallet || !window.customWallet.isConnected) {
  //       console.error('Wallet not connected, please connect first');
  //       return null;
  //     }

  //     return await window.customWallet.signAndExecuteTransaction({
  //       tx,
  //       onSuccess,
  //       onError,
  //     });
  //   } catch (error) {
  //     console.error('Transaction execution failed:', error);
  //     return null;
  //   }
  // }

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
      if (this.network === 'localnet') {
        // Use selected player address if set, otherwise use dubhe address
        const sender = this.getCurrentAccount().address;
        const chain = this.detectChainType(sender);
        console.log('Detected chain type:', chain, 'for address:', sender);

        const nonce = Date.now(); // Use timestamp as nonce
        const ptb = tx.getData();

        // Prepare API request payload
        const payload = {
          chain,
          sender,
          nonce,
          ptb,
          signature: 'base64_encoded_signature_placeholder',
        };

        console.log('Submitting transaction to API:', payload);

        // Submit transaction via API
        const response = await fetch(`${this.endpoint.grpc}/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API request failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        console.log('Transaction submitted successfully:', result);

        if (onSuccess) {
          onSuccess(result);
        }

        return result;
      }

      // For non-localnet environments, use dubhe client directly
      return await this.dubhe.signAndSendTxn({
        tx,
        onSuccess,
        onError,
      });
    } catch (error) {
      console.error('Transaction execution failed:', error);
      if (onError && error instanceof Error) {
        onError(error);
      }
      return null;
    }
  }

  public async blanceOf({ address, coinType }: { address?: string; coinType?: string }) {
    address = address || this.getWalletAddress();
    if (!address) {
      return 0;
    }
    return await this.dubhe.getBalance(coinType);
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
    // return window.customWallet?.address || null;
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
    // return window.customWallet?.emailAddress || null;
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

// Export utils class singleton
export const walletUtils = WalletUtils.getInstance();
