const express = require("express")
const cors = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()
app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

app.get("/", (req, res) => {
  res.send("Tally Order Server Running")
})

app.post("/order", async (req, res) => {

  const { item, qty, rate, customers } = req.body

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
    ])

  if (error) {
    return res.status(500).json(error)
  }

  res.json({ message: "Order stored successfully" })
})

app.listen(3000, () => {
  console.log("Server running on port 3000")
})
