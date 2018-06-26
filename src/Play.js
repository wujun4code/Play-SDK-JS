'use strict';

import WebSocket from 'isomorphic-ws';
import axios from 'axios';
import EventEmitter from 'eventemitter3';

import { Event } from './Event';
import { SendEventOptions } from './SendEventOptions';
import { Room } from './Room';
import { RoomOptions } from './RoomOptions';
import { Player } from './Player';
import { handleMasterMsg } from './handler/MasterHandler';
import { handleGameMsg } from './handler/GameHandler';
import { PlayVersion, MasterServerURL } from './Config';

class Play extends EventEmitter {
  static getInstance() {
    return instance;
  }

  // 初始化
  init(appId, appKey) {
    this._appId = appId;
    this._appKey = appKey;
    this._masterServer = null;
    this._msgId = 0;
    this._requestMsg = {};
    // 切换服务器状态
    this._switchingServer = false;
  }

  // 建立连接
  connect(gameVersion = '0.0.1', autoJoinLobby = true) {
    this._gameVersion = gameVersion;
    this._autoJoinLobby = autoJoinLobby;
    var self = this;
    var params = 'appId=' + this._appId + '&secure=true';
    axios
      .get(MasterServerURL + params)
      .then(function(response) {
        var data = response.data;
        console.log(data);
        self._masterServer = data.server;
        self.connectToMaster();
      })
      .catch(function(error) {
        console.log(error);
        self.emit(Event.OnConnectFailed, error.data);
      });
  }

  // 重连
  reconnect() {
    this.connectToMaster();
  }

