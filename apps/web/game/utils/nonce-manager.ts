import { walletUtils } from './wallet-utils';

/**
 * Nonce Manager Class - Manages nonce for channel transactions
 */
class NonceManager {
  private static instance: NonceManager;
  private nonce: number = 0;
  private isInitialized: boolean = false;

  private constructor() {}

  /**
   * Get NonceManager singleton instance
   */
  public static getInstance(): NonceManager {
    if (!NonceManager.instance) {
      NonceManager.instance = new NonceManager();
    }
    return NonceManager.instance;
  }

  /**
   * Initialize nonce from the next nonce exposed by channel
   */
  public async initialize(): Promise<void> {
    try {
      const latestNonce = await walletUtils.dubhe.latestNonce({
        account: walletUtils.getCurrentAccount().address,
      });
      console.log('[NonceManager] Latest nonce from chain:', latestNonce);
      
      // latestNonce already returns the next acceptable nonce for this sender.
      this.nonce = Number(latestNonce);
      this.isInitialized = true;
      console.log('[NonceManager] Initialized nonce to:', this.nonce);
    } catch (error) {
      console.error('[NonceManager] Failed to initialize nonce:', error);
      // Fallback to 0 if failed to fetch
      this.nonce = 0;
      this.isInitialized = true;
    }
  }

  /**
   * Get current nonce and increment for next use
   * @returns Current nonce value to use for this transaction
   */
  public async getAndIncrement(): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const currentNonce = this.nonce;
    // Increment nonce after getting current value for next transaction
    this.nonce = this.nonce + 1;
    console.log('[NonceManager] Using nonce:', currentNonce, 'Next nonce will be:', this.nonce);
    return currentNonce;
  }

  /**
   * Reset nonce manager (useful for testing or account switches)
   */
  public reset(): void {
    this.nonce = 0;
    this.isInitialized = false;
    console.log('[NonceManager] Reset nonce manager');
  }

  /**
   * Get current nonce without incrementing
   */
  public getCurrent(): number {
    return this.nonce;
  }
}

export const nonceManager = NonceManager.getInstance();
