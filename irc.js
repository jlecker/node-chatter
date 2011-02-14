/*jslint onevar: true, undef: true, newcap: true, plusplus: true, bitwise: true, devel: true, strict: true, maxerr: 50 */
/*global require, exports, setTimeout */

(function () {
"use strict";

var net = require('net'),
    util = require('util'),
    events = require('events'),
    
    parseMessage = function (msg) {
        var msgSplit, prefix, command, params, paramsString, trailingIdx, firstParamsString;
        msgSplit = msg.match(/(?:^:([^ ]+) +)?([^ ]+) *(.*)/);
        prefix = msgSplit[1];
        command = msgSplit[2];
        paramsString = msgSplit[3];
        // use regex?
        trailingIdx = paramsString.indexOf(':');
        firstParamsString = paramsString.substring(0, trailingIdx);
        params = firstParamsString.split(/ +/);
        if (params.length && params[params.length - 1] === '') {
            params.pop();
        }
        if (trailingIdx + 1) {
            params.push(paramsString.substring(trailingIdx + 1));
        }
        return [prefix, command, params];
    },
    
    parsePrefix = function (prefix) {
        return prefix.match(/([^!@]+)(?:!([^@]*))?(?:@(.*))?/).splice(1, 3);
    },
    
    Client = function (server, desiredNick, options) {
        events.EventEmitter.call(this);
        options = options || {};
        this.server = server;
        this.port = options.port || 6667;
        this.nick = desiredNick;
        this.user = options.user || 'guest';
        this.real = options.real || 'Guest';
        this.autojoin = options.join || [];
        this.debug = options.debug;
        this._connect();
    },
    
    clientAttrs = {
        _connect: function () {
            if (!this.c) {
                this.buffer = '';
                this.c = net.createConnection(this.port, this.server);
                this.c.setEncoding('utf8');
                this.c.once('connect', function () {
                    this.sendRawLine('NICK ' + this.nick);
                    this.sendRawLine('USER ' + this.user + ' 0 * :' + this.real);
                }.bind(this));
                this.c.on('data', this._receive.bind(this));
                this.c.on('end', this._disconnect.bind(this));
                this.c.on('timeout', this._disconnect.bind(this));
                this.c.on('close', this._disconnect.bind(this));
                this.ready = false;
                this.joining = {};
            }
        },
        _disconnect: function () {
            if (this.c) {
                this.ready = false;
                this.c.destroy();
                this.c = undefined;
            }
            if (this.debug) {
                console.log('IRC disconnected. Attempting re-connect in 10s...');
            }
            setTimeout(this._connect.bind(this), 10000);
        },
        _receive: function (chunk) {
            var lines;
            this.buffer += chunk;
            lines = this.buffer.split('\r\n');
            this.buffer = lines.pop();
            lines.forEach(function (msg) {
                if (this.debug) {
                    console.log('IRC Raw: ' + msg);
                }
                this._dispatch.apply(this, parseMessage(msg));
            }.bind(this));
        },
        _dispatch: function (prefix, command, params) {
            var nick, channel, callback;
            if (this.debug) {
                console.log('IRC Parsed:');
                console.log('\tPrefix: ' + prefix);
                console.log('\tCommand: ' + command);
                console.log('\tParams:');
                params.forEach(function (param, idx) {
                    console.log('\t\t' + idx + ': ' + param);
                });
            }
            switch (command) {
                case 'PING':
                    this.sendRawLine('PONG 0');
                    return;
                case 'PRIVMSG':
                    this.emit('message', params[1], parsePrefix(prefix)[0], params[0]);
                    return;
                case 'JOIN':
                    nick = parsePrefix(prefix)[0];
                    channel = params[0];
                    if (nick === this.nick && this.joining[channel]) {
                        callback = this.joining[channel];
                        delete this.joining[channel];
                        callback();
                    }
                    this.emit('joined', nick, channel);
                    return;
                case '376': // end of MOTD
                    this.ready = true;
                    if (this.autojoin.length) {
                        this.autojoin.forEach(function (channel) {
                            this.joinChannel(channel, this._autojoined.bind(this));
                        }.bind(this));
                    } else {
                        this.emit('ready');
                    }
                    return;
                case '433': // nick already in use
                    this.nick += '_';
                    this.sendRawLine('NICK ' + this.nick);
                    return;
            }
        },
        _autojoined: function () {
            if (!Object.keys(this.joining).length) {
                this.emit('ready');
            }
        },
        sendRawLine: function (line) {
            if (this.c && this.c.writable) {
                this.c.write(line + '\r\n');
            }
        },
        sendMessage: function (to, message) {
            if (this.ready) {
                this.sendRawLine('PRIVMSG ' + to + ' :' + message);
            }
        },
        joinChannel: function (channel, callback) {
            if (this.ready) {
                this.joining[channel] = callback;
                this.sendRawLine('JOIN ' + channel);
            }
        }
    },
    attr;

util.inherits(Client, events.EventEmitter);
for (attr in clientAttrs) {
    if (clientAttrs.hasOwnProperty(attr)) {
        Client.prototype[attr] = clientAttrs[attr];
    }
}

exports.parseMessage = parseMessage;
exports.parsePrefix = parsePrefix;
exports.Client = Client;
}());
