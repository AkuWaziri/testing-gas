"use client";

import { ArrowUpRight, Send, Wallet } from "lucide-react";
import { encodeFunctionData, formatUnits, http, keccak256, parseUnits, toBytes } from "viem";
import { useEffect, useMemo, useState } from "react";
import { createThirdwebClient } from "thirdweb";
import { ConnectButton, ThirdwebProvider, useActiveAccount, useActiveWallet } from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { EIP1193 } from "thirdweb/wallets";

type Eip1193Provider = NonNullable<Window["ethereum"]> & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const TEMPO_CHAIN_ID = "0x1079";
const TEMPO_CHAIN_ID_DECIMAL = 4217;
const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "";
const thirdwebClient = THIRDWEB_CLIENT_ID ? createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID }) : undefined;
let activeWalletProvider: Eip1193Provider | undefined;

const TEMPO_NETWORK = defineChain({
  id: TEMPO_CHAIN_ID_DECIMAL,
  name: "Tempo Mainnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 6 },
  rpc: "https://rpc.tempo.xyz",
  blockExplorers: [{ name: "Tempo Explorer", url: "https://explore.tempo.xyz" }],
});

const SATODROPS_CONTRACT = process.env.NEXT_PUBLIC_SATODROPS_V2_CONTRACT_ADDRESS ?? "0x13048a5b34d182dc903871E89Db214847f8E1797";
const SATODROPS_LEGACY_CONTRACT = "0x44bD9AFc5304200E0880392f907C5d0FC2948bBE";
const PATH_USD_FEE_TOKEN = "0x20c0000000000000000000000000000000000000";

const tokens = [
  { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6, logo: "/tokens/usdc.svg" },
  { symbol: "USDT", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6, logo: "/tokens/usdt.svg" },
  { symbol: "pathUSD", address: "0x20c0000000000000000000000000000000000000", decimals: 6, logo: "/tokens/pathusd.svg" },
];

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const satodropsAbi = [
  {
    type: "function",
    name: "createDrop",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountPerClaim", type: "uint128" },
      { name: "maxClaims", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "walletSpecific", type: "bool" },
      { name: "wallets", type: "address[]" },
      { name: "message", type: "string" },
    ],
    outputs: [{ name: "dropId", type: "uint256" }],
  },
] as const;

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const DROP_CREATED_TOPIC = keccak256(toBytes("DropCreated(uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256)"));
const DROP_CLAIMED_TOPIC = keccak256(toBytes("DropClaimed(uint256,address,uint256,uint256)"));
const DEPLOYMENT_TX = process.env.NEXT_PUBLIC_SATODROPS_DEPLOYMENT_TX ?? "0x84c090a6be1aae7d07290e856427e58eb691b012581c64056e671de9e3d7ef23";

