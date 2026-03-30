import { Dubhe, NetworkType, SuiMoveNormalizedModules, Transaction } from '@0xobelisk/sui-client';
import { NETWORK, PACKAGE_ID } from '@/config/contractDeployment';
import { SuiTransactionBlockResponse } from '@0xobelisk/sui-client';
import { submitChannelTransaction } from '@/lib/channel-events';
import { DEFAULT_CHANNEL_URL, DEFAULT_NETWORK_ENDPOINT } from '@/lib/channel-config';
import { getOrCreateBrowserIdentity, setBrowserIdentitySecretKey } from '@/lib/browser-identity';
import {
  clearNumeronProxyContext,
  isNumeronProxyContextActive,
  readNumeronProxyContext,
} from '@/lib/proxy-context';
import contractMetadata from 'contracts/metadata.json';

const ENABLE_CHANNEL_VERBOSE_LOGS = process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS
  ? process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS === 'true'
  : process.env.NODE_ENV !== 'production';
const CHANNEL_NONCE_RETRY_LIMIT = 6;
const DEFAULT_REGISTER_SENDER_BY_NETWORK: Partial<Record<NetworkType, string>> = {
  testnet: '0x250409302c664cee7a9b5b21a8c37e9a1806913e028befc6ff85d34eccc6437f',
};

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
  #channelUrl: string = DEFAULT_CHANNEL_URL;
  #registerSenderAddress: string | null =
    process.env.NEXT_PUBLIC_CHANNEL_REGISTER_SENDER || DEFAULT_REGISTER_SENDER_BY_NETWORK[NETWORK] || null;
  #channelNonceBySender: Map<string, number> = new Map();
  #signingSecretKey: string;

  private constructor() {
    const identity = getOrCreateBrowserIdentity();
    if (NETWORK === 'localnet') {
      this.endpoint = {
        http: 'http://127.0.0.1:4000/graphql',
        ws: 'ws://127.0.0.1:4000/graphql',
        grpc: 'http://127.0.0.1:8080',
      };
    } else if (NETWORK === 'testnet') {
      this.endpoint = DEFAULT_NETWORK_ENDPOINT;
    }

    const dubhe = new Dubhe({
      networkType: NETWORK,
      packageId: PACKAGE_ID,
      secretKey: identity.secretKey,
      metadata: contractMetadata as SuiMoveNormalizedModules,
      channelUrl: this.#channelUrl,
    });
    this.dubhe = dubhe;
    this.network = NETWORK;
    this.#signingSecretKey = identity.secretKey;
    this.#bootstrapAddress = identity.address;
    this.#selectedPlayerAddress = identity.address;
    this.#restoreStoredProxyContext(identity.address);
  }

  #restoreStoredProxyContext(proxyAddress: string) {
    const proxyContext = readNumeronProxyContext();
    if (!proxyContext) {
      return;
    }

    if (!isNumeronProxyContextActive(proxyContext, proxyAddress)) {
      clearNumeronProxyContext();
      return;
    }

    this.#selectedPlayerAddress = proxyContext.ownerAddress;
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
    this.ensureBrowserIdentity();
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
    const identity = setBrowserIdentitySecretKey(secretKey);
    this.dubhe.updateConfig({ secretKey: identity.secretKey });
    this.#signingSecretKey = identity.secretKey;
    this.#bootstrapAddress = identity.address;
    this.#selectedPlayerAddress = identity.address;
    this.#restoreStoredProxyContext(identity.address);
    this.debugLog(`Active signer address: ${identity.address}`);
    return identity.address;
  }

  /**
   * Get the selected player address
   * @returns The currently selected player address or null
   */
  public getSelectedPlayer(): string | null {
    return this.#selectedPlayerAddress;
  }

  public getBootstrapAccount() {
    this.ensureBrowserIdentity();
    return {
      address: this.#bootstrapAddress,
      email: '',
    };
  }

  public setRegisterSenderAddress(address: string | null): void {
    this.#registerSenderAddress = address;
  }

  public getRegisterSenderAddress(): string {
    this.ensureBrowserIdentity();
    return this.#registerSenderAddress || this.#bootstrapAddress;
  }

  public getCurrentAccountContractKey(): string {
    const address = this.getCurrentAccount().address;
    return this.normalizeContractAccountKey(address);
  }

  public getSignerAddress(): string {
    this.ensureBrowserIdentity();
    return this.#bootstrapAddress;
  }

  public getChannelSubmitSenderAddress(): string {
    this.ensureBrowserIdentity();
    const proxyContext = readNumeronProxyContext();
    if (proxyContext && isNumeronProxyContextActive(proxyContext, this.#bootstrapAddress)) {
      return this.#bootstrapAddress;
    }

    return this.getCurrentAccount().address;
  }

  public resetCurrentPlayerToBootstrap(): string {
    this.ensureBrowserIdentity();
    this.#selectedPlayerAddress = this.#bootstrapAddress;
    return this.#selectedPlayerAddress;
  }

  public normalizeContractAccountKey(address: string): string {
    return address.startsWith('0x') ? address.slice(2).toLowerCase() : address;
  }

  public ensureBrowserIdentity() {
    const identity = getOrCreateBrowserIdentity();
    const previousBootstrapAddress = this.#bootstrapAddress;

    if (this.#signingSecretKey !== identity.secretKey) {
      this.dubhe.updateConfig({ secretKey: identity.secretKey });
      this.#signingSecretKey = identity.secretKey;
    }

    this.#bootstrapAddress = identity.address;
    if (!this.#selectedPlayerAddress || this.#selectedPlayerAddress === previousBootstrapAddress) {
      this.#selectedPlayerAddress = identity.address;
    }

    this.#restoreStoredProxyContext(identity.address);

    return identity;
  }

  public getSigningSecretKey(): string {
    return this.ensureBrowserIdentity().secretKey;
  }

  private async reserveChannelNonce(dubheClient: Dubhe, sender: string): Promise<number> {
    const cachedNonce = this.#channelNonceBySender.get(sender);
    if (cachedNonce != null) {
      this.#channelNonceBySender.set(sender, cachedNonce + 1);
      return cachedNonce;
    }

    const nextNonce = await dubheClient.latestNonce({ account: sender });
    this.#channelNonceBySender.set(sender, nextNonce + 1);
    return nextNonce;
  }

  private invalidateChannelNonce(sender: string): void {
    this.#channelNonceBySender.delete(sender);
  }

  private setChannelNonce(sender: string, nextNonce: number): void {
    this.#channelNonceBySender.set(sender, nextNonce);
  }

  private extractExpectedNonce(error: unknown): number | null {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/Invalid nonce: expected (\d+), got (\d+)/i);
    if (!match) {
      return null;
    }

    return Number(match[1]);
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
    const resolvedSender = sender || this.getChannelSubmitSenderAddress();
    tx.setSender(resolvedSender);

    let lastError: unknown = null;

    for (let attempt = 0; attempt < CHANNEL_NONCE_RETRY_LIMIT; attempt += 1) {
      const nonce = await this.reserveChannelNonce(client, resolvedSender);

      try {
        return await submitChannelTransaction({
          channelUrl: this.getChannelUrl(),
          chain: this.detectChainType(resolvedSender),
          sender: resolvedSender,
          tx,
          nonce,
        });
      } catch (error) {
        lastError = error;
        const expectedNonce = this.extractExpectedNonce(error);
        if (expectedNonce == null) {
          this.invalidateChannelNonce(resolvedSender);
          throw error;
        }

        this.debugLog('Retrying channel submit after nonce mismatch', {
          sender: resolvedSender,
          attempt: attempt + 1,
          expectedNonce,
          submittedNonce: nonce,
        });
        this.setChannelNonce(resolvedSender, expectedNonce);

        // Shared admin senders can race across tabs/users; a short backoff gives the
        // next reservation a chance to observe the freshest nonce.
        await new Promise(resolve => window.setTimeout(resolve, 40 * (attempt + 1)));
      }
    }

    this.invalidateChannelNonce(resolvedSender);
    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  }

  public setChannelUrl(channelUrl: string): void {
    this.debugLog(`Setting channel URL to: ${channelUrl}`);
    this.#channelUrl = channelUrl.replace(/\/$/, '');
    this.dubhe.updateConfig({ channelUrl: this.#channelUrl });
  }

  public getChannelUrl(): string {
    return this.#channelUrl;
  }

  private shouldSubmitThroughChannel(): boolean {
    const channelUrl = this.getChannelUrl().toLowerCase();
    return (
      process.env.NEXT_PUBLIC_FORCE_CHANNEL_SUBMIT === 'true' ||
      process.env.NEXT_PUBLIC_ENABLE_NUMERON_DEBUG === 'true' ||
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
        const sender = channelSender || this.getChannelSubmitSenderAddress();
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
