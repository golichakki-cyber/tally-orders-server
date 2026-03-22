require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const schedule = require('node-schedule');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const TALLY_URL = 'http://localhost:9000';
const TALLY_COMPANY = "Water Service_s";

/**
 * Returns a Tally-compatible date (YYYYMMDD).
 */
function getTallyDate() {
    const d = new Date();
    const year = d.getFullYear(); 
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}${month}01`; // 1st of month for Tally EDU
}

function generateInventoryXML(order) {
    const totalAmount = order.qty * order.rate;
    const itemName = order.item.replace('20L', '20l');
    const date = getTallyDate();
    const guid = `SUPABASE-INV-${order.id}-${Date.now()}`;

    return `
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${TALLY_COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Stock Journal" ACTION="Create">
      <DATE>${date}</DATE>
      <GUID>${guid}</GUID>
      <VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME>
      <NARRATION>Inventory Out for Driver assigned. Order ID: ${order.id}</NARRATION>
      <INVENTORYENTRIESOUT.LIST>
       <STOCKITEMNAME>${itemName}</STOCKITEMNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <RATE>${order.rate}</RATE>
       <AMOUNT>${totalAmount}</AMOUNT>
       <ACTUALQTY>${order.qty} Nos</ACTUALQTY>
       <BILLEDQTY>${order.qty} Nos</BILLEDQTY>
      </INVENTORYENTRIESOUT.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
}

function generateSalesXML(order) {
    const totalAmount = order.qty * order.rate;
    const date = getTallyDate();
    const guid = `SUPABASE-SALE-${order.id}-${Date.now()}`;

    return `
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${TALLY_COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Sales" ACTION="Create">
      <DATE>${date}</DATE>
      <GUID>${guid}</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
      <NARRATION>Sale for Driver delivered. Order ID: ${order.id} | Payment Mode: ${order.payment_mode || 'Unknown'}</NARRATION>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Cash</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <AMOUNT>-${totalAmount}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Sales</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${totalAmount}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
}

async function processOrders() {
    console.log(`[${new Date().toLocaleString()}] Checking for pending Tally syncs...`);
    
    // 1. Phase 1: INVENTORY DEDUCTION 
    // Target orders that are either 'accepted' OR 'delivered' but haven't had inventory synced yet
    const { data: pendingInventoryOrders } = await supabase
        .from('orders')
        .select('*')
        .in('order_status', ['accepted', 'delivered'])
        .eq('status', 'pending');

    if (pendingInventoryOrders && pendingInventoryOrders.length > 0) {
        console.log(`Found ${pendingInventoryOrders.length} orders pending INVENTORY DEDUCTION.`);
        for (const order of pendingInventoryOrders) {
            try {
                console.log(`Syncing INVENTORY for Order ${order.id}...`);
                const xml = generateInventoryXML(order);
                const response = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'text/xml' } });
                
                if (response.data.includes('<CREATED>1</CREATED>') || response.data.includes('<ALTERED>1</ALTERED>')) {
                    console.log(`✅ Inventory deducted for Order ${order.id}`);
                    await supabase.from('orders').update({ status: 'inventory_synced' }).eq('id', order.id);
                } else {
                    console.error(`❌ Tally Rejected Order ${order.id} (Inventory).`);
                    console.error(`[Tally Error Detail]: ${response.data.replace(/\s+/g, " ").trim()}`);
                    console.log(`[Tip]: If you see "any' to '${TALLY_COMPANY}'", check if your Tally company name matches exactly.`);
                }
            } catch (err) { console.error(`Err Order ${order.id}:`, err.message); }
        }
    }

    // 2. Phase 2: SALES SYNC
    // Target orders that are 'delivered' and have completed inventory sync
    const { data: deliveredOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('order_status', 'delivered')
        .eq('status', 'inventory_synced');

    if (deliveredOrders && deliveredOrders.length > 0) {
        console.log(`Found ${deliveredOrders.length} orders ready for SALES SYNC.`);
        for (const order of deliveredOrders) {
            try {
                console.log(`Syncing SALE for Order ${order.id}...`);
                const xml = generateSalesXML(order);
                const response = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'text/xml' } });
                
                if (response.data.includes('<CREATED>1</CREATED>') || response.data.includes('<ALTERED>1</ALTERED>')) {
                    console.log(`✅ Sale recorded for Order ${order.id}`);
                    await supabase.from('orders').update({ status: 'completed' }).eq('id', order.id);
                } else {
                    console.error(`❌ Tally Rejected Order ${order.id} (Sales).`);
                    console.error(`[Tally Error Detail]: ${response.data.replace(/\s+/g, " ").trim()}`);
                }
            } catch (err) { console.error(`Err Order ${order.id}:`, err.message); }
        }
    }
}

console.log("Tally Agent PRO (Two-Phase Sync Mode) is now active.");
processOrders();
schedule.scheduleJob('*/1 * * * *', processOrders);