async function readTempoRpc(method: string, params: unknown[]) {
  const response = await fetch("https://rpc.tempo.xyz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error("Tempo RPC request failed.");
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Tempo RPC error.");
  return body.result ?? "";
}

async function readTokenBalance(provider: NonNullable<Window["ethereum"]>, token: string, owner: string) {
  const selector = "0x70a08231";
  const paddedOwner = owner.slice(2).padStart(64, "0");
  const raw = await provider.request({
    method: "eth_call",
    params: [{ to: token, data: selector + paddedOwner }, "latest"],
  }) as string;
  return Number(BigInt(raw || "0")) / 1_000_000;
}

async function waitForReceipt(provider: NonNullable<Window["ethereum"]>, hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("Transaction reverted on Tempo.");
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Transaction confirmation timed out. Check the transaction on Tempo Explorer.");
}

function HomeWithWallet() {
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("5");
  const [claims, setClaims] = useState("10");
  const [message, setMessage] = useState("Bug bounty rewards for Popo Teams");
  const [created, setCreated] = useState(false);
  const [account, setAccount] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [walletError, setWalletError] = useState("");
  const [creating, setCreating] = useState(false);
  const [recentDrops, setRecentDrops] = useState<Array<{ id:string; creator:string; token:typeof tokens[number]; amountPerClaim:bigint; maxClaims:bigint; claimed:bigint; creationTx:string; claimTxs:string[] }>>([]);
  const [recentDropsLoading, setRecentDropsLoading] = useState(true);

  const effectiveClaims = Number(claims || 0);
  const rewardTotal = Number(amount || 0) * effectiveClaims;
  const creationFee = rewardTotal * 0.01;
  const claimFees = rewardTotal * 0.005;
  const total = rewardTotal.toFixed(2);
  const totalFunding = (rewardTotal + creationFee + claimFees).toFixed(2);
  const selectedToken = useMemo(() => tokens.find((t) => t.symbol === token) ?? tokens[0], [token]);

  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();

  async function loadWalletBalances(provider: Eip1193Provider, wallet: string) {
    const nextBalances: Record<string, number> = {};
    for (const item of tokens) {
      try {
        nextBalances[item.symbol] = await readTokenBalance(provider, item.address, wallet);
      } catch {
        nextBalances[item.symbol] = 0;
      }
    }
    setBalances(nextBalances);
  }


  async function createDrop() {
    setWalletError("");
    setCreated(false);

    const provider = activeWalletProvider ?? (window.ethereum as Eip1193Provider | undefined);
    if (!provider) {
      setWalletError("Connect a wallet first.");
      return;
    }
    if (!account) {
      setWalletError("Connect a wallet first.");
      return;
    }
    if (!SATODROPS_CONTRACT) {
      setWalletError("SatoDrops contract is not deployed/configured yet.");
      return;
    }

    const claimCount = effectiveClaims;
    if (!amount || Number(amount) <= 0) {
      setWalletError("Enter a reward amount greater than zero.");
      return;
    }
    if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 20) {
      setWalletError("Public drops can have between 1 and 20 claims.");
      return;
    }
    try {
      setCreating(true);

      const rewardPerClaim = parseUnits(amount, selectedToken.decimals);
      const rewardTotalRaw = rewardPerClaim * BigInt(claimCount);
      const creationFeeRaw = rewardTotalRaw / 100n;
      const claimFeesRaw = rewardTotalRaw / 200n;
      const totalFundingRaw = rewardTotalRaw + creationFeeRaw + claimFeesRaw;

      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SATODROPS_CONTRACT as `0x${string}`, totalFundingRaw],
      });

      const approvalHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: selectedToken.address,
          data: approveData,
          feeToken: PATH_USD_FEE_TOKEN,
        }],
      }) as string;

      await waitForReceipt(provider, approvalHash);

      const createData = encodeFunctionData({
        abi: satodropsAbi,
        functionName: "createDrop",
        args: [
          selectedToken.address as `0x${string}`,
          rewardPerClaim,
          BigInt(effectiveClaims),
          0n,
          false,
          [] as `0x${string}`[],
          message,
        ],
      });

      const createHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: SATODROPS_CONTRACT,
          data: createData,
          feeToken: PATH_USD_FEE_TOKEN,
        }],
      }) as string;

      const createReceipt = await waitForReceipt(provider, createHash);

      const logs = (createReceipt as { logs?: Array<{ address?: string; topics?: string[] }> }).logs ?? [];
      const contractLog = logs.find(
        (log) => log.address?.toLowerCase() === SATODROPS_CONTRACT.toLowerCase() && log.topics?.[0]?.toLowerCase() === DROP_CREATED_TOPIC.toLowerCase()
      );
      const dropId = contractLog?.topics?.[1] ? BigInt(contractLog.topics[1]).toString() : "";

      if (!dropId) {
        throw new Error("Drop was funded, but the new drop ID could not be read from the transaction receipt.");
      }

      window.location.assign(`/claim?id=${dropId}&v=2`);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Drop creation failed.");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    const loadRecentDrops = async () => {
      try {
        if (!SATODROPS_CONTRACT || !account) {
          setRecentDrops([]);
          return;
        }
        const deploymentRaw = await readTempoRpc("eth_getTransactionReceipt", [DEPLOYMENT_TX]);
        const deploymentReceipt = deploymentRaw as unknown as { blockNumber?: string };
        if (!deploymentReceipt.blockNumber) throw new Error("Could not determine the SatoDrops deployment block.");
        const latestRaw = await readTempoRpc("eth_blockNumber", []);
        const deploymentBlock = BigInt(deploymentReceipt.blockNumber as string);
        const latestBlock = BigInt(latestRaw as string);
        const maxRange = 100000n;
        const fromBlock = latestBlock > maxRange ? latestBlock - maxRange + 1n : deploymentBlock;
        const effectiveFrom = fromBlock > deploymentBlock ? fromBlock : deploymentBlock;
        const raw = await readTempoRpc("eth_getLogs", [{ address: SATODROPS_CONTRACT, fromBlock: "0x" + effectiveFrom.toString(16), toBlock: "0x" + latestBlock.toString(16), topics: [DROP_CREATED_TOPIC] }]);
        const logs = raw as unknown as Array<{ topics?: string[]; transactionHash?: string }>;
const wallet = account.toLowerCase();
const ownedLogs = logs.filter((log) => (log.topics?.[2] ?? "").slice(-40).toLowerCase() === wallet.slice(2));
        const ids = ownedLogs.map((log) => log.topics?.[1] ? BigInt(log.topics[1]).toString() : "").filter(Boolean).slice(-10).reverse();
        const claimRaw = await readTempoRpc("eth_getLogs", [{ address: SATODROPS_CONTRACT, fromBlock: "0x" + effectiveFrom.toString(16), toBlock: "0x" + latestBlock.toString(16), topics: [DROP_CLAIMED_TOPIC] }]);
        const claimLogs = claimRaw as unknown as Array<{ topics?: string[]; transactionHash?: string }>;
        const loaded = [];
        for (const id of ids) {
          const creationLog = ownedLogs.find((log) => log.topics?.[1] && BigInt(log.topics[1]).toString() === id);
          const claimTxs = claimLogs.filter((log) => log.topics?.[1] && BigInt(log.topics[1]).toString() === id && log.transactionHash).map((log) => log.transactionHash as string);
          const data = await readTempoRpc("eth_call", [{ to: SATODROPS_CONTRACT, data: encodeFunctionData({ abi: [{ type:"function", name:"drops", stateMutability:"view", inputs:[{name:"dropId",type:"uint256"}], outputs:[{name:"creator",type:"address"},{name:"token",type:"address"},{name:"amountPerClaim",type:"uint128"},{name:"maxClaims",type:"uint64"},{name:"claimed",type:"uint64"},{name:"expiresAt",type:"uint64"},{name:"closed",type:"bool"},{name:"message",type:"string"}] }] as const, functionName:"drops", args:[BigInt(id)] }) }, "latest"]);
          const hex = String(data).replace(/^0x/, "");
          const word = (i:number) => hex.slice(i*64,(i+1)*64);
          const tokenAddress = "0x" + word(1).slice(24);
          const tokenInfo = tokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());
          if (tokenInfo) loaded.push({ id, creator:"0x"+word(0).slice(24), token:tokenInfo, amountPerClaim:BigInt("0x"+word(2)), maxClaims:BigInt("0x"+word(3)), claimed:BigInt("0x"+word(4)), creationTx:creationLog?.transactionHash ?? "", claimTxs });
        }
        setRecentDrops(loaded);
      } catch (error) { console.error("Could not load existing drops", error); }
      finally { setRecentDropsLoading(false); }
    };
    void loadRecentDrops();
  }, [account]);

  useEffect(() => {
    if (!activeWallet || !activeAccount?.address || !thirdwebClient) {
      activeWalletProvider = undefined;
      setAccount("");
      setBalances({});
      return;
    }

    const provider = EIP1193.toProvider({
      wallet: activeWallet,
      chain: TEMPO_NETWORK,
      client: thirdwebClient,
    }) as unknown as Eip1193Provider;

    activeWalletProvider = provider;
    setAccount(activeAccount.address);
    setWalletError("");
    void loadWalletBalances(provider, activeAccount.address);

    const handleAccounts = (...args: unknown[]) => {
      const next = args[0] as string[] | undefined;
      if (next?.[0]) {
        setAccount(next[0]);
        void loadWalletBalances(provider, next[0]);
      } else {
        setAccount("");
        setBalances({});
      }
    };

    provider.on?.("accountsChanged", handleAccounts);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
    };
  }, [activeWallet, activeAccount?.address]);

  return (
    <main>
      <nav className="nav">
        <div className="brand"><img className="brand-logo" src="/satodrops-logo.svg" alt="SatoDrops" /><span>SatoDrops</span></div>
        <div className="nav-links"><a href="#how">How it works</a><a href="#create">Create a drop</a><ConnectButton client={thirdwebClient!} chain={TEMPO_NETWORK} connectButton={{ label: "Connect wallet", className: "wallet-btn" }} showAllWallets />{account && <span className="wallet-connected"><Wallet size={16}/> {shortAddress(account)}</span>}</div>
      </nav>

      {walletError && <div className="wallet-error">{walletError}</div>}



      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot"/> POWERED BY TEMPO</div>
          <h1>Stablecoins rewards.<br/><span>Instantly claimable..</span></h1>
          <p className="hero-text">Fund a stablecoin reward, share one link, and let people claim it on fcfs, all onchain.</p>
          <div className="hero-actions"><a className="primary" href="#create">Create a drop <ArrowUpRight size={17}/></a><a className="secondary" href="#how">See how it works</a></div>
          <div className="trust-row"><span>Stablecoin-native</span><i/> <span>Tempo mainnet</span><i/> <span>Non-custodial</span></div>
        </div>
        <div className="hero-card">
          <div className="card-glow"/>
          <div className="drop-preview">
            <div className="preview-top"><span className="pill">ACTIVE DROP</span><span className="mono">#A7F2</span></div>
            <div className="preview-icon">$</div>
            <div className="preview-amount">$5.00 <span>USDC</span></div>
            <p>First valid bug report gets a reward.</p>
            <div className="progress"><div style={{width:"60%"}}/></div>
            <div className="progress-meta"><span>6 of 10 claimed</span><span>$20 remaining</span></div>
            <button className="claim-demo">Claim $5.00 <ArrowUpRight size={16}/></button>
            <div className="tempo-chip"><span/> Settled on Tempo</div>
          </div>
        </div>
      </section>



      <section id="create" className="builder-section">
        <div className="section-heading"><div><div className="eyebrow">CREATE A DROP</div><h2>Fund It. Share It.</h2></div><span className="step-count">01 / 02</span></div>
        <div className="builder">
          <div className="form-card">
            <label>Who can claim?</label>
            <div className="summary-note" style={{marginBottom:18}}>Anyone can claim until the drop is full.</div>
            <label>Reward token</label>
            <div className="token-row">{tokens.map(t=><button key={t.symbol} className={token===t.symbol?"token active":"token"} onClick={()=>setToken(t.symbol)}>
  <img src={t.logo} alt="" width={20} height={20} style={{borderRadius:"50%",objectFit:"contain",verticalAlign:"middle"}} />
  {" "}{t.symbol}
</button>)}</div>
            {account && <div className="balance-row"><span>Connected balance</span><b>{(balances[selectedToken.symbol] ?? 0).toFixed(2)} {selectedToken.symbol}</b></div>}
            <div className="two-col">
              <div><label>Reward per person</label><div className="input-wrap"><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/><span>{token}</span></div></div>
              <div><label>Number of claims</label><div className="input-wrap"><input value={claims} onChange={e=>setClaims(e.target.value)} inputMode="numeric" max={20}/><span>people</span></div></div>
            </div>
            <label>What is this reward for?</label>
            <textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={120}/>
            <div className="char-count">{message.length}/120</div>
            <button className="create-btn" onClick={createDrop} disabled={creating}>{creating?"Waiting for wallet…":created?"Drop created":"Create drop"}</button>
          </div>
          <aside className="summary-card">
            <div className="summary-label">DROP SUMMARY</div>
            <div className="summary-total">{total} <span>{token}</span></div>
            <div className="summary-line"><span>Per claim</span><b>{amount || "0"} {token}</b></div>
            <div className="summary-line"><span>Claims</span><b>{effectiveClaims || "0"}</b></div>
            <div className="summary-line total-funding"><span>Total to fund</span><b>{totalFunding} {token}</b></div>
            <div className="summary-line"><span>Network</span><b><span className="network-dot"/> Tempo</b></div>
            <div className="summary-note">You fund the rewards plus the 1% creation fee and 0.5% claim fees upfront. Claimants receive the full reward amount without the need to pay for extra gas fees.</div>
          </aside>
        </div>
      </section>

      <section className="existing-drops">
        <div className="section-heading"><div><div className="eyebrow">YOUR ONCHAIN DROPS</div><h2>Recent drops</h2></div><span className="step-count">PRIVATE TO CONNECTED WALLET</span></div>
        {!account ? <div className="existing-empty">Connect your wallet to view your drops.</div> : recentDropsLoading ? <div className="existing-empty">Loading your drops…</div> : recentDrops.length === 0 ? <div className="existing-empty">No drops created by this wallet yet.</div> : <div className="existing-grid">{recentDrops.map((item) => { const remaining=item.maxClaims-item.claimed; return <a className="existing-drop" href={"/claim?id="+item.id+"&v=2"} key={item.id}><div className="existing-top"><span className="pill">{remaining===0n?"COMPLETED":"ACTIVE"}</span><span className="mono">#{item.id}</span></div><div className="existing-amount">{formatUnits(item.amountPerClaim,item.token.decimals)} <span>{item.token.symbol}</span></div><div className="existing-meta"><span>{item.claimed.toString()} / {item.maxClaims.toString()} claimed</span><span>{remaining.toString()} left</span></div><div className="progress"><div style={{width:(Math.min(100,Number(item.claimed*100n/item.maxClaims)))+"%"}}/></div><div className="existing-creator">Created by {shortAddress(item.creator)} <ArrowUpRight size={13}/></div>{item.creationTx && <div className="existing-tx"><span>Drop TX</span><a href={`https://explore.tempo.xyz/tx/${item.creationTx}`} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()}>View transaction <ArrowUpRight size={12}/></a></div>}{item.claimTxs.length > 0 && <div className="existing-tx"><span>{item.claimTxs.length} claim transaction{item.claimTxs.length === 1 ? "" : "s"}</span><a href={`https://explore.tempo.xyz/tx/${item.claimTxs[item.claimTxs.length - 1]}`} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()}>Latest claim <ArrowUpRight size={12}/></a></div>}</a>; })}</div>}
      </section>


      <section id="how" className="how"><div className="eyebrow">THE LOOP</div><h2>Create. Fund. Share. Claim.</h2><div className="steps">{[["01","Create","Choose a stablecoin, amount and purpose."],["02","Fund","Approve the total reward on Tempo."],["03","Share","Send the claim link anywhere."],["04","Claim","A recipient connects and gets paid."]].map(([n,t,d])=><div className="step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div></section>

      <footer><div className="brand"><img className="brand-logo" src="/satodrops-logo.svg" alt="SatoDrops" /><span>SatoDrops</span></div><span>Stablecoins programmable rewards, powered by Tempo.</span><div className="social-links"><a className="social-link" href="https://x.com/Satodrops" target="_blank" rel="noreferrer" aria-label="SatoDrops on X" title="SatoDrops on X"><span className="x-logo">𝕏</span></a><a className="social-link" href="#" aria-label="SatoDrops on Telegram" title="Telegram"><Send size={16}/></a></div><a href="https://tempo.xyz" target="_blank" rel="noreferrer">Built for Tempo <ArrowUpRight size={14}/></a></footer>
    </main>
  );
}

export default function Home() {
  if (!thirdwebClient) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 560, textAlign: "center" }}>
          <h1>Wallet connection is not configured</h1>
          <p>Set NEXT_PUBLIC_THIRDWEB_CLIENT_ID in the testing-gas Vercel environment and redeploy.</p>
        </div>
      </main>
    );
  }

  return (
    <ThirdwebProvider>
      <HomeWithWallet />
    </ThirdwebProvider>
  );
}
