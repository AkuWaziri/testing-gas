"use client";

import { ArrowUpRight, Wallet } from "lucide-react";
import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useState } from "react";

const RPC="https://rpc.tempo.xyz", EXPLORER="https://explore.tempo.xyz", CONTRACT="0xA2E7511ACb110520B067Cd753448D5C9854AA007", GAS_TOKEN="0x20C0000000000000000000000000000000000000", CHAIN="0x1079";
const SECOND_EXEMPT="0x5457A6A5bdA33bE94A542Bc841C28E6Be70Ad3c0";

const abi=[
 {type:"function",name:"drops",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"}],outputs:[{name:"creator",type:"address"},{name:"token",type:"address"},{name:"earlyClaimFeeToken",type:"address"},{name:"totalAmount",type:"uint256"},{name:"remaining",type:"uint256"},{name:"createdAt",type:"uint256"},{name:"claimed",type:"uint256"},{name:"active",type:"bool"}]},
 {type:"function",name:"claim",stateMutability:"nonpayable",inputs:[{name:"dropId",type:"uint256"}],outputs:[]},
 {type:"function",name:"hasClaimed",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"},{name:"claimant",type:"address"}],outputs:[{name:"",type:"bool"}]},
 {type:"function",name:"earlyClaimFee",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"},{name:"claimant",type:"address"}],outputs:[{name:"",type:"uint256"}]},
 {type:"function",name:"feeRecipient",stateMutability:"view",inputs:[],outputs:[{name:"",type:"address"}]}
] as const;

const erc20Abi=[
 {type:"function",name:"approve",stateMutability:"nonpayable",inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}],outputs:[{name:"",type:"bool"}]},
 {type:"function",name:"allowance",stateMutability:"view",inputs:[{name:"owner",type:"address"},{name:"spender",type:"address"}],outputs:[{name:"",type:"uint256"}]}
] as const;

const tokens:Record<string,{symbol:string;decimals:number}>={
 "0x20c000000000000000000000b9537d11c60e8b50":{symbol:"USDC",decimals:6},
 "0x20c00000000000000000000014f22ca97301eb73":{symbol:"USDT",decimals:6},
 "0x20c0000000000000000000000000000000000000":{symbol:"pathUSD",decimals:6}
};

async function rpc(method:string,params:unknown[]){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});const b=await r.json();if(b.error)throw new Error(b.error.message||"Tempo RPC error");return b.result}
async function wait(hash:string){for(let i=0;i<40;i++){const r=await rpc("eth_getTransactionReceipt",[hash]);if(r){if(r.status==="0x0")throw new Error("Transaction reverted on Tempo.");return r}await new Promise(x=>setTimeout(x,1500))}throw new Error("Transaction confirmation timed out.")}
async function connect(){if(!window.ethereum)throw new Error("No EVM wallet detected.");const a=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];const c=await window.ethereum.request({method:"eth_chainId"}) as string;if(c.toLowerCase()!==CHAIN)await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN}]});return a[0]}
async function sendTokenTx(from:string,to:string,data:string){return await window.ethereum!.request({method:"eth_sendTransaction",params:[{from,to,data,feeToken:GAS_TOKEN}]}) as string}

declare global{interface Window{ethereum?:{request:(args:{method:string;params?:unknown[]})=>Promise<unknown>}}}

