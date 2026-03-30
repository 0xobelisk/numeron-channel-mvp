import type { Transaction } from '@0xobelisk/sui-client';

export type ChannelDeliverySemantics = 'Ephemeral' | 'SnapshotOnly' | 'AtLeastOnce';

export type ChannelFilterValue = string | string[];

export type ChannelCursor = {
  opaque: string;
};

export type ChannelEventEnvelope = {
  id?: string;
  topic: string;
  partition_key?: string;
  kind?: string;
  ts_ms?: number;
  payload?: unknown;
  metadata?: Record<string, string>;
};

export type ChannelSubscriptionSpec = {
  topics?: string[];
  filters?: Record<string, ChannelFilterValue>;
  cursor?: ChannelCursor | null;
  semantics: ChannelDeliverySemantics;
};

export type ChannelPublishEventInput = {
  id?: string;
  topic: string;
  partitionKey: string;
  kind: string;
  tsMs?: number;
  payload?: unknown;
  metadata?: Record<string, string>;
};

export type ChannelChain = 'sui' | 'evm' | 'solana';

export type ChannelSubmitRequest = {
  chain: ChannelChain;
  sender: string;
  nonce: number;
  ptb: unknown;
  signature?: string;
};

export type ChannelSubmitResultData = {
  chain: string;
  sender: string;
  nonce: number;
  tx_digest: string;
  sql_count: number;
};

export type ChannelSubmitResponse = {
  success: boolean;
  message: string;
  data?: ChannelSubmitResultData | null;
};

type ChannelSubscribeHandlers<T> = {
  onOpen?: () => void;
  onMessage?: (data: T) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};

const normalizeChannelUrl = (channelUrl: string) => channelUrl.replace(/\/$/, '');

export const buildChannelDappKey = (packageId: string) =>
  `${packageId.replace(/^0x/, '')}::dapp_key::DappKey`;

export async function publishChannelEvent({
  channelUrl,
  packageId,
  input,
}: {
  channelUrl: string;
  packageId?: string;
  input: ChannelPublishEventInput;
}): Promise<ChannelEventEnvelope> {
  const response = await fetch(`${normalizeChannelUrl(channelUrl)}/v2/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event: {
        id: input.id ?? '',
        topic: input.topic,
        partition_key: input.partitionKey,
        kind: input.kind,
        ts_ms: input.tsMs ?? 0,
        payload: input.payload ?? null,
        metadata: {
          ...(packageId ? { dapp_key: buildChannelDappKey(packageId) } : {}),
          ...(input.metadata ?? {}),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Channel request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as ChannelEventEnvelope;
}

export async function submitChannelTransaction({
  channelUrl,
  sender,
  nonce,
  chain,
  tx,
}: {
  channelUrl: string;
  sender: string;
  nonce: number;
  chain: ChannelChain;
  tx: Transaction;
}): Promise<ChannelSubmitResponse> {
  const txData = (tx as Transaction & { getData: () => unknown }).getData();
  const payload: ChannelSubmitRequest = {
    chain,
    sender,
    nonce,
    ptb: txData,
    signature: 'base64_encoded_signature_placeholder',
  };

  const response = await fetch(`${normalizeChannelUrl(channelUrl)}/v2/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Channel request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as ChannelSubmitResponse;
}

export async function subscribeChannel<T>({
  channelUrl,
  spec,
  handlers = {},
}: {
  channelUrl: string;
  spec: ChannelSubscriptionSpec;
  handlers?: ChannelSubscribeHandlers<T>;
}): Promise<() => void> {
  const controller = new AbortController();
  let isClosed = false;

  const closeOnce = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    handlers.onClose?.();
  };

  const response = await fetch(`${normalizeChannelUrl(channelUrl)}/v2/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ spec }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Channel subscribe failed: ${response.status}`);
  }

  handlers.onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          separatorIndex = buffer.indexOf('\n\n');

          const dataLines = rawEvent
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim());

          if (dataLines.length === 0) {
            continue;
          }

          handlers.onMessage?.(JSON.parse(dataLines.join('\n')) as T);
        }
      }
      closeOnce();
    } catch (error) {
      if (!controller.signal.aborted) {
        handlers.onError?.(error as Error);
      }
      closeOnce();
    }
  })();

  return () => {
    controller.abort();
    closeOnce();
  };
}
