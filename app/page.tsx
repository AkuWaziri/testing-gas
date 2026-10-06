"use client";

import { ArrowUpRight, Wallet } from "lucide-react";
import { encodeFunctionData, keccak256, parseUnits, toBytes } from "viem";
import { useState } from "react";

const CHAIN_ID = "0x1079";
const RPC = "https://rpc.tempo.xyz";
const EXPLORER = "https://explore.tempo.xyz";
const CONTRACT = "0x2a6722e0c00DC1BA531BB15c551bF2F080285603";
const GAS_TOKEN = "0x20C0000000000000000000000000000000000000";

const tokens = [
  { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
  { symbol: "USDT", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6 },
  { symbol: "pathUSD", address: GAS_TOKEN, decimals: 6 },
];

const erc20Abi = [{
  type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

const createAbi = [{
  type: "function", name: "createDrop", stateMutability: "nonpayable",
  inputs: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "dropId", type: "uint256" }],
}] as const;

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message || "Tempo RPC error");
  return b.result;
}

async function receipt(hash: string) {
  for (let i = 0; i < 40; i++) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status === "0x0") throw new Error("Transaction reverted on Tempo.");
      return r;
    }
    await new Promise(x => setTimeout(x, 1500));
  }
  throw new Error("Transaction confirmation timed out.");
}

async function connectWallet() {
  if (!window.ethereum) throw new Error("No EVM wallet detected.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  const chain = await window.ethereum.request({ method: "eth_chainId" }) as string;
  if (chain.toLowerCase() !== CHAIN_ID) {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID }],
    });
  }
  return accounts[0];
}

export default function Home() {
  const [token, setToken] = useState(tokens[0]);
  const [amount, setAmount] = useState("5");
  const [account, setAccount] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);

  async function createDrop() {
    setError("");
    setStatus("");
    try {
      setCreating(true);
      const wallet = account || await connectWallet();
      setAccount(wallet);

      const rawAmount = parseUnits(amount, token.decimals);
      if (rawAmount <= 0n) throw new Error("Enter an amount greater than zero.");

      const creationFee = rawAmount / 100n;
      const approval = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACT, rawAmount + creationFee],
      });

      setStatus("Approve the drop funding in your wallet…");
      const approvalTx = await window.ethereum!.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: token.address,
          data: approval,
          feeToken: GAS_TOKEN,
        }],
      }) as string;
      await receipt(approvalTx);

      const data = encodeFunctionData({
        abi: createAbi,
        functionName: "createDrop",
        args: [token.address as `0x${string}`, rawAmount],
      });

      setStatus("Confirm the drop creation transaction…");
      const tx = await window.ethereum!.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: CONTRACT,
          data,
          feeToken: GAS_TOKEN,
        }],
      }) as string;
      await receipt(tx);

      const logs = (await rpc("eth_getTransactionReceipt", [tx])).logs || [];
      const topic = keccak256(toBytes(
        "DropCreated(uint256,address,address,uint256,uint256,uint256,address)"
      ));
      const log = logs.find(
        (x: any) =>
          x.address?.toLowerCase() === CONTRACT.toLowerCase() &&
          x.topics?.[0]?.toLowerCase() === topic.toLowerCase()
      );

      if (!log?.topics?.[1]) throw new Error("Drop created, but the drop ID could not be read.");
      const id = BigInt(log.topics[1]).toString();
      window.location.assign(`/claim?id=${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drop creation failed.");
    } finally {
      setCreating(false);
      setStatus("");
    }
  }

  return <main>
    <nav className="nav">
      <div className="brand"><span className="brand-mark">T</span><span>TestingGas</span></div>
      <div className="nav-links">
        <span className="eyebrow">TEMPO MAINNET</span>
        <button className="wallet-btn" onClick={async () => {
          try { setAccount(await connectWallet()); setError(""); }
          catch (e) { setError(e instanceof Error ? e.message : "Wallet connection failed."); }
        }}>
          <Wallet size={15}/>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
        </button>
      </div>
    </nav>

    {error && <div className="wallet-error">{error}</div>}

    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow">TESTINGGAS · LIVE CONTRACT</div>
        <h1>Test gas.<br/><span>Test claims.</span></h1>
        <p className="hero-text">A minimal Tempo mainnet test app for funding and claiming token drops through the TestingGas contract.</p>
        <div className="hero-actions"><a className="primary" href="#create">Create a drop <ArrowUpRight size={17}/></a></div>
        <div className="trust-row"><span>Contract {CONTRACT.slice(0, 8)}…</span><i/><span>Tempo 4217</span></div>
      </div>
      <div className="hero-card"><div className="drop-preview">
        <div className="preview-top"><span className="pill">LIVE CONTRACT</span><span className="mono">4217</span></div>
        <div className="preview-icon">T</div>
        <div className="preview-amount">TestingGas</div>
        <p>Deploy, fund, claim, and inspect transactions directly on Tempo.</p>
        <div className="tempo-chip"><span/> Settled on Tempo</div>
      </div></div>
    </section>

    <section id="create" className="builder-section">
      <div className="section-heading">
        <div><div className="eyebrow">CREATE A DROP</div><h2>Fund the contract</h2></div>
        <span className="step-count">TEST MODE</span>
      </div>

      <div className="builder">
        <div className="form-card">
          <label>Drop token</label>
          <div className="token-row">
            {tokens.map(t => <button key={t.symbol} className={token.symbol === t.symbol ? "token active" : "token"} onClick={() => setToken(t)}>{t.symbol}</button>)}
          </div>

          <div className="summary-note">During the first 180 seconds, the contract automatically uses any supported Tempo TIP-20 token in the claimant wallet with at least 100 units. After that, claiming is free.</div>

          <label>Total amount to deposit</label>
          <div className="input-wrap"><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal"/><span>{token.symbol}</span></div>

          <div className="summary-note">The contract stores the selected claim-fee token with this drop and sends exactly 1 smallest token unit per successful claim.</div>

          <button className="create-btn" onClick={createDrop} disabled={creating}>
            {creating ? status || "Waiting for wallet…" : "Create test drop"}
          </button>
          {status && <div className="claim-wallet">{status}</div>}
        </div>

        <aside className="summary-card">
          <div className="summary-label">DEPLOYED CONTRACT</div>
          <div className="summary-total">4217 <span>Tempo</span></div>
          <div className="summary-line"><span>TestingGas</span><b>{CONTRACT.slice(0, 8)}…{CONTRACT.slice(-6)}</b></div>
          <div className="summary-line"><span>Creation fee</span><b>1%</b></div>
          <div className="summary-line"><span>Early claim fee</span><b>100 wallet token units</b></div>
          <div className="summary-line"><span>Early window</span><b>180 seconds</b></div>
        </aside>
      </div>
    </section>

    <section className="how">
      <div className="eyebrow">TEST FLOW</div><h2>Create. Fund. Claim. Inspect.</h2>
      <div className="steps">{[["01","Connect","Connect an EVM wallet on Tempo."],["02","Fund","Approve and create a test drop."],["03","Claim","Open the generated claim link."],["04","Inspect","Verify transactions on Tempo Explorer."]].map(([n,t,d]) =>
        <div className="step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>
      )}</div>
    </section>

    <footer><div className="brand"><span className="brand-mark">T</span><span>TestingGas</span></div><span>Standalone TestingGas protocol test app.</span><a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">Contract on Tempo <ArrowUpRight size={14}/></a></footer>
  </main>;
}
