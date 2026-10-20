(() => {
 "use strict";
 let data={receipts:[],gopay:[],loadError:false},initialized=false;
 const id="GOPAY-ESTATEMENT-202609",snapId="GOPAY-HOME-20261020";
 const str=x=>String(x??"").trim();
 const num=x=>Number(x);
 const date=x=>str(x).slice(0,10);
 const format=x=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(num(x));
 const methodMatch=(source,row)=>{
  const pay=str(row.payment_method).toLowerCase();
  if(source.method==="card")return /card|credit/.test(pay);
  if(source.method==="coins")return /coins/.test(pay);
  return /jago/.test(pay);
 };
 function evaluate({receipts=[],gopay=[],loadError=false}={}){
  const statement=(Array.isArray(receipts)?receipts:[]).find(x=>x.evidence_key===id);
  const screenshot=(Array.isArray(receipts)?receipts:[]).find(x=>x.evidence_key===snapId);
  const p=statement?.payload||{},s=screenshot?.payload||{};
  const source=Array.isArray(p.source_rows)?p.source_rows:[];
  const entries=Array.isArray(gopay)?gopay:[];
  const matchCounts=source.map(v=>entries.filter(row=>
   date(row.date)===date(v.date) &&
   str(row.sign)===str(v.sign) && methodMatch(v,row) &&
   (num(v.coins)>0 ? num(row.amount)===0&&num(row.coins)===num(v.coins)
     : num(row.amount)===num(v.amount)&&num(v.amount)>0)
  ).length);
  const distinctIds=new Set(source.map(x=>str(x.transaction_id)));
  const duplicateIds=source.length-distinctIds.size;
  const inputValid=source.length===35&&duplicateIds===0 &&
   source.every(x=>str(x.transaction_id)&&str(x.date)&&
    (x.sign==="+"||x.sign==="-")&&Number.isFinite(num(x.amount))&&
    Number.isFinite(num(x.coins)));
  const sum=(fn,k)=>source.filter(fn).reduce((v,x)=>v+num(x[k]),0);
  const credits=sum(x=>x.sign==="+"&&num(x.amount)>0,"amount"),
    grossDebits=sum(x=>x.sign==="-"&&num(x.amount)>0,"amount"),
    coinsEarned=sum(x=>num(x.coins)>0,"coins");
  const netStatement=num(p.statement_expenditure_idr);
  const statementConsistent=inputValid&&credits===750037&&grossDebits===830564&&
   coinsEarned===47302&&netStatement===783262 &&
   grossDebits-coinsEarned===netStatement &&
   num(p.coins_used)===coinsEarned;
  const homeValid=screenshot?.source_type==="gopay_balance_snapshot" &&
   Number.isFinite(num(s.wallet_balance_idr))&&num(s.wallet_balance_idr)>=0 &&
   Number.isFinite(num(s.coins_balance))&&num(s.coins_balance)>=0 &&
   date(screenshot.receipt_date)==="2026-10-20";
  return {
   loadError:!!loadError,statementFound:!!statement,sourceCount:source.length,
   matched:matchCounts.filter(n=>n===1).length,
   missing:matchCounts.filter(n=>n===0).length,
   ambiguous:matchCounts.filter(n=>n>1).length,
   duplicateIds,statementConsistent,
   grossDebits,credits,coinsEarned,netStatement,
   hasSnapshot:!!homeValid,
   balance:homeValid?num(s.wallet_balance_idr):null,
   coins:homeValid?num(s.coins_balance):null,
   octoberSpending:homeValid?num(s.october_spending_display_idr):null,
   snapshotDate:homeValid?date(screenshot.receipt_date):null,
   cardExpense:source.filter(x=>x.method==="card").reduce((n,x)=>n+num(x.amount),0),
   transferOut:source.filter(x=>x.type==="Transfer"&&x.sign==="-").reduce((n,x)=>n+num(x.amount),0)
  };
 }
 function el(id){return document.getElementById(id);}
 function put(id,value){const x=el(id);if(x)x.textContent=String(value);}
 function render(){
  if(typeof document==="undefined")return;
  const m=evaluate(data),container=el("gopay-proof");
  if(!container)return;
  container.classList.toggle("hidden",!m.statementFound&&!m.hasSnapshot&&!m.loadError);
  if(m.loadError) {
   put("gopay-proof-banner","Private screenshot/statement registry is temporarily unavailable. Your existing transactions remain visible.");
  } else if(m.statementFound) {
   put("gopay-proof-banner",m.statementConsistent&&m.missing===0&&m.ambiguous===0
     ? "September e-statement reconciled: "+m.matched+"/"+m.sourceCount+" unique entries matched"
     : "September statement requires review: "+m.matched+"/"+m.sourceCount+
       " matched, "+m.missing+" missing, "+m.ambiguous+" ambiguous");
  } else put("gopay-proof-banner","No verified September statement available.");
  put("gopay-proof-balance",m.hasSnapshot?"Rp"+format(m.balance):"Not verified");
  put("gopay-proof-date",m.hasSnapshot?"Screenshot received "+m.snapshotDate+" · not live":"No current balance screenshot");
  put("gopay-proof-coins",m.hasSnapshot?format(m.coins)+" Coins":"Not verified");
  put("gopay-proof-usage",m.hasSnapshot?"Rp"+format(m.octoberSpending):"Not available");
  put("gopay-proof-sep-inflow",m.statementConsistent?"Rp"+format(m.credits):"Needs review");
  put("gopay-proof-sep-net",m.statementConsistent?"Rp"+format(m.netStatement):"Needs review");
  put("gopay-proof-sep-coins",m.statementConsistent?format(m.coinsEarned)+" earned / used":"Needs review");
  put("gopay-proof-sep-explain",m.statementConsistent?
   "Gross rupiah debits Rp"+format(m.grossDebits)+
   " include a Rp"+format(m.cardExpense)+" external card transaction and a Rp"+
   format(m.transferOut)+" transfer. The PDF reports Rp"+format(m.netStatement)+
   " after Rp"+format(m.coinsEarned)+" Coins adjustment. Top-ups are internal movements; Coins are not cash income.":
   "The official statement totals or linked records need review. Balances are never inferred from partial transactions.");
 }
 function setData(next={}) {
  data={
   receipts:Array.isArray(next.receipts)?next.receipts:[],
   gopay:Array.isArray(next.gopay)?next.gopay:[],
   loadError:!!next.loadError
  };
  render();
 }
 function init(){if(initialized)return;initialized=true;render();}
 if(typeof window!=="undefined")window.FinanceGoPayProof={init,setData,render};
 if(typeof module!=="undefined"&&module.exports)module.exports={evaluate};
})();