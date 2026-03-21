import { Dubhe, NetworkType, SuiMoveNormalizedModules, Transaction } from '@0xobelisk/sui-client';
import { NETWORK, PACKAGE_ID } from 'contracts/deployment';
import { SuiTransactionBlockResponse } from '@0xobelisk/sui-client';
import contractMetadata from 'contracts/metadata.json';

const CHANNEL_URL =
  process.env.NEXT_PUBLIC_CHANNEL_URL ||
  (NETWORK === 'localnet' ? 'http://127.0.0.1:8080' : 'https://testnet-indexer.numeron.world');
const ENABLE_CHANNEL_VERBOSE_LOGS = process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS
  ? process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS === 'true'
  : process.env.NODE_ENV !== 'production';

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
  #selectedPlayerAddress: string | null = null;
  #bootstrapAddress: string;
  #registerSenderAddress: string | null = process.env.NEXT_PUBLIC_CHANNEL_REGISTER_SENDER || null;
  #channelNonceBySender: Map<string, number> = new Map();

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
      secretKey: PRIVATEKEY ? PRIVATEKEY : undefined,
      metadata: contractMetadata as SuiMoveNormalizedModules,
      channelUrl: CHANNEL_URL,
    });
    this.dubhe = dubhe;
    this.network = NETWORK;
    this.#bootstrapAddress = this.dubhe.getAddress();
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

  private debugLog(...args: unknown[]): void {
    if (!ENABLE_CHANNEL_VERBOSE_LOGS) {
      return;
    }

    console.log('[WalletUtils]', ...args);
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
    this.debugLog(`Setting current player to: ${address}`);
    this.#selectedPlayerAddress = address;
  }

  public setCurrentPlayerSecretKey(secretKey: string): string {
    this.debugLog('Switching signer for current player');
    this.dubhe.updateConfig({ secretKey });
    const address = this.dubhe.getAddress();
    this.#selectedPlayerAddress = address;
    this.debugLog(`Active signer address: ${address}`);
    return address;
  }

  /**
   * Get the selected player address
   * @returns The currently selected player address or null
   */
  public getSelectedPlayer(): string | null {
    return this.#selectedPlayerAddress;
  }

  public getBootstrapAccount() {
    return {
      address: this.#bootstrapAddress,
      email: '',
    };
  }

  public setRegisterSenderAddress(address: string | null): void {
    this.#registerSenderAddress = address;
  }

  public getRegisterSenderAddress(): string {
    return this.#registerSenderAddress || this.#bootstrapAddress;
  }

  private async reserveChannelNonce(dubheClient: Dubhe, sender: string): Promise<number> {
    const cachedNonce = this.#channelNonceBySender.get(sender);
    if (cachedNonce != null) {
      this.#channelNonceBySender.set(sender, cachedNonce + 1);
      return cachedNonce;
    }

    const nextNonce = await dubheClient.latestNonce(sender);
    this.#channelNonceBySender.set(sender, nextNonce + 1);
    return nextNonce;
  }

  private invalidateChannelNonce(sender: string): void {
    this.#channelNonceBySender.delete(sender);
  }

  public async submitTransactionToChannel({
    tx,
    sender,
    dubheClient,
  }: {
    tx: Transaction;
    sender?: string;
    dubheClient?: Dubhe;
  }) {
    const client = dubheClient || this.dubhe;
    const resolvedSender = sender || this.getCurrentAccount().address;
    tx.setSender(resolvedSender);

    const nonce = await this.reserveChannelNonce(client, resolvedSender);

    try {
      return await client.submitToChannel({
        tx,
        sender: resolvedSender,
        nonce,
      });
    } catch (error) {
      this.invalidateChannelNonce(resolvedSender);
      throw error;
    }
  }

  public setChannelUrl(channelUrl: string): void {
    this.debugLog(`Setting channel URL to: ${channelUrl}`);
    this.dubhe.setChannelUrl(channelUrl);
  }

  public getChannelUrl(): string {
    return this.dubhe.getChannelUrl();
  }

  private shouldSubmitThroughChannel(): boolean {
    const channelUrl = this.getChannelUrl().toLowerCase();
    return (
      process.env.NEXT_PUBLIC_FORCE_CHANNEL_SUBMIT === 'true' ||
      channelUrl.startsWith('http://127.0.0.1:') ||
      channelUrl.startsWith('http://localhost:')
    );
  }

  public detectChainType(address: string): 'sui' | 'evm' | 'solana' {
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

    if (address.startsWith('0x') && cleanAddress.length === 64 && /^[0-9a-fA-F]+$/.test(cleanAddress)) {
      return 'sui';
    }

    if (address.startsWith('0x') && cleanAddress.length === 40 && /^[0-9a-fA-F]+$/.test(cleanAddress)) {
      return 'evm';
    }

    if (!address.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'solana';
    }

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
    channelSender,
  }: {
    tx: Transaction;
    onSuccess?: (result: SuiTransactionBlockResponse) => void;
    onError?: (error: Error) => void;
    channelSender?: string;
  }): Promise<SuiTransactionBlockResponse | null> {
    try {
      if (this.shouldSubmitThroughChannel()) {
        const sender = channelSender || this.getCurrentAccount().address;
        const result = await this.submitTransactionToChannel({
          tx,
          sender,
          dubheClient: this.dubhe,
        });
        this.debugLog('Transaction submitted successfully:', result);
        const channelResult = {
          digest: result.data?.tx_digest ?? '',
        } as unknown as SuiTransactionBlockResponse;

        if (onSuccess) {
          onSuccess(channelResult);
        }

        return channelResult;
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
    this.debugLog('Logout not needed');
  }

  /**
   * Redirect to authentication page
   */
  public redirectToAuth(): void {
    // No authentication needed
    this.debugLog('Authentication not needed');
  }
}

// Export utils class singleton
export const walletUtils = WalletUtils.getInstance();