  // 重连并重新加入房间
  reconnectAndRejoin() {
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
      cid: this._cachedRoomMsg.cid,
      rejoin: true,
    };
    this.connectToGame();
  }

  // 断开连接
  disconnect() {
    this.stopKeepAlive();
    if (this._websocket) {
      this._websocket.close();
      this._websocket = null;
    }
    console.log(this.userId + ' disconnect.');
  }

  // 连接至大厅服务器
  connectToMaster() {
    this.cleanup();
    this._switchingServer = true;
    var self = this;
    this._websocket = new WebSocket(this._masterServer);
    this._websocket.onopen = function(evt) {
      console.log('Lobby websocket opened');
      self._switchingServer = false;
      self.emit(Event.OnConnected);
      self.sessionOpen();
    };
    this._websocket.onmessage = function(msg) {
      handleMasterMsg(self, msg);
    };
    this._websocket.onclose = function(evt) {
      console.log('Lobby websocket closed');
      if (!self._switchingServer) {
        self.emit(Event.OnDisconnected);
      }
    };
    this._websocket.onerror = function(error) {
      console.error(error);
      self.emit(Event.OnConnectFailed, error.data);
    };
  }

  // 连接至游戏服务器
  connectToGame() {
    this.cleanup();
    this._switchingServer = true;
    var self = this;
    this._websocket = new WebSocket(this._secureGameAddr);
    this._websocket.onopen = function(evt) {
      console.log('Game websocket opened');
      self._switchingServer = false;
      self.sessionOpen();
    };
    this._websocket.onmessage = function(msg) {
      handleGameMsg(self, msg);
    };
    this._websocket.onclose = function(evt) {
      console.log('Game websocket closed');
      if (!self._switchingServer) {
        self.emit(Event.OnDisconnected);
      }
      self.stopKeepAlive();
    };
    this._websocket.onerror = function(error) {
      console.error(error);
      self.emit(Event.OnConnectFailed, error.data);
    };
  }

  // 加入大厅
  joinLobby() {
    var msg = {
      cmd: 'lobby',
      op: 'add',
      i: this.getMsgId(),
    };
    this.send(msg);
  }

  // 离开大厅
  leaveLobby() {
    var msg = {
      cmd: 'lobby',
      op: 'remove',
      i: this.getMsgId(),
    };
    this.send(msg);
  }

  // 创建房间
  createRoom(roomName, options = null, expectedUserIds = null) {
    if (options !== null && !(options instanceof RoomOptions)) {
      console.error('options must be RoomOptions');
      return;
    }
    if (expectedUserIds !== null && !(expectedUserIds instanceof Array)) {
      console.error('expectedUserIds must be Array with string');
      return;
    }
    // 缓存 GameServer 创建房间的消息体
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'start',
      i: this.getMsgId(),
      cid: roomName,
    };
    // 拷贝房间属性（包括 系统属性和玩家定义属性）
    if (options) {
      var opts = options.toMsg();
      for (var k in opts) {
        this._cachedRoomMsg[k] = opts[k];
      }
    }
    if (expectedUserIds) {
      this._cachedRoomMsg.expectMembers = expectedUserIds;
    }
    // Router 创建房间的消息体
    var msg = this._cachedRoomMsg;
    this.send(msg);
  }

  // 指定房间名加入房间
  // 可选：期望好友 IDs
  joinRoom(roomName, expectedUserIds = null) {
    if (expectedUserIds !== null && !(expectedUserIds instanceof Array)) {
      console.error('expectedUserIds must be Array with string');
      return;
    }
    // 加入房间的消息体
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
      cid: roomName,
    };
    if (expectedUserIds) {
      this._cachedRoomMsg.expectMembers = expectedUserIds;
    }
    var msg = this._cachedRoomMsg;
    this.send(msg);
  }

  // 重新加入房间
  rejoinRoom(roomName) {
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
      cid: roomName,
      rejoin: true,
    };
    var msg = this._cachedRoomMsg;
    this.send(msg);
  }

  // 随机加入或创建房间
  joinOrCreateRoom(roomName, options = null, expectedUserIds = null) {
    if (options !== null && !(options instanceof RoomOptions)) {
      console.error('options must be RoomOptions');
      return;
    }
    if (expectedUserIds !== null && !(expectedUserIds instanceof Array)) {
      console.error('expectedUserIds must be Array with string');
      return;
    }
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
      cid: roomName,
    };
    // 拷贝房间参数
    if (options != null) {
      var opts = options.toMsg();
      for (var k in opts) {
        this._cachedRoomMsg[k] = opts[k];
      }
    }
    if (expectedUserIds) {
      this._cachedRoomMsg.expectMembers = expectedUserIds;
    }
    var msg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
      cid: roomName,
      createOnNotFound: true,
    };
    if (expectedUserIds) {
      msg.expectMembers = expectedUserIds;
    }
    this.send(msg);
  }

  // 随机加入房间
  joinRandomRoom(matchProperties = null, expectedUserIds = null) {
    if (matchProperties !== null && !(matchProperties instanceof Object)) {
      console.error('match properties must be Object');
      return;
    }
    if (expectedUserIds !== null && !(expectedUserIds instanceof Array)) {
      console.error('expectedUserIds must be Array with string');
      return;
    }
    this._cachedRoomMsg = {
      cmd: 'conv',
      op: 'add',
      i: this.getMsgId(),
    };
    if (matchProperties) {
      this._cachedRoomMsg.expectAttr = matchProperties;
    }
    if (expectedUserIds) {
      this._cachedRoomMsg.expectMembers = expectedUserIds;
    }

    var msg = {
      cmd: 'conv',
      op: 'add-random',
    };
    if (matchProperties) {
      msg.expectAttr = matchProperties;
    }
    if (expectedUserIds) {
      msg.expectMembers = expectedUserIds;
    }
    this.send(msg);
  }

  // 设置房间开启 / 关闭
  setRoomOpened(opened) {
    var msg = {
      cmd: 'conv',
      op: 'open',
      i: this.getMsgId(),
      toggle: opened,
    };
    this.this.send(msg);
  }

  // 设置房间可见 / 不可见
  setRoomVisible(visible) {
    var msg = {
      cmd: 'conv',
      op: 'visible',
      i: this.getMsgId(),
      toggle: visible,
    };
    this.send(msg);
  }

  // 离开房间
  leaveRoom() {
    var msg = {
      cmd: 'conv',
      op: 'remove',
      i: this.getMsgId(),
      cid: this.room.name,
    };
    this.send(msg);
  }

  // 设置房主
  setMaster(nextMasterActorId) {
    var msg = {
      cmd: 'conv',
      op: 'update-master-client',
      i: this.getMsgId(),
      masterActorId: nextMasterActorId,
    };
    this.send(msg);
  }

  // 设置房间属性
  setRoomCustomProperties(properties, expectedValues = null) {
    if (!(properties instanceof Object)) {
      console.error('property must be Object');
      return;
    }
    if (expectedValues && !(expectedValues instanceof Object)) {
      console.error('expectedValue must be Object');
      return;
    }
    var props = JSON.stringify(properties);
    var msg = {
      cmd: 'conv',
      op: 'update',
      i: this.getMsgId(),
      attr: properties,
    };
    if (expectedValues) {
      msg.expectAttr = expectedValues;
    }
    this.send(msg);
  }

  // 设置玩家属性
  setPlayerCustomProperties(actorId, properties, expectedValues = null) {
    if (!(properties instanceof Object)) {
      console.error('property must be Object');
      return;
    }
    if (expectedValues && !(expectedValues instanceof Object)) {
      console.error('expectedValue must be Object');
      return;
    }
    var msg = {
      cmd: 'conv',
      op: 'update-player-prop',
      i: this.getMsgId(),
      targetActorId: actorId,
      playerProperty: properties,
    };
    if (expectedValues) {
      msg.expectAttr = expectedValues;
    }
    this.send(msg);
  }

  // 发送自定义消息
  sendEvent(eventId, eventData, options = new SendEventOptions()) {
    if (!(eventData instanceof Object)) {
      console.error('event data must be Object');
      return;
    }
    var msg = {
      cmd: 'direct',
      i: this.getMsgId(),
      eventId: eventId,
      msg: eventData,
      receiverGroup: options.receiverGroup,
      toActorIds: options.targetActorIds,
      cachingOption: options.cachingOption,
    };
    this.send(msg);
  }

  // 开始会话，建立连接后第一条消息
  sessionOpen() {
    var msg = {
      cmd: 'session',
      op: 'open',
      i: this.getMsgId(),
      appId: this._appId,
      peerId: this.userId,
      ua: PlayVersion + '_' + this._gameVersion,
    };
    this.send(msg);
  }

  // 发送消息
  send(msg) {
    var msgData = JSON.stringify(msg);
    console.log(this.userId + ' msg: ' + msg.op + ' -> ' + msgData);
    this._websocket.send(msgData);
    // 心跳包
    this.stopKeepAlive();
    var self = this;
    this._keepAlive = setTimeout(function() {
      var keepAliveMsg = {};
      self.send(keepAliveMsg);
    }, 10000);
  }

  getMsgId() {
    return this._msgId++;
  }

  stopKeepAlive() {
    if (this._keepAlive) {
      clearTimeout(this._keepAlive);
      this._keepAlive = null;
    }
  }

  cleanup() {
    if (this._websocket) {
      this._websocket.onopen = null;
      this._websocket.onconnect = null;
      this._websocket.onmessage = null;
      this._websocket.onclose = null;
      this._websocket.close();
      this._websocket = null;
    }
  }
}

var instance = new Play();

export { Play };