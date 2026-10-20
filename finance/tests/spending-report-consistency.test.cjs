"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const flows=require("../features/flow-classifier.js");
const root=path.join(__dirname,"..");
const date="2026-09-09";
const row=(id,category,out=0,income=0,extra={})=>({
 id,tanggal:date,tahun:2026,bulan:"Sep",kategori_normalized:category,
 item_normalized:"Sample",item:"Sample",currency:"JPY",
 pengeluaran:out,pemasukan:income,payment_type:"cashless",...extra
});
const fixture=()=>[
 row(1,"Food & Dining",500),
 row(2,"Food & Dining",-100),
 row(3,"Scholarship Income",0,1000),
 row(4,"Transfers & Movements",20000,0,{item_normalized:"Self-Transfer (Internal)"}),
 row(5,"Card Settlement",30000,0,{item:"Hokuriku VISA Card Payment"}),
 row(6,"Account Reconciliation",10000,0),
 row(7,"Loans & Advances",100,0),
 row(8,"Others",40,0),
 row(9,"Food & Dining",50,0,{tanggal:"2026-11-09"})
];
function loadBrowserModule(file, ids=[]) {
 const nodes=new Map(ids.map(id=>[id,{
  textContent:"",style:{},classList:{add(){},remove(){},toggle(){}},
  replaceChildren(){},append(){},appendChild(){},dataset:{}
 }]));
 const window={FinanceFlowClassifier:flows};
 const document={getElementById:id=>nodes.get(id)||null};
 const context={window,document,Intl,Date,Number,Math,String,Array,Map,Set,console};
 vm.runInNewContext(fs.readFileSync(path.join(root,file),"utf8"),context,{filename:file});
 return {window,nodes};
}
test("one signed expense report excludes transfers, card repayments, adjustments and unknowns",()=>{
 const m=flows.report(fixture(),"2026-10-20");
 assert.equal(m.income,1000);
 assert.equal(m.grossSpending,500);
 assert.equal(m.refunds,100);
 assert.equal(m.spending,400);
 assert.equal(m.categoryTotals["Food & Dining"],400);
 assert.deepEqual(Array.from(m.spendingRows.map(x=>x.id)),[1,2]);
});
test("refund-only months remain negative rather than being silently clamped to zero",()=>{
 const m=flows.report([row(1,"Transportation",-700)],"2026-10-20");
 assert.equal(m.grossSpending,0);assert.equal(m.refunds,700);
 assert.equal(m.spending,-700);
});
test("monthly budget uses signed net spending for actual categories",()=>{
 const {window}=loadBrowserModule("features/monthly-budget.js");
 window.MonthlyBudget.setData({cash:fixture(),budgets:[
  {id:4,month_start:"2026-09-01",category:"Food & Dining",amount:1000}
 ]});
 const m=window.MonthlyBudget.getSummary("2026-09");
 assert.equal(m.spent,400);
 assert.equal(m.details[0].spent,400);
 assert.equal(m.details[0].remaining,600);
});
test("monthly review matches canonical income and net spending",()=>{
 const {window,nodes}=loadBrowserModule("features/monthly-review.js",
  ["review-income","review-spending","review-net","review-savings-rate"]);
 window.MonthlyReview.setData({cash:fixture(),budgets:[]});
 assert.equal(nodes.get("review-income").textContent,"¥1,000");
 assert.equal(nodes.get("review-spending").textContent,"¥400");
 assert.equal(nodes.get("review-net").textContent,"¥600");
});
test("insights always use canonical report and posted rows",()=>{
 const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
 const start=app.indexOf("function updateInsightsPage(filteredData)");
 const end=app.indexOf("function initBudgetSimulator()",start);
 assert.ok(start>0&&end>start);
 const body=app.slice(start,end);
 assert.match(body,/getPostedTransactions\(cashData\.length \? cashData : filteredData\)/);
 assert.match(body,/FinanceFlowClassifier\.report\(rows\)/);
 assert.match(body,/const sumExpenses = rows => report\(rows\)\.spending/);
 assert.doesNotMatch(body,/\(Number\(item\.pengeluaran\) \|\| 0\) > 0/);
});
test("main, income and expense charts use shared flow exclusion",()=>{
 const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
 for(const fn of ["renderMonthlyFlowChart","renderCategoryPieChart",
  "renderExpenseMonthlyChart","renderExpenseCategoryChart",
  "renderIncomeMonthlyChart","renderIncomeCategoryChart"]){
  const a=app.indexOf("function "+fn+"(");
  const b=app.indexOf("\nfunction ",a+1);
  assert.ok(a>0);
  assert.match(app.slice(a,b>=0?b:undefined),/isExcludedTransfer\(item\)/,fn);
 }
});
