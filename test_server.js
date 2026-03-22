const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(3001, () => console.log('Minimal server running on 3001'));
setTimeout(() => {}, 10000); // Keep alive for 10s