export default function ClaimPage(){
 const [id,setId]=useState(""),[drop,setDrop]=useState<any>(null),[account,setAccount]=useState(""),[claimed,setClaimed]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[tx,setTx]=useState(""),[fee,setFee]=useState<bigint>(0n);

 useEffect(()=>{const i=new URLSearchParams(location.search).get("id")||"";setId(i);if(!/^\d+$/.test(i)){setError("Invalid claim link.");return}(async()=>{try{const raw=await rpc("eth_call",[{to:CONTRACT,data:encodeFunctionData({abi,functionName:"drops",args:[BigInt(i)]})},"latest"]);const h=String(raw).slice(2);const w=(n:number)=>h.slice(n*64,(n+1)*64);setDrop({creator:"0x"+w(0).slice(24),token:"0x"+w(1).slice(24),feeToken:"0x"+w(2).slice(24),total:BigInt("0x"+w(3)),remaining:BigInt("0x"+w(4)),created:BigInt("0x"+w(5)),claimed:BigInt("0x"+w(6)),active:BigInt("0x"+w(7))!==0n})}catch(e){setError(e instanceof Error?e.message:"Could not load drop.")}})()},[]);

 async function claim(){
  setError("");
  try{
   setBusy(true);
   const a=account||await connect(); setAccount(a);
   const already=await rpc("eth_call",[{to:CONTRACT,data:encodeFunctionData({abi,functionName:"hasClaimed",args:[BigInt(id),a as `0x${string}`]})},"latest"]);
   if(BigInt(String(already))!==0n){setClaimed(true);throw new Error("This wallet has already claimed this drop.")}
   const feeRaw=await rpc("eth_call",[{to:CONTRACT,data:encodeFunctionData({abi,functionName:"earlyClaimFee",args:[BigInt(id),a as `0x${string}`]})},"latest"]);
   const earlyFee=BigInt(String(feeRaw));
   setFee(earlyFee);

   if(earlyFee>0n){
    const allowanceRaw=await rpc("eth_call",[{to:drop.feeToken,data:encodeFunctionData({abi:erc20Abi,functionName:"allowance",args:[a as `0x${string}`,CONTRACT as `0x${string}`]})},"latest"]);
    if(BigInt(String(allowanceRaw))<earlyFee){
     setBusy(true);
     const approvalData=encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[CONTRACT as `0x${string}`,earlyFee]});
     const approvalTx=await sendTokenTx(a,drop.feeToken,approvalData);
     await wait(approvalTx);
    }
   }

   const data=encodeFunctionData({abi,functionName:"claim",args:[BigInt(id)]});
   const h=await window.ethereum!.request({method:"eth_sendTransaction",params:[{from:a,to:CONTRACT,data,feeToken:GAS_TOKEN}]}) as string;
   await wait(h);setTx(h);setClaimed(true);setDrop((d:any)=>d?{...d,remaining:d.remaining-1n,claimed:d.claimed+1n}:d);
  }catch(e){setError(e instanceof Error?e.message:"Claim failed.")}finally{setBusy(false)}
 }

 const token=drop?tokens[drop.token.toLowerCase()]:undefined;
 const feeToken=drop?tokens[drop.feeToken.toLowerCase()]:undefined;

 return <main className="claim-page"><nav className="nav"><a className="brand" href="/"><span className="brand-mark">T</span><span>TestingGas</span></a><span className="eyebrow">TEMPO MAINNET</span></nav><section className="claim-shell"><div className="claim-card"><div className="eyebrow">TESTINGGAS CLAIM · #{id||"—"}</div>{!drop&&!error&&<h1>Loading drop…</h1>}{error&&!drop&&<><h1>Claim unavailable</h1><p>{error}</p><a className="secondary" href="/">Back to TestingGas</a></>}{drop&&<><div className="claim-token">{token?.symbol||"TOKEN"}</div><div className="claim-amount">{formatUnits(drop.total,token?.decimals||6)} <span>{token?.symbol||""} total</span></div><p className="claim-message">This TestingGas drop pays exactly 1 smallest token unit per successful claim.</p><div className="claim-meta"><span>{drop.claimed.toString()} units claimed</span><span>{drop.remaining.toString()} units remaining</span></div><div className="summary-note">Early claim fee: <b>100 {feeToken?.symbol||"selected tokens"}</b> during the first 180 seconds. After that, the early claim fee is 0. Exempt wallets pay 0.</div>{!drop.active&&<div className="wallet-error">This drop is inactive or exhausted.</div>}{claimed&&<div className="success-box">Claim confirmed on Tempo · <a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction</a></div>}{error&&<div className="wallet-error">{error}</div>}<button className="create-btn" onClick={claim} disabled={busy||!drop.active||claimed}><Wallet size={17}/>{busy?"Waiting for wallet…":claimed?"Claim completed":account?"Claim 1 base unit":"Connect wallet to claim"}{!busy&&!claimed&&<ArrowUpRight size={16}/>}</button>{account&&<div className="claim-wallet">Connected {account.slice(0,6)}…{account.slice(-4)}</div>}</>}</div></section></main>
}
