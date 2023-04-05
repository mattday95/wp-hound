const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const runScan = require('./scanner');
// const scanner = require('./scanner');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/scan', async (req, res) => {
  const plugins = await runScan(req.body);
  res.json(plugins);
});

app.listen(3000, () => console.log('Listening on port 3000'));