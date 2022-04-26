const fs = require("fs");
const path = require("path");
let turf = require('@turf/turf');

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
            'https://game-server.141x.io',
            'https://game-server.141x-testnet.io',
            'https://meta.141x.io',
            'https://meta.141x-testnet.io',
            'https://mportal.141x-testnet.io',
            'https://mportalgs.141x-testnet.io',
            'https://mportal.141x.io',
            'https://mportalgs.141x.io',
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
    this.hasPortalAccess = function (portalToken){
        ll.debug(`verify portal access`, {
            portalToken,
            madaxGameState: this.madaxGameState
        });
        let playerAddress = portalToken.address;
        let madaxGameState = this.madaxGameState;

        // portalToken.portalData.land.features[0].properties

        Object.keys(madaxGameState.playerItems).forEach(key => {
            let playerPosition = madaxGameState.playerPositions[`${playerAddress}`].position;
            madaxGameState.playerItems[`${key}`].land.forEach(land => {
                // control if the player is inside that land
                let polygon = turf.polygon(land.features[0].geometry.coordinates);
                if (turf.booleanIntersects(turf.point([playerPosition.lng, playerPosition.lat]), polygon)) {
                    // the player is inside the land (accesspolicy ok)
                    let landLabel = land.features[0].properties[`label`];
                    ll.debug(`the player ${playerAddress} is inside the land ${landLabel}`, {
                        land,
                        playerAddress,
                        playerPosition
                    });
                } else {
                    let landLabel = land.features[0].properties[`label`];
                    // the player is not inside the land (accesspolicy not ok)
                    ll.debug(`the player ${playerAddress} is not inside the land ${landLabel}`, {
                        land,
                        playerAddress,
                        playerPosition
                    });
                }
            })
        });
    }
    this.run = function (){
        this.portals.add("global");
        this.fps = 60;
        this.state = {}
        this.portalTokens = {}
        this.verificationMap = {}
        this.roomMap = {}
        this.madaxGameState = null;

        setInterval(() => {
            Object.keys(this.sockets).forEach(socketId => {
               let socket = this.sockets[`${socketId}`];
                let playerRoom = this.roomMap[`${socket.id}`];
                if(playerRoom){
                    socket.rooms.forEach(room => {
                        io.to(room).emit("server-state", {
                            type: "state",
                            ts: performance.now(),
                            payload: this.state[`${playerRoom}`]
                        })
                    })
                }
            });
        }, 1000/this.fps)

        // connect to the game server
        ll.debug(`connecting to game authorizer server`, process.env.GAME_AUTHORIZER_SERVER);
        let gameAuthorizerServerSocket = ioClient(process.env.GAME_AUTHORIZER_SERVER);
        gameAuthorizerServerSocket.on("connect", () => {
            ll.debug(`game authorizer server socket connect`, gameAuthorizerServerSocket.id);
        })
        gameAuthorizerServerSocket.on("connect_error", (err) => {
            ll.error(`game authorizer server connect_error due to ${err.message}`, err);
        });

        io.on("connection", (socket) => {
            ll.debug(`socket ${socket.id}: connection`);
            this.sockets[socket.id] = socket;
            ll.debug(`socket ${socket.id}: ${Object.keys(this.sockets).length} connections active`);

            //get the madax game state everytime a new player connects
            gameAuthorizerServerSocket.emit("api", {
                requestType: "getstate"
            }, (response) => {
                ll.debug(`socket ${gameAuthorizerServerSocket.id}: api:getstate response`, response);
                this.madaxGameState = response;
                let allPortals = [];
                Object.keys(this.madaxGameState.playerItems).forEach(key => {
                    let address = this.madaxGameState.playerItems[`${key}`].address;
                    this.madaxGameState.playerItems[`${key}`].land.forEach(land => {
                        let landLabel = land.features[0].properties.label;
                        let accessPolicy = land.features[0].properties.accessPolicy ?? "public";
                        allPortals.push(`${landLabel}:${address}:${accessPolicy}`)
                    })
                });
                allPortals.forEach(portal => {
                    this.portals.add(portal);
                })
                ll.debug(`available portals: ${JSON.stringify(this.portals.getPortals())}`);
            });

            socket.on("disconnect", () => {
                ll.debug(`socket ${socket.id}: disconnect (left rooms ${JSON.stringify(socket.rooms)})`);
                let playerRoom = this.roomMap[`${socket.id}`];
                delete this.sockets[socket.id];
                delete this.state[playerRoom][socket.id];
                delete this.portalTokens[socket.id];
                delete this.verificationMap[socket.id];
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
                let isAuthenticated = this.verificationMap[`${socket.id}`];
                if(isAuthenticated && this.portals.getPortals()[args[0]]){
                    let rooms = socket.rooms;
                    rooms.forEach(room => {
                        let playerRoom = this.roomMap[`${socket.id}`];
                        ll.debug(`socket ${socket.id}: leaving socket room ${room} / ${playerRoom}`);
                        this.roomMap[`${socket.id}`] = null;
                        socket.leave(room);
                    })
                    ll.debug(`socket ${socket.id}: joining room ${args[0]}`);
                    socket.join(args[0]);
                    this.roomMap[`${socket.id}`] = args[0];
                } else {
                    ll.debug(`socket ${socket.id}: room ${args[0]} doesn't exist`);
                }
            });
            // handle authentication messages
            socket.on("message", (message, callback = () => {}) => {
                // ll.debug(`socket ${socket.id}: got message "${JSON.stringify(message)}"`);

                let playerRoom = this.roomMap[`${socket.id}`];

                if(message.type === "player-position"){
                    let isAuthenticated = this.verificationMap[`${socket.id}`];
                    if(isAuthenticated){
                        this.state[`${playerRoom}`] = {
                            [socket.id]: {
                                "portalId": playerRoom,
                                "player-position": {
                                    ...message.payload
                                }
                            }
                        };
                    }
                    callback();
                } else if(message.type === "player-set-portal-token"){
                    ll.debug(`socket ${socket.id}: got message`, message);
                    // set an authentication token for this socket connection
                    this.portalTokens[`${socket.id}`] = message.payload.portalToken;
                    callback();
                } else if(message.type === "player-verify-portal-token"){
                    // verify the message signature
                    ll.debug(`socket ${socket.id}: got message`, message);
                    // set an authentication token for this socket connection
                    let portalToken = this.portalTokens[`${socket.id}`];
                    this.verificationMap[`${socket.id}`] = false;
                    // verify the message signature
                    gameAuthorizerServerSocket.emit("api", {
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
                        ll.debug(`socket ${gameAuthorizerServerSocket.id}: api:verify response`, response);
                        if(response.verifies){
                            ll.debug(`socket ${gameAuthorizerServerSocket.id}: api:verify - ok`, response.verifies);
                            this.verificationMap[`${socket.id}`] = true;
                            this.hasPortalAccess(portalToken);
                        } else {
                            ll.debug(`socket ${gameAuthorizerServerSocket.id}: api:verify - not ok`, response.verifies);
                            this.verificationMap[`${socket.id}`] = false;
                        }
                        callback();
                    });
                }
            })
        });
    }
}

let port = process.env.PORT;
httpServer.listen(port, '0.0.0.0');
ll.debug("madax-gs server is listening on port " + port);

let main = new Main();
main.run();

//catches uncaught exceptions
process.on('uncaughtException', (e) => {
    console.error("this should not have happened", e);
});