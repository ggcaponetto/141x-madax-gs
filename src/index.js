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


const app = express();
const httpServer = createServer(app);


const options = {
    cors: {
        origin: [
            ...(()=>{
                let localhostUrls = [];
                for(let i = 0; i <= 100000; i++){
                    localhostUrls.push(`http://localhost:${i.toString()}`)
                    localhostUrls.push(`http://127.0.0.1:${i.toString()}`)
                }
                return localhostUrls;
            })(),
            'https://authorizer.141x.io',
            'https://authorizer.141x-testnet.io',
            'https://meta.141x.io',
            'https://meta.141x-testnet.io',
            'https://mgs.ngrok.io',
            'https://mas.ngrok.io',
        ],
        credentials: true,
        path: '/socket.io',
    },
    allowRequest: (req, callback) => {
        const isOriginValid = true;
        callback(null, isOriginValid);
    },
};
const io = new Server(httpServer, options);

function Portals(){
    this.portals = {};
    this.add = room => this.portals[`${room}`] = {}
    this.remove = room => delete this.portals[`${room}`];
    this.getPortals = () => this.portals;
}

function Main(){
    this.sockets = {};
    this.portals = new Portals();
    this.run = function (){
        this.portals.add("PortalA");
        this.portals.add("PortalB");
        this.portals.add("PortalC");
        this.fps = 60;
        this.state = {}
        this.portalTokens = {}

        setInterval(() => {
            Object.keys(this.portals.getPortals()).forEach(portal => {
                io.to(portal).emit("server-state", {
                    type: "state",
                    payload: this.state
                })
            })
        }, 1000/this.fps)

        this.getTokenByAddressAndPassword = function getTokenByAddressAndPassword(address, password){
            return Object.keys(this.portalTokens).filter(key => {
                return (
                    this.portalTokens[`${key}`].address === address
                    && this.portalTokens[`${key}`].password === password
                )
            })[0];
        }
        // connect to the game server
        let gameServerSocket = ioClient(process.env.GAME_SERVER);
        gameServerSocket.on("connect", () => {
            ll.debug(`gameserver socket connect`, gameServerSocket);
        })

        io.on("connection", (socket) => {
            ll.debug(`socket ${socket.id}: connection`);
            this.sockets[socket.id] = socket;
            ll.debug(`socket ${socket.id}: ${Object.keys(this.sockets).length} connections active`);
            socket.on("disconnect", () => {
                ll.debug(`socket ${socket.id}: disconnect (left rooms ${JSON.stringify(socket.rooms)})`);
                delete this.sockets[socket.id];
                delete this.state[socket.id];
                delete this.portalTokens[socket.id];
                ll.debug(`socket ${socket.id}: ${Object.keys(this.sockets).length} connections active`);
            })
            socket.on("disconnecting", () => {
                ll.debug(`socket ${socket.id}: disconnect (left rooms ${JSON.stringify(socket.rooms)}) (total: ${Object.keys(this.sockets).length})`);
                socket.rooms.forEach(room => {
                    socket.to(room).emit("server-state", {
                        type: "player-disconnect",
                        payload: {
                            id: socket.id
                        }
                    })
                })
            })
            socket.on("join", (...args) => {
                if(this.portals.getPortals()[args[0]]){
                    let rooms = socket.rooms;
                    rooms.forEach(room => {
                        ll.debug(`socket ${socket.id}: leaving room ${room}`);
                        socket.leave(room);
                    })
                    ll.debug(`socket ${socket.id}: joining room ${args[0]}`);
                    socket.join(args[0]);
                } else {
                    ll.debug(`socket ${socket.id}: room ${args[0]} doesn't exist`);
                }
            });
            // handle authentication messages
            socket.on("message", (message) => {
                // ll.debug(`socket ${socket.id}: got message "${JSON.stringify(message)}"`);
                if(message.type === "player-position"){
                    this.state[`${socket.id}`] = {
                        "player-position": message.payload
                    };
                } else if(message.type === "player-set-portal-token"){
                    ll.debug(`socket ${socket.id}: got message`, message);
                    // set an authentication token for this socket connection
                    this.portalTokens[`${socket.id}`] = message.payload.portalToken;
                    // verify the message signature
                } else if(message.type === "player-verify-portal-token"){
                    ll.debug(`socket ${socket.id}: got message`, message);
                    // set an authentication token for this socket connection
                    let portalToken = this.portalTokens[`${socket.id}`];
                    // verify the message signature
                    /*gameServerSocket.emit("api", {
                        requestType: "getstate"
                    }, (response) => {
                        ll.debug(`socket ${gameServerSocket.id}: api:getstate response`, response);
                    });*/
                    gameServerSocket.emit("api", {
                        requestType: "verify",
                        payload: {
                            data: {
                                headers: {
                                    "app-id": portalToken[`app-id`],
                                    "address": portalToken[`address`],
                                    "password": portalToken[`password`]
                                },
                                payload: portalToken[`payload`]
                            }
                        }
                    }, (response) => {
                        ll.debug(`socket ${gameServerSocket.id}: api:verify response`, response);
                        if(response.verifies){
                            ll.debug(`socket ${gameServerSocket.id}: api:verify - ok`, response.verifies);
                        } else {
                            ll.debug(`socket ${gameServerSocket.id}: api:verify - not ok`, response.verifies);
                        }
                    });
                }
            })
        });
    }
}

let main = new Main();
main.run();
let port = process.env.PORT;
httpServer.listen(port);
ll.debug("madax-gs server is listening on port " + port);

//catches uncaught exceptions
process.on('uncaughtException', (e) => {
    console.error("this should not have happened", e);
});