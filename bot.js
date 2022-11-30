const WebSocket = require("ws");
const { murmur2 } = require("murmurhash-js");
const { HttpsProxyAgent } = require("https-proxy-agent");
const fs = require("fs");
const Reader = require("./core/reader.js");
const algorithm = require("./core/algorithm.js");
const buffers = require("./core/buffers.js");
const Entity = require("./core/entity.js");

const proxyList = fs.readFileSync('./proxies.txt', 'utf8').trim().split('\n');

var game = {
    ip: "",
    url: "",
    protocolVersion: 0,
    clientVersion: 0,
    mouseX: 0,
    mouseY: 0,
    followMouse: false,
    bots: []
};

function calculateDistance(botX, botY, targetX, targetY) {
    return Math.hypot(targetX - botX, targetY - botY)
};

class Bot {
    constructor(id) {
        this.id = id;
        this.name = `FreeBots#${this.id}`;
        this.list = proxyList[this.id].split(":");
        this.proxy = `http://${this.list[0]}:${this.list[1]}`;
        this.agent = new HttpsProxyAgent(this.proxy);
        this.encryptionKey = null;
        this.decryptionKey = null;
        this.offsetX = null;
        this.offsetY = null;
        this.cellsIDs = [];
        this.viewportEntities = {};
        this.ws = null;
        this.connect();
    };

    connect() {
        this.ws = new WebSocket(game.ip, {
            headers: {
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "es-419,es;q=0.9",
                "Cache-Control": "no-cache",
                "Connection": "Upgrade",
                "Host": game.url,
                "Origin": "https://agar.io",
                "Pragma": "no-cache",
                "Upgrade": "websocket",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
            },
            agent: this.agent,
            rejectUnauthorized: false
        });

        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = this.onopen.bind(this);
        this.ws.onmessage = this.onmessage.bind(this);
        this.ws.onerror = this.onerror.bind(this);
        this.ws.onclose = this.onclose.bind(this);

    };

    send(buffer) {
        if(this.ws && this.ws.readyState === WebSocket.OPEN) {
            if(this.encryptionKey) {
                buffer = algorithm.rotateBufferBytes(buffer, this.encryptionKey, false);
                this.encryptionKey = algorithm.rotateEncryptionKey(this.encryptionKey);
            };
            this.ws.send(buffer);
        };
    };

    onopen() {
        this.send(buffers.protocolVersion(game.protocolVersion));
        this.send(buffers.clientVersion(game.clientVersion));
        console.log(`Bot: ${this.id} Connected to ${this.ws.url}!`);
    };

    onmessage(data) {
        if(this.decryptionKey) {
            let message = algorithm.rotateBufferBytes(data, this.decryptionKey ^ game.clientVersion, true);
            this.handleBuffer(message.data);
        } else {
            this.handleBuffer(data.data);
        };
    };

    onerror(error) {
        console.log(`Bot: ${this.id} ${error.error}`);
    };

    onclose() {
    };

    handleBuffer(buffer) {
        const reader = new Reader(buffer, true);
        switch(reader.readUint8()) {
            case 32: {
                setInterval(() => {
                    this.move();
                }, 40);
                break;
            };
            case 241: {
                this.decryptionKey = reader.readUint32();
                this.encryptionKey = murmur2(`${game.url}${reader.readString()}`, 255);
                break;
            };
            case 242: {
                setInterval(() => {
                    this.send(buffers.spawn(this.name));
                }, 2000);
                break;
            };
            case 255: {
                this.handleCompressedBuffer(algorithm.uncompressBuffer(new Uint8Array(reader.dataView.buffer.slice(5)), new Uint8Array(reader.readUint32())));
                break;
            };
        };
    };

    handleCompressedBuffer(buffer) {
        const reader = new Reader(buffer.buffer, true);
        switch(reader.readUint8()) {
            case 16: {
                this.updateViewportEntities(reader);
                break;
            };
            case 64: {
                this.updateOffset(reader);
                break;
            };
        };
    };

    updateViewportEntities(reader) {
        const eatRecordLength = reader.readUint16()
        for (let i = 0; i < eatRecordLength; i++) reader.byteOffset += 8
        while (true) {
            const id = reader.readUint32()
            if (id === 0) break
            const entity = new Entity()
            entity.id = id
            entity.x = reader.readInt32()
            entity.y = reader.readInt32()
            entity.size = reader.readUint16()
            const flags = reader.readUint8()
            const extendedFlags = flags & 128 ? reader.readUint8() : 0
            if (flags & 1) entity.isVirus = true
            if (flags & 2) reader.byteOffset += 3
            if (flags & 4) reader.readString()
            if (flags & 8) entity.name = decodeURIComponent(escape(reader.readString()))
            if (extendedFlags & 1) entity.isPellet = true
            if (extendedFlags & 4) reader.byteOffset += 4
            if (this.viewportEntities[entity.id] && this.viewportEntities[entity.id].name && entity.name) entity.name = this.viewportEntities[entity.id].name
            this.viewportEntities[entity.id] = entity
        }
        const removeRecordLength = reader.readUint16()
        for (let i = 0; i < removeRecordLength; i++) {
            const removedEntityID = reader.readUint32()
            if (this.cellsIDs.includes(removedEntityID)) this.cellsIDs.splice(this.cellsIDs.indexOf(removedEntityID), 1)
            delete this.viewportEntities[removedEntityID]
        }
    }

