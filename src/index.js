const fs = require("fs");
const path = require("path");

require('dotenv').config()
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");


const loglevel =  require('loglevel');
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
                }
                return localhostUrls;
            })(),
            'https://authorizer.141x.io',
            'https://authorizer.141x-testnet.io',
            'https://meta.141x.io',
            'https://meta.141x-testnet.io',
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
        this.fps = 1;

        setInterval(() => {
            Object.keys(this.portals.getPortals()).forEach(portal => {
                io.to(portal).emit("server-state", `${portal} - ${new Date()}`)
            })
        }, 1000/this.fps)

        io.on("connection", (socket) => {
            ll.debug(`socket ${socket.id}: connection`);
            this.sockets[socket.id] = socket;
            socket.on("disconnect", () => {
                delete this.sockets[socket.id];
                ll.debug(`socket ${socket.id}: disconnect (left rooms ${JSON.stringify(socket.rooms)})`);
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

            socket.on("message", function (message){
                ll.debug(`socket ${socket.id}: got message "${message}"`);
                socket.rooms.forEach(room => {
                    socket.to(room).emit("message", message)
                })
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