import { bcs, Dubhe, Transaction } from '@0xobelisk/sui-client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const SUI_CLOCK_OBJECT_ID = '0x6';

export type DubheProxyRuntimeStatus = {
  available: boolean;
  reason: string | null;
};

function toEpochMs(expiresAt: number | Date) {
  return expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
}

function strip0x(value: string) {
  return value.startsWith('0x') ? value.slice(2).toLowerCase() : value.toLowerCase();
}

async function hasMoveFunction({
  dubhe,
  packageId,
  module,
  functionName,
}: {
  dubhe: Dubhe;
  packageId: string;
  module: string;
  functionName: string;
}) {
  try {
    await dubhe.client().getNormalizedMoveFunction({
      package: packageId,
      module,
      function: functionName,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getDubheProxyRuntimeStatus({
  dubhe,
  frameworkPackageId,
}: {
  dubhe: Dubhe;
  frameworkPackageId: string;
}): Promise<DubheProxyRuntimeStatus> {
  const hasCreateProxy = await hasMoveFunction({
    dubhe,
    packageId: frameworkPackageId,
    module: 'proxy_system',
    functionName: 'create_proxy',
  });

  if (!hasCreateProxy) {
    return {
      available: false,
      reason: `Framework package ${frameworkPackageId} does not expose proxy_system::create_proxy.`,
    };
  }

  const hasProxyGet = await hasMoveFunction({
    dubhe,
    packageId: frameworkPackageId,
    module: 'proxy_config',
    functionName: 'get',
  });

  if (!hasProxyGet) {
    return {
      available: false,
      reason: `Framework package ${frameworkPackageId} does not expose proxy_config::get.`,
    };
  }

  return { available: true, reason: null };
}

export function buildDubheDappKeyType(packageId: string) {
  return `${strip0x(packageId).padStart(64, '0')}::dapp_key::DappKey`;
}

export async function signDubheProxyMessage({
  ownerAddress,
  proxySecretKey,
  packageId,
  expiresAt,
}: {
  ownerAddress: string;
  proxySecretKey: string;
  packageId: string;
  expiresAt: number | Date;
}) {
  const { secretKey } = decodeSuiPrivateKey(proxySecretKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const publicKey = keypair.getPublicKey().toRawBytes();
  const proxyAddress = keypair.toSuiAddress();
  const message = new TextEncoder().encode(
    `dubhe proxy:${strip0x(ownerAddress)}:${strip0x(proxyAddress)}:${buildDubheDappKeyType(packageId)}:${toEpochMs(
      expiresAt
    ).toString()}`
  );
  const signature = await keypair.sign(message);
  return {
    publicKey,
    signature,
    message,
    proxyAddress,
    expiresAtMs: toEpochMs(expiresAt),
  };
}

export async function appendCreateProxyTx({
  tx,
  dappHubId,
  ownerAddress,
  proxySecretKey,
  packageId,
  frameworkPackageId,
  expiresAt,
}: {
  tx: Transaction;
  dappHubId: string;
  ownerAddress: string;
  proxySecretKey: string;
  packageId: string;
  frameworkPackageId: string;
  expiresAt: number | Date;
}) {
  const signed = await signDubheProxyMessage({
    ownerAddress,
    proxySecretKey,
    packageId,
    expiresAt,
  });

  tx.moveCall({
    target: `${frameworkPackageId}::proxy_system::create_proxy`,
    typeArguments: [buildDubheDappKeyType(packageId)],
    arguments: [
      tx.object(dappHubId),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(signed.publicKey))),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(signed.signature))),
      tx.pure(bcs.u64().serialize(BigInt(signed.expiresAtMs))),
    ],
  });

  return signed;
}

export function appendRemoveProxyTx({
  tx,
  dappHubId,
  proxyAddress,
  packageId,
  frameworkPackageId,
}: {
  tx: Transaction;
  dappHubId: string;
  proxyAddress: string;
  packageId: string;
  frameworkPackageId: string;
}) {
  tx.moveCall({
    target: `${frameworkPackageId}::proxy_system::remove_proxy`,
    typeArguments: [buildDubheDappKeyType(packageId)],
    arguments: [
      tx.object(dappHubId),
      tx.pure(bcs.string().serialize(strip0x(proxyAddress))),
    ],
  });
}

export async function hasDubheProxy({
  dubhe,
  dappHubId,
  proxyAddress,
  packageId,
  frameworkPackageId,
}: {
  dubhe: Dubhe;
  dappHubId: string;
  proxyAddress: string;
  packageId: string;
  frameworkPackageId: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${frameworkPackageId}::proxy_config::has`,
    arguments: [
      tx.object(dappHubId),
      tx.pure(bcs.string().serialize(buildDubheDappKeyType(packageId))),
      tx.pure(bcs.string().serialize(strip0x(proxyAddress))),
    ],
  });
  const result = await dubhe.inspectTxn(tx);
  const bytes = result.results?.[0]?.returnValues?.[0]?.[0];
  return bytes ? bcs.bool().parse(Uint8Array.from(bytes)) : false;
}

export async function getDubheProxyBinding({
  dubhe,
  dappHubId,
  proxyAddress,
  packageId,
  frameworkPackageId,
}: {
  dubhe: Dubhe;
  dappHubId: string;
  proxyAddress: string;
  packageId: string;
  frameworkPackageId: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${frameworkPackageId}::proxy_config::get`,
    arguments: [
      tx.object(dappHubId),
      tx.pure(bcs.string().serialize(buildDubheDappKeyType(packageId))),
      tx.pure(bcs.string().serialize(strip0x(proxyAddress))),
    ],
  });
  const result = await dubhe.inspectTxn(tx);
  const returnValues = result.results?.[0]?.returnValues;
  if (!returnValues || returnValues.length < 2) {
    return null;
  }
  const owner = `0x${bcs.string().parse(Uint8Array.from(returnValues[0][0]))}`;
  const expiresAt = Number(bcs.u64().parse(Uint8Array.from(returnValues[1][0])));
  return { owner, expiresAt };
}

export async function isDubheProxyActive({
  dubhe,
  dappHubId,
  proxyAddress,
  packageId,
  frameworkPackageId,
  clockObjectId = SUI_CLOCK_OBJECT_ID,
}: {
  dubhe: Dubhe;
  dappHubId: string;
  proxyAddress: string;
  packageId: string;
  frameworkPackageId: string;
  clockObjectId?: string;
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${frameworkPackageId}::proxy_system::is_proxy_active`,
    typeArguments: [buildDubheDappKeyType(packageId)],
    arguments: [
      tx.object(dappHubId),
      tx.pure(bcs.string().serialize(strip0x(proxyAddress))),
      tx.object(clockObjectId),
    ],
  });
  const result = await dubhe.inspectTxn(tx);
  const bytes = result.results?.[0]?.returnValues?.[0]?.[0];
  return bytes ? bcs.bool().parse(Uint8Array.from(bytes)) : false;
}
