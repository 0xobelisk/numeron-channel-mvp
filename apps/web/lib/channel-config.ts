import { NETWORK } from '@/config/contractDeployment';

const LOCAL_CHANNEL_URL = 'http://127.0.0.1:8080';
const REMOTE_CHANNEL_URL = 'https://channel.obelisk.build';

export const DEFAULT_CHANNEL_URL =
  process.env.NEXT_PUBLIC_CHANNEL_URL || (NETWORK === 'localnet' ? LOCAL_CHANNEL_URL : REMOTE_CHANNEL_URL);

export const DEFAULT_NETWORK_ENDPOINT =
  NETWORK === 'localnet'
    ? {
        http: 'http://127.0.0.1:4000/graphql',
        ws: 'ws://127.0.0.1:4000/graphql',
        grpc: LOCAL_CHANNEL_URL,
      }
    : {
        http: REMOTE_CHANNEL_URL,
        ws: REMOTE_CHANNEL_URL.replace(/^https:/, 'wss:'),
        grpc: REMOTE_CHANNEL_URL,
      };
