import { z } from 'zod';
import { NETWORK, PACKAGE_ID } from '@/config/contractDeployment';
/*
 * The schema for the client-side environment variables
 * These variables should be defined in the app/.env file
 * These variables are NOT SECRET, they are exposed to the client side
 * They can and should be tracked by Git
 * All of the env variables must have the NEXT_PUBLIC_ prefix
 */
const clientConfigSchema = z.object({
  SUI_NETWORK: z.string(),
  SUI_NETWORK_NAME: z.enum(['localnet', 'mainnet', 'testnet']),
  PACKAGE_ID: z.string(),
});

const clientConfig = clientConfigSchema.parse({
  SUI_NETWORK: NETWORK,
  SUI_NETWORK_NAME: NETWORK,
  PACKAGE_ID: PACKAGE_ID,
});

export default clientConfig;
