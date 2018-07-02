const MAX_PLAYER_COUNT = 10;

/**
 * 创建房间选项类
 */
export default class RoomOptions {
  constructor() {
    /**
     * 是否开启
     * @type {boolean}
     */
    this.opened = true;
    /**
     * 是否可见
     * @type {boolean}
     */
    this.visible = true;
    /**
     * 房间没人后延迟销毁时间（秒）
     * @type {number}
     */
    this.emptyRoomTtl = 0;
    /**
     * 玩家离线后踢出房间时间（秒）
     * @type {number}
     */
    this.playerTtl = 0;
    /**
     * 房间允许的最大玩家数量，最大限制为 10
     * @type {number}
     */
    this.maxPlayerCount = MAX_PLAYER_COUNT;
    /**
     * 房间自定义属性（包含匹配属性）
     * @type {Object}
     */
    this.customRoomProperties = null;
    /**
     * 匹配属性键
     * @type {Array.<string>}
     */
    this.customRoomPropertiesKeysForLobby = null;
  }

  _toMsg() {
    const options = {};
    if (!this.opened) options.open = this.opened;
    if (!this.visible) options.visible = this.visible;
    if (this.emptyRoomTtl > 0) options.emptyRoomTtl = this.emptyRoomTtl;
    if (this.playerTtl > 0) options.playerTtl = this.playerTtl;
    if (this.maxPlayerCount > 0 && this.maxPlayerCount < MAX_PLAYER_COUNT)
      options.maxMembers = this.maxPlayerCount;
    if (this.customRoomProperties) options.attr = this.customRoomProperties;
    if (this.customRoomPropertiesKeysForLobby)
      options.lobbyAttrKeys = this.customRoomPropertiesKeysForLobby;
    return options;
  }
}
