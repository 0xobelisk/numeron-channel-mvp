export type DubheBridgeMethod =
  | 'connect'
  | 'getAccounts'
  | 'signPersonalMessage'
  | 'signTransaction'
  | 'signAndExecuteTransaction';

export type DubheBridgeAccount = {
  address: string;
  publicKey: string;
  chains: string[];
  features: string[];
  label?: string;
};

export type DubheBridgeRequestMap = {
  connect: {
    silent?: boolean;
    accountAddress?: string;
  };
  getAccounts: Record<string, never>;
  signPersonalMessage: {
    message: string;
    accountAddress?: string;
  };
  signTransaction: {
    transaction: string;
    chain: string;
    accountAddress?: string;
  };
  signAndExecuteTransaction: {
    transaction: string;
    chain: string;
    accountAddress?: string;
  };
};

export type DubheBridgeResponseMap = {
  connect: {
    accounts: DubheBridgeAccount[];
  };
  getAccounts: {
    accounts: DubheBridgeAccount[];
  };
  signPersonalMessage: {
    account: DubheBridgeAccount;
    bytes: string;
    signature: string;
  };
  signTransaction: {
    account: DubheBridgeAccount;
    bytes: string;
    signature: string;
  };
  signAndExecuteTransaction: {
    account: DubheBridgeAccount;
    bytes: string;
    signature: string;
    digest: string;
    effects: string;
  };
};

export type DubheBridgeRequest<M extends DubheBridgeMethod = DubheBridgeMethod> = {
  id: string;
  version: 1;
  source: 'dubhe-dapp';
  method: M;
  origin: string;
  requestedAt: string;
  params: DubheBridgeRequestMap[M];
};

export type DubheBridgeSuccessResponse<M extends DubheBridgeMethod = DubheBridgeMethod> = {
  id: string;
  version: 1;
  source: 'dubhe-wallet';
  method: M;
  ok: true;
  result: DubheBridgeResponseMap[M];
};

export type DubheBridgeErrorResponse<M extends DubheBridgeMethod = DubheBridgeMethod> = {
  id: string;
  version: 1;
  source: 'dubhe-wallet';
  method: M;
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type DubheBridgeResponse<M extends DubheBridgeMethod = DubheBridgeMethod> =
  | DubheBridgeSuccessResponse<M>
  | DubheBridgeErrorResponse<M>;

export function createDubheBridgeRequest<M extends DubheBridgeMethod>(
  method: M,
  origin: string,
  params: DubheBridgeRequestMap[M]
): DubheBridgeRequest<M> {
  return {
    id: `dubhe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    source: 'dubhe-dapp',
    method,
    origin,
    requestedAt: new Date().toISOString(),
    params,
  };
}
