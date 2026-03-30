'use client';

import React from 'react';
import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@0xobelisk/sui-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import clientConfig from '@/config/clientConfig';
import { NETWORK } from '@/config/contractDeployment';
import '@mysten/dapp-kit/dist/index.css';

export function Providers({ children }: { children: React.ReactNode }) {
  const localnetRpcUrl = process.env.NEXT_PUBLIC_SUI_RPC_URL || getFullnodeUrl('localnet');
  const defaultNetwork = NETWORK === 'devnet' ? 'testnet' : NETWORK;
  const { networkConfig } = createNetworkConfig({
    localnet: { url: localnetRpcUrl },
    testnet: { url: getFullnodeUrl('testnet') },
    mainnet: { url: getFullnodeUrl('mainnet') },
  });

  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={defaultNetwork}>
        <WalletProvider autoConnect storageKey="numeron-wallet">
          <main>{children}</main>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
