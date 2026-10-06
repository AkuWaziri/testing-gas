"use client";

import { ArrowUpRight, Wallet } from "lucide-react";
import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useState } from "react";

const RPC="https://rpc.tempo.xyz", EXPLORER="https://explore.tempo.xyz", CONTRACT="0xA95ffcCD08e4a02fE1347a9eB819DA8a37889d9B", GAS_TOKEN="0x20C0000000000000000000000000000000000000", TIP20_FACTORY="0x20Fc000000000000000000000000000000000000", TOKEN_CREATED_TOPIC="0x44f7b8011db3e3647a530b4ff635726de5fafc8fa8ad10f0f31c0eb9dd52fc65", CHAIN="0x1079";
const SECOND_EXEMPT="0x5457A6A5bdA33bE94A542Bc841C28E6Be70Ad3c0";

const abi=[
 {type:"function",name:"drops",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"}],outputs:[{name:"creator",type:"address"},{name:"token",type:"address"},{name:"totalAmount",type:"uint256"},{name:"remaining",type:"uint256"},{name:"createdAt",type:"uint256"},{name:"claimed",type:"uint256"},{name:"active",type:"bool"}]},
 {type:"function",name:"claim",stateMutability:"nonpayable",inputs:[{name:"dropId",type:"uint256"},{name:"feeToken",type:"address"}],outputs:[]},
 {type:"function",name:"hasClaimed",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"},{name:"claimant",type:"address"}],outputs:[{name:"",type:"bool"}]},
 {type:"function",name:"earlyClaimFee",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"},{name:"claimant",type:"address"},{name:"feeToken",type:"address"}],outputs:[{name:"",type:"uint256"}]},
 {type:"function",name:"claimDeadline",stateMutability:"view",inputs:[{name:"dropId",type:"uint256"}],outputs:[{name:"",type:"uint256"}]},
 {type:"function",name:"feeRecipient",stateMutability:"view",inputs:[],outputs:[{name:"",type:"address"}]},
 {type:"function",name:"isEarlyClaimExempt",stateMutability:"view",inputs:[{name:"account",type:"address"}],outputs:[{name:"",type:"bool"}]}
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

async function findFeeToken(wallet:string,dropId:bigint,claimant:string){
 const candidates=[
  "0x20c0000000000000000000000000000000000000",
  "0x20c000000000000000000000b9537d11c60e8b50",
  "0x20c00000000000000000000014f22ca97301eb73"
 ];
 try{
  const logs=await rpc("eth_getLogs",[{address:TIP20_FACTORY,topics:[TOKEN_CREATED_TOPIC],"fromBlock":"0x0","toBlock":"latest"}]);
  for(const log of (logs||[])){
   const token=String(log.topics?.[1]||"");
   if(token.length===66)candidates.push("0x"+token.slice(-40));
  }
 }catch{}
 const seen=new Set<string>();
 for(const token of candidates){
  const t=token.toLowerCase();
  if(seen.has(t))continue;
  seen.add(t);
  try{
   const feeRaw=await rpc("eth_call",[{to:CONTRACT,data:encodeFunctionData({abi,functionName:"earlyClaimFee",args:[dropId,claimant as `0x${string}`,token as `0x${string}`]})},"latest"]);
   const fee=BigInt(String(feeRaw));
   if(fee===0n)continue;
   const balance=await rpc("eth_call",[{to:token,data:"0x70a08231"+"0".repeat(24)+wallet.slice(2)},"latest"]);
   if(BigInt(String(balance))>=fee)return {token,fee};
  }catch{}
 }
 throw new Error("No supported Tempo token with at least 5 units was found in this wallet.");
}

