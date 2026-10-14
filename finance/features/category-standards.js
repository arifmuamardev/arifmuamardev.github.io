(() => {
  "use strict";
  // Explanatory suggestions only. Never auto-assign inferred categories.
  // Avoid categorizing general merchants (Amazon, AEON, Temu, Tokopedia)
  // as specific goods without a product-level description.
  const vocabulary = [
    "Account Reconciliation","Apartment","Bank Interest Income","Belanja",
    "Card Settlement","Clothing & Apparel","Delivery & Shipping",
    "Discounts & Refunds","Donations & Charity","Elektronik","Electricity",
    "Entertainment","Food & Dining","Gas","Gifts & Souvenirs",
    "Household Supplies","Insurance","Internet","Kesehatan","Loans & Advances",
    "Memberships & Associations","Mobile","Personal Care","Plants & Gardening",
    "Research & Education","Software/Service","Stationery","Taxes & Fees",
    "Tools","Transportation","Transfers & Movements","Travel & Accommodation","Water",
    "Others"
  ];
  const contains = (text,rx) => rx.test(text);
  function suggest({item="",store="",flow="expense",note=""}={}) {
    const description=String(item).normalize("NFKC").toLowerCase();
    const shop=String(store).normalize("NFKC").toLowerCase();
    const memo=String(note).normalize("NFKC").toLowerCase();
    const full=[description,shop,memo].join(" ");

    if (flow==="refund") return {category:"Discounts & Refunds",reason:"Marked as refund / credit."};
    if (flow==="income") {
      if(contains(description,/mext|scholarship|stipend|beasiswa/))return {category:"Scholarship Income",reason:"Scholarship or stipend income."};
      if(contains(description,/interest|bunga bank|利息/))return {category:"Bank Interest Income",reason:"Bank interest income."};
      return null;
    }
    // Movement and settlement matches must be based on transaction semantics,
    // not an arbitrary store or a lone 'CC KU' note attached to a purchase.
    if(contains(description,/payment_kkcb|card (payment|settlement)|credit card repayment|pelunasan kartu|tagihan kartu/) ||
       contains(full,/visa auto.debit|cc ku settlement/))
      return {category:"Card Settlement",reason:"Existing card liability settlement; not a new purchase."};
    if(contains(description,/self.transfer|trf ke rek|wise transfer to|bank transfer to self|top.up (wallet|gopay|rekening)/))
      return {category:"Transfers & Movements",reason:"Money movement; verify its recipient and accounting treatment."};
    if(contains(description,/reconciliation adjustment|balance adjustment/))
      return {category:"Account Reconciliation",reason:"Balance adjustment; not ordinary spending."};
    if(contains(description,/matific|splashlearn|scite\.ai|researchrabbit|anemometer|quantum par meter|conference registration/))
      return {category:"Research & Education",reason:"Educational software or research-related equipment."};
    if(contains(description,/chatgpt|bitwarden|huggingface|\.com domain|domain renewal|perpanjangan domain|paypal .*spaceship/))
      return {category:"Software/Service",reason:"Software subscription or domain service."};
    if(contains(description,/bus|railroad|hokuriku railroad|北陸鉄道|train ticket|tiket kereta|ico(ca)? charge|shinkansen/))
      return {category:"Transportation",reason:"Public transport or transit payment."};
    if(contains(description,/electricity|hokuriku electricity|北陸電力|listrik/))
      return {category:"Electricity",reason:"Electricity provider charge."};
    if(contains(description,/water bill|pdam|air bersih/))
      return {category:"Water",reason:"Water utility bill."};
    if(contains(description,/ic(o|i)ca.*?charge|shower.*?locker|agoda|hotel booking/))
      return {category:"Travel & Accommodation",reason:"Travel facility or lodging."};
    if(contains(description,/mouse pad|usb.c hub|monitor|adapter|game(sir)? controller|galaxy tab|iphone|ipad|ibox.*\d+\/12/))
      return {category:"Elektronik",reason:"Specific electronic device or accessory."};
    if(contains(description,/laundry bag|trash bag|garbage bag|pembersih|curtain|heater|humidifier|household soap/))
      return {category:"Household Supplies",reason:"Household equipment or consumable."};
    if(contains(description,/dorayaki|ramyun|kitkat|chocolate|cacao|tahu|beras|rice|sa(u|)s pedas/))
      return {category:"Food & Dining",reason:"Identifiable food or ingredient."};
    if(contains(description,/swimming ticket|tiket (club )?renang/))
      return {category:"Entertainment",reason:"Swimming or recreation entry."};
    if(contains(description,/visa card fee|admin fee|biaya (admin|transfer)|increase limit fee/))
      return {category:"Taxes & Fees",reason:"Explicit administration fee."};
    if(contains(description,/mobile (data|esim)|airalo|viber subscription/))
      return {category:"Mobile",reason:"Mobile service."};
    if(contains(description,/amazon|temu|tokopedia|shopee|aeon|lawson|familymart|seven.eleven/)) {
      return {category:"Belanja",reason:"Merchant is known, but item type is not; review before applying."};
    }
    return null; // Unknown merchants are never automatically invented.
  }
  const api={suggest,categories:vocabulary};
  if(typeof window!=="undefined")window.FinanceCategoryStandards=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
