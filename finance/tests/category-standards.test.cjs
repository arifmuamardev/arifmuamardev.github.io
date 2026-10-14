"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {suggest,categories}=require("../features/category-standards.js");
const check=(item,opts={})=>suggest({item,...opts})?.category||null;
test("credit card repayment, not purchase, suggests settlement",()=>{
 assert.equal(check("PAYMENT_KKCB_TKP***12"),"Card Settlement");
 assert.equal(check("ChatGPT subscription",{note:"CC KU"}),"Software/Service");
});
test("own account transfer is distinct from travel purchase via Wise",()=>{
 assert.equal(check("Wise Transfer to Indonesia"),"Transfers & Movements");
 assert.equal(check("Tiket Pesawat Trip.com (Wise)"),null);
});
test("unknown sender payment type does not guess movement",()=>{
 assert.equal(check("Bank Transfer / Payment"),null);
});
test("education software and research meter have specific classes",()=>{
 assert.equal(check("Matific Learning Subscription"),"Research & Education");
 assert.equal(check("Quantum PAR Meter"),"Research & Education");
});
test("existing card transaction label does not change food classification",()=>{
 assert.equal(check("Dorayaki",{note:"CC KU"}),"Food & Dining");
});
test("line-level device class takes precedence over Amazon vendor",()=>{
 assert.equal(check("Portable Monitor",{store:"Amazon"}),"Elektronik");
});
test("general marketplace uses only general shopping with caveat",()=>{
 const s=suggest({item:"Amazon purchase"});
 assert.equal(s.category,"Belanja");
 assert.match(s.reason,/item type is not/);
});
test("unrecognized merchant remains unsuggested",()=>assert.equal(check("PAYPAL *INSTITUTEEL"),null));
test("utility semantics can be recognized in Japanese",()=>{
 assert.equal(check("北陸電力（電気料）"),"Electricity");
});
test("refund and income flow are handled separately",()=>{
 assert.equal(check("Refund",{flow:"refund"}),"Discounts & Refunds");
 assert.equal(check("MEXT stipend",{flow:"income"}),"Scholarship Income");
 assert.equal(check("Unknown",{flow:"income"}),null);
});
test("no suggestion requires no forced category",()=>assert.equal(suggest({item:"Droppy"}),null));
test("new standardized categories are available in picker",()=>{
 for(const s of ["Transfers & Movements","Card Settlement","Research & Education","Others"])
   assert.ok(categories.includes(s));
});
