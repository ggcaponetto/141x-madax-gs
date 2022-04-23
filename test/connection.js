const fs = require("fs");
const path = require("path");

require('dotenv').config()
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client").io;

const loglevel =  require('loglevel');
const {response} = require("express");
const ll = loglevel.getLogger('main');
if (process.env.NODE_ENV === 'production') {
    ll.setLevel(ll.levels.DEBUG);
} else {
    ll.setLevel(ll.levels.DEBUG);
}


ll.debug(`connecting to game authorizer server`, "https://game-server.141x-testnet.io");
let gameAuthorizerServerSocket = ioClient("https://game-server.141x-testnet.io");
gameAuthorizerServerSocket.on("connect", () => {
    ll.debug(`game authorizer server socket connect`, gameAuthorizerServerSocket.id);
})
gameAuthorizerServerSocket.on("connect_error", (err) => {
    ll.error(`game authorizer server connect_error due to ${err.message}`);
});

//catches uncaught exceptions
process.on('uncaughtException', (e) => {
    console.error("this should not have happened", e);
});