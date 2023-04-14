const dotenv = require('dotenv');
const express = require('express');

const initScan = require('./scanner');
const bodyParser = require('body-parser');

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/scan', async (req, res) => {
  const clientIp = req.ip;
  const allowedIps = process.env.ALLOWED_IPS.split(',');
  
  if (allowedIps.includes(clientIp)) {
    const plugins = await initScan(req.body);
    res.json(plugins);
  } else {
    res.status(401).send('Unauthorized');
  }
});

app.listen(process.env.SERVER_PORT, () => console.log(`Server listening on port ${process.env.SERVER_PORT}`));