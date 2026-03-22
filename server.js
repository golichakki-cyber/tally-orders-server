require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Twilio sends data as application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());

// Global logger for debugging tunnels
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url} from ${req.ip}`);
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Initialize Twilio
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.get("/", (req, res) => {
  res.send("Tally Order Server Running with WhatsApp Integration");
});

app.get("/ping", (req, res) => {
  console.log("[Ping] Received request at /ping");
  res.send("Server is reachable!");
});

const fs = require('fs');
const path = require('path');

// Helper to load drivers
function getDrivers() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'drivers.json'), 'utf8');
    return JSON.parse(data).drivers;
  } catch (err) {
    console.error("Error loading drivers.json:", err.message);
    return [];
  }
}

// Helper to normalize WhatsApp phone numbers
function normalizePhone(p) {
  if (!p) return "";
  let clean = p.trim().replace(/\s/g, ""); // strip all spaces
  if (clean.startsWith("whatsapp:") && !clean.includes(":+")) {
    clean = clean.replace("whatsapp:", "whatsapp:+");
  }
  return clean;
}

app.post("/whatsapp", async (req, res) => {
  const message = (req.body.Body || "").trim();
  const msg = message.toLowerCase();
  const phoneRaw = req.body.From || "";
  const phone = normalizePhone(phoneRaw);
  const messageId = req.body.MessageSid;

  console.log(`[WhatsApp] Incoming from [${phone}]: ${message}`);

  const drivers = getDrivers();
  // Normalize driver phones from json too
  const isDriver = drivers.find(d => normalizePhone(d.phone) === phone);

  // 1. Detect if it's an Order FIRST (even for drivers)
  const qtyMatch = message.match(/\d+/);
  const qty = qtyMatch ? parseInt(qtyMatch[0]) : 0;

  // Potential order if there's a number and keywords or length
  const looksLikeOrder = qty > 0 && (message.toLowerCase().includes("can") || message.split(" ").length > 1);

  if (looksLikeOrder) {
    // --- CUSTOMER LOGIC ---
    // Improve address parsing: remove numbers, "cans/water/can", leading prepositions and punctuation
    let address = message.replace(/\d+/g, "").replace(/cans|water|can/gi, "").trim();
    // Remove leading prepositions (for, at, to, on) and surrounding punctuation/whitespace
    address = address.replace(/^[,.\s]*(for|at|to|on)\s+/i, "");
    address = address.replace(/^[,.\s]+/, "").trim();

    // 0. Notify Owner of New Order
    if (process.env.OWNER_PHONE) {
      try {
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: process.env.OWNER_PHONE,
          body: `🔔 *NEW ORDER RECEIVED*\n\nCustomer: ${phone}\nQty: ${qty}\nAddress: ${address || "Not provided"}`
        });
      } catch (e) { console.error(`[Owner Notification Error]: ${e.message}`); }
    }

    const { data: newOrder, error } = await supabase.from("orders").insert([
      {
        customers: phone,
        customer_phone: phone,
        item: "20l Water Can",
        qty: qty,
        rate: 150,
        address: address || "No address provided",
        order_status: "searching", // New status for broadcast
        status: "pending"
      }
    ]).select().single();

    if (!error && newOrder) {
      console.log(`[Order] New order saved: ${newOrder.id}. Broadcasting to all active drivers.`);

      // Notify Customer
      console.log(`[Order] Notifying customer [${phone}] via Twilio...`);
      try {
        const custRes = await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: phone,
          body: `Order received for ${qty} cans. Searching for an available driver... 🔍`
        });
        console.log(`[Order] Customer notification sent. SID: ${custRes.sid}`);
      } catch (e) { 
        console.error(`[Order] Twilio Customer Error: ${e.message}`); 
      }

      const activeDrivers = drivers.filter(d => d.active);
      for (const driver of activeDrivers) {
        try {
          await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: normalizePhone(driver.phone),
            body: `🚩 *NEW ORDER #${newOrder.id}*\nQty: ${qty}\nAddress: ${address || 'Check with customer'}\n\nReply *1* or *Accept* to claim this order! 🚀`
          });
        } catch (e) { 
          console.error(`[Twilio Error] Driver Broadcast [${driver.phone}]: ${e.message}`); 
        }
      }
    }
    return res.status(200).send("OK");
  }

  // 2. DRIVER COMMANDS (If not an order)
  console.log(`[Debug] isDriver: ${isDriver ? 'YES' : 'NO'} | Drivers count: ${drivers.length}`);

  if (isDriver) {
    // A. ACCEPT CLAIM (Numerical '1' or "Accept")
    if (msg === "1" || msg.includes("accept")) {
      console.log(`[Claim Debug] Phone: ${phone} | msg: ${msg}`);
      
      const { data: openOrders, error: openError } = await supabase
        .from("orders")
        .select("*")
        .eq("order_status", "searching")
        .order("id", { ascending: false })
        .limit(1);

      if (openError) console.error("[Claim Debug] Search Error:", openError.message);
      console.log(`[Claim Debug] Open Orders Found: ${openOrders ? openOrders.length : 0}`);

      if (openOrders && openOrders.length > 0) {
        const order = openOrders[0];
        console.log(`[Claim Debug] Attempting to claim Order #${order.id}`);
        
        const { data: claimData, error: claimError } = await supabase
          .from("orders")
          .update({ 
            order_status: "accepted", 
            driver_phone: phone
          })
          .eq("id", order.id)
          .is("driver_phone", null)
          .select();

        if (claimError) console.error(`[Claim Debug] Update Error:`, claimError.message);
        
        const claimedOrder = (claimData && claimData.length > 0) ? claimData[0] : null;

        if (claimedOrder) {
          console.log(`[Claim Debug] SUCCESS: Order #${order.id} claimed by ${phone}`);
          
          // Notify Driver of Success
          try {
            await client.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: phone,
              body: `✅ *ORDER #${order.id} ASSIGNED TO YOU*\n\nQty: ${order.qty}\nAddress: ${order.address}\nCust Contact: ${order.customer_phone}\n\nReply 'Y' when delivered.`
            });
          } catch (e) { console.error(`[Twilio Error] Driver Success Msg: ${e.message}`); }

          // Notify Customer of Driver Details
          try {
            await client.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: order.customer_phone,
              body: `🚚 *DRIVER ASSIGNED*\n\n${isDriver.name} is on the way! \nContact: ${phone.replace("whatsapp:", "")}\n\nThey have been provided your address.`
            });
          } catch (e) { console.error(`[Twilio Error] Customer Driver Info: ${e.message}`); }
        } else {
          // Someone else got it
          try {
            await client.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: phone,
              body: `Sorry! Order #${order.id} was just claimed by another driver. ⚡`
            });
          } catch (e) { console.error(`[Twilio Error] Claim Failed Msg: ${e.message}`); }
        }
      } else {
        try {
          await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: phone,
            body: `No open orders available at the moment.`
          });
        } catch (e) { console.error(`[Twilio Error] No Orders Msg: ${e.message}`); }
      }
      return res.status(200).send("OK");
    }

    // B. DELIVERY CONFIRMATION ('Y' or "Delivered")
    if (msg === "y" || msg.includes("delivered")) {
      console.log(`[Driver] Delivery confirmation from [${phone}]`);
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .ilike("driver_phone", phone)
        .eq("order_status", "accepted")
        .order("id", { ascending: false })
        .limit(1);

      if (orders && orders.length > 0) {
        const order = orders[0];
        await supabase.from("orders").update({
          order_status: "delivered",
          delivered_at: new Date().toISOString()
        }).eq("id", order.id);

        try {
          await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: phone,
            body: `Order #${order.id} marked as DELIVERED.\n\n*Payment Mode?*\nReply 'C' for Cash\nReply 'U' for UPI`
          });
        } catch (e) { console.error(`[Twilio Error] Delivery Prompt: ${e.message}`); }
      } else {
        try {
          await client.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: phone, body: `No active accepted orders found.` });
        } catch (e) { console.error(`[Twilio Error] No Active Accepted: ${e.message}`); }
      }
      return res.status(200).send("OK");
    }

    // C. PAYMENT MODE HANDLING
    if (msg === "c" || msg === "u" || msg.includes("cash") || msg.includes("upi")) {
      const mode = (msg === "u" || msg.includes("upi")) ? "UPI" : "Cash";
      
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .ilike("driver_phone", phone)
        .eq("order_status", "delivered")
        .is("payment_mode", null)
        .order("id", { ascending: false })
        .limit(1);

      if (orders && orders.length > 0) {
        const order = orders[0];
        await supabase.from("orders").update({ payment_mode: mode }).eq("id", order.id);

        try {
          await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: phone,
            body: `Payment recorded as *${mode}*. Thank you!`
          });
        } catch (e) { console.error(`[Twilio Error] Payment Confirmed: ${e.message}`); }

        // 🏆 OWNER NOTIFICATION (Digital Invoice)
        if (process.env.OWNER_PHONE) {
          const total = order.qty * (order.rate || 150);
          console.log(`[Invoice] Attempting to notify owner [${process.env.OWNER_PHONE}] for Order #${order.id}`);
          try {
            const ownerMsg = await client.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: process.env.OWNER_PHONE,
              body: `🧾 *DELIVERY COMPLETE - #${order.id}*\n\nCustomer: ${order.customer_phone}\nQty: ${order.qty}\nTotal: ₹${total}\nPayment: *${mode}*\nDriver: ${isDriver.name}\n\nSync to Tally is in progress...`
            });
            console.log(`[Invoice] Owner notified successfully. SID: ${ownerMsg.sid}`);
          } catch (e) { 
            console.error(`[Twilio Error] Owner Result Notification: ${e.message}`); 
          }
        } else {
          console.log(`[Invoice] Skip owner notification: OWNER_PHONE not set.`);
        }
      }
      return res.status(200).send("OK");
    }
  }

  // 3. Fallback (Ask for quantity)
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: phone,
      body: "Please send quantity (e.g., '10 water cans Hitech City')."
    });
  } catch (e) { console.error(`[Twilio Error] Fallback: ${e.message}`); }

  res.status(200).send("OK");
});

/**
 * Standard API endpoint for manual/frontend orders
 */
app.post("/order", async (req, res) => {
  const { item, qty, rate, customers } = req.body;

  const { data, error } = await supabase
    .from("orders")
    .insert([
      {
        item: item,
        qty: qty,
        rate: rate,
        customers: customers,
        status: "pending"
      }
    ]);

  if (error) {
    return res.status(500).json(error);
  }

  res.json({ message: "Order stored successfully" });
});

const PORT = process.env.PORT || 3000;
console.log(`[Startup] Attempting to start server on port ${PORT}...`);
const server = app.listen(PORT, () => {
  console.log(`[Startup] Success: Server is now listening on port ${PORT}`);
});
console.log(`[Startup] server object created: ${!!server}`);

server.on('error', (err) => {
  console.error('[Server Error Event]:', err.message);
});

server.on('close', () => {
  console.log('[Server Close Event]: The server has stopped.');
});

process.on('exit', (code) => {
  console.log(`[Process Exit Event]: Process is exiting with code: ${code}`);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});