    updateOffset(reader) {
        const left = reader.readDouble();
        const top = reader.readDouble();
        const right = reader.readDouble();
        const bottom = reader.readDouble();
        if (right - left < 14000 && bottom - top < 14000) {
        } else {
            this.offsetX = (left + right) / 2;
            this.offsetY = (top + bottom) / 2;
        };
    };

    getClosestEntity(type, botX, botY, botSize) {
        let closestDistance = Infinity
        let closestEntity = null
        for (const entity of Object.values(this.viewportEntities)) {
            let isConditionMet = false
            switch (type) {
                case 'biggerPlayer':
                    isConditionMet = !entity.isVirus && !entity.isPellet && entity.size > botSize * 1.15 && entity.name !== this.name
                    break
                case 'pellet':
                    isConditionMet = !entity.isVirus && entity.isPellet
                    break
            }
            if (isConditionMet) {
                const distance = calculateDistance(botX, botY, entity.x, entity.y)
                if (distance < closestDistance) {
                    closestDistance = distance
                    closestEntity = entity
                }
            }
        }
        return {
            distance: closestDistance,
            entity: closestEntity
        }
    };

    move() {
        const bot = {
            x: 0,
            y: 0,
            size: 0
        }
        for (const id of this.cellsIDs) {
            const cell = this.viewportEntities[id]
            if (cell) {
                bot.x += cell.x / this.cellsIDs.length
                bot.y += cell.y / this.cellsIDs.length
                bot.size += cell.size
            }
        }

        const closestBiggerPlayer = this.getClosestEntity('biggerPlayer', bot.x, bot.y, bot.size)
        const closestPellet = this.getClosestEntity('pellet', bot.x, bot.y, bot.size)

        if (10 < 0) {
            if (game.followMouse === true) {
                this.send(buffers.move(game.mouseX + this.offsetX, game.mouseY + this.offsetY, this.decryptionKey))
            }
            else {
                if (closestBiggerPlayer.entity && closestBiggerPlayer.distance < Math.sqrt(closestBiggerPlayer.entity.size * 100 / Math.PI) + 420) {
                    const angle = (Math.atan2(closestBiggerPlayer.entity.y - bot.y, closestBiggerPlayer.entity.x - bot.x) + Math.PI) % (2 * Math.PI)
                    this.send(buffers.move(14142 * Math.cos(angle), 14142 * Math.sin(angle), this.decryptionKey))

                } else if (closestPellet.entity) this.send(buffers.move(closestPellet.entity.x, closestPellet.entity.y, this.decryptionKey))
                else if (!closestBiggerPlayer.entity && !closestPellet.entity) {
                    const random = Math.random()
                    const randomX = ~~(1337 * Math.random())
                    const randomY = ~~(1337 * Math.random())
                    if (random > 0.5) this.send(buffers.move(bot.x + randomX, bot.y - randomY, this.decryptionKey))
                    else if (random < 0.5) this.send(buffers.move(bot.x - randomX, bot.y + randomY, this.decryptionKey))
                }
            }
        } else {
            if (closestBiggerPlayer.entity && closestBiggerPlayer.distance < Math.sqrt(closestBiggerPlayer.entity.size * 100 / Math.PI) + 420) {
                const angle = (Math.atan2(closestBiggerPlayer.entity.y - bot.y, closestBiggerPlayer.entity.x - bot.x) + Math.PI) % (2 * Math.PI)
                this.send(buffers.move(14142 * Math.cos(angle), 14142 * Math.sin(angle), this.decryptionKey))
            } else if (closestPellet.entity) this.send(buffers.move(closestPellet.entity.x, closestPellet.entity.y, this.decryptionKey))
            else if (!closestBiggerPlayer.entity && !closestPellet.entity) {
                const random = Math.random()
                const randomX = ~~(1337 * Math.random())
                const randomY = ~~(1337 * Math.random())
                if (random > 0.5) this.send(buffers.move(bot.x + randomX, bot.y - randomY, this.decryptionKey))
                else if (random < 0.5) this.send(buffers.move(bot.x - randomX, bot.y + randomY, this.decryptionKey))
            }
        }

    };

};

let server = new WebSocket.Server({
    port: 6969
});

server.on("connection", ws => {
    let id = 0;
    ws.on("message", buffer => {
        buffer = new Uint8Array(buffer);
        const reader = new Reader(buffer.buffer, true);
        switch(reader.readUint8()) {
            case 0: {
                game.ip = reader.readString();
                game.url = game.ip.replace("wss://", "");
                game.url = game.url.replace(":443", "");
                game.url = game.url.replace(/\?party_id=(\w+)/, "");
                game.protocolVersion = reader.readUint32();
                game.clientVersion = reader.readUint32();
                setInterval(() => {
                    if(id < proxyList.length) {
                        game.bots.push(new Bot(id));
                        id++;
                    };
                }, 300);
                console.log("Bots Starting...");
                break;
            };
            case 1: {
                for(const i in game.bots) game.bots[i].send(new Uint8Array([17]));
                console.log("Split!");
                break;
            };
            case 2: {
                for(const i in game.bots) game.bots[i].send(new Uint8Array([21]));
                break;
            };
            case 3: {
                game.followMouse = true;
                break;
            };
            case 4: {
                game.followMouse = false;
                break;
            };
            case 10: {
                game.mouseX = reader.readInt32();
                game.mouseY = reader.readInt32();
                break;
            };
        };
    });
});
