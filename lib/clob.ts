// Live trading via Polymarket's CLOB, signed by a dedicated bot wallet.
//
// Custody model: a fresh Polygon EOA used only by this app. Its private key
// lives in the POLY_BOT_PRIVATE_KEY env var; fund it with a capped amount of
// USDC.e (+ a little POL for gas) so the blast radius is limited. Live
// execution is gated to LIVE_OPERATOR_USERNAME. See LIVE_TRADING.md.

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Contract, Wallet, constants, providers } from 'ethers';

const CLOB_HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon mainnet

// Polymarket contracts on Polygon
export const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e
export const CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
export const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const ERC1155_ABI = [
  'function isApprovedForAll(address,address) view returns (bool)',
  'function setApprovalForAll(address,bool)',
];

export function isLiveConfigured(): boolean {
  return !!process.env.POLY_BOT_PRIVATE_KEY;
}

export function liveOperator(): string | null {
  return process.env.LIVE_OPERATOR_USERNAME ?? null;
}

export function isLiveOperator(username: string): boolean {
  const op = liveOperator();
  return !!op && op.toLowerCase() === username.toLowerCase();
}

function getProvider() {
  return new providers.JsonRpcProvider(process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com');
}

function getSigner(): Wallet {
  const pk = process.env.POLY_BOT_PRIVATE_KEY;
  if (!pk) throw new Error('POLY_BOT_PRIVATE_KEY not set');
  return new Wallet(pk, getProvider());
}

let cached: { client: ClobClient; address: string } | null = null;

export async function getClobClient(): Promise<{ client: ClobClient; address: string }> {
  if (cached) return cached;
  const signer = getSigner();
  const base = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
  const creds = await base.createOrDeriveApiKey();
  const client = new ClobClient(CLOB_HOST, CHAIN_ID, signer, creds);
  cached = { client, address: await signer.getAddress() };
  return cached;
}

export interface LiveOrderResult {
  orderId: string | null;
  status: string;
  price: number;
  raw: unknown;
}

// Marketable order: BUY spends `amount` USD, SELL disposes `amount` shares.
// FAK (fill-and-kill) so partial fills land and the rest cancels.
export async function placeMarketOrder(tokenId: string, side: 'BUY' | 'SELL', amount: number): Promise<LiveOrderResult> {
  const { client } = await getClobClient();
  const clobSide = side === 'BUY' ? Side.BUY : Side.SELL;
  const priceResp = await client.getPrice(tokenId, clobSide) as unknown;
  const price = Number(
    typeof priceResp === 'object' && priceResp !== null
      ? (priceResp as { price?: string | number }).price ?? 0
      : priceResp ?? 0
  );
  if (!price || price <= 0 || price >= 1) throw new Error(`no marketable price for token (got ${price})`);

  const order = await client.createMarketOrder({
    tokenID: tokenId,
    side: clobSide,
    amount,
    price,
  });
  const resp = await client.postOrder(order, OrderType.FAK) as Record<string, unknown>;
  if (resp && resp.error) throw new Error(String(resp.error));
  return {
    orderId: resp?.orderID ? String(resp.orderID) : null,
    status: resp?.status ? String(resp.status) : 'submitted',
    price,
    raw: resp,
  };
}

export interface BotStatus {
  configured: boolean;
  operator: string | null;
  address: string | null;
  usdc: number;
  pol: number;
  approvals: { usdc: boolean; ctf: boolean };
}

export async function getBotStatus(): Promise<BotStatus> {
  if (!isLiveConfigured()) {
    return { configured: false, operator: liveOperator(), address: null, usdc: 0, pol: 0, approvals: { usdc: false, ctf: false } };
  }
  const provider = getProvider();
  const signer = getSigner();
  const address = await signer.getAddress();
  const usdcC = new Contract(USDC, ERC20_ABI, provider);
  const ctfC = new Contract(CTF, ERC1155_ABI, provider);

  const [usdcBal, polBal, a1, a2, a3, s1, s2, s3] = await Promise.all([
    usdcC.balanceOf(address),
    provider.getBalance(address),
    usdcC.allowance(address, CTF_EXCHANGE),
    usdcC.allowance(address, NEG_RISK_EXCHANGE),
    usdcC.allowance(address, NEG_RISK_ADAPTER),
    ctfC.isApprovedForAll(address, CTF_EXCHANGE),
    ctfC.isApprovedForAll(address, NEG_RISK_EXCHANGE),
    ctfC.isApprovedForAll(address, NEG_RISK_ADAPTER),
  ]);

  return {
    configured: true,
    operator: liveOperator(),
    address,
    usdc: Number(usdcBal.toString()) / 1e6,
    pol: Number(polBal.toString()) / 1e18,
    approvals: {
      usdc: [a1, a2, a3].every(a => a.gt(0)),
      ctf: Boolean(s1) && Boolean(s2) && Boolean(s3),
    },
  };
}

// One-time allowance setup: approve USDC + conditional tokens to Polymarket's
// exchange contracts. Requires POL in the bot wallet for gas. Idempotent.
export async function setupAllowances(): Promise<{ txs: string[] }> {
  const signer = getSigner();
  const address = await signer.getAddress();
  const usdcC = new Contract(USDC, ERC20_ABI, signer);
  const ctfC = new Contract(CTF, ERC1155_ABI, signer);
  const spenders = [CTF_EXCHANGE, NEG_RISK_EXCHANGE, NEG_RISK_ADAPTER];
  const txs: string[] = [];

  for (const spender of spenders) {
    const current = await usdcC.allowance(address, spender);
    if (current.isZero()) {
      const tx = await usdcC.approve(spender, constants.MaxUint256);
      await tx.wait();
      txs.push(tx.hash);
    }
    const approved = await ctfC.isApprovedForAll(address, spender);
    if (!approved) {
      const tx = await ctfC.setApprovalForAll(spender, true);
      await tx.wait();
      txs.push(tx.hash);
    }
  }
  return { txs };
}
