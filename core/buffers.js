const Writer = require("./writer.js");

module.exports = {
    protocolVersion(version){
        const writer = new Writer(5, true);
        writer.writeUint8(254);
        writer.writeUint32(version);
        return new Uint8Array(writer.dataView.buffer);
    },
    clientVersion(version){
        const writer = new Writer(5, true);
        writer.writeUint8(255);
        writer.writeUint32(version);
        return new Uint8Array(writer.dataView.buffer);
    },
    spawn(name){
        const writer = new Writer(2 + name.length, true);
        writer.writeUint8(0);
        writer.writeString(name);
        return new Uint8Array(writer.dataView.buffer);
    },
    move(x, y, key){
        const writer = new Writer(13, true);
        writer.writeUint8(16);
        writer.writeInt32(x);
        writer.writeInt32(y);
        writer.writeInt32(key);
        return new Uint8Array(writer.dataView.buffer);
    }
};