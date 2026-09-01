"use strict";

const express = require("express");
const fs = require("fs");

const net = JSON.parse(fs.readFileSync("/data/nas-config.json", "utf8"));
const PORT = net.ports.svc_jp;

const app = express();
app.use(express.json());

app.use("/api/jp", require("./routes"));

app.listen(PORT, "0.0.0.0", function () {
  console.log("svc-jp running on port " + PORT);
});
