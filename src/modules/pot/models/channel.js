const sequelize = require('../sqlite_db');
const { DataTypes } = require('sequelize')

const Channel = sequelize.define("Channel", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    guild_name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: false,
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: false
    },
    filter: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [""]
    },
    add_content: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: false
    },
    replace: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {}
    },
    blacklist: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [""]
    },
    suppress_embed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    target_discord: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: []
    },
    target_telegram: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
    },
    target_line: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: false,
    },
});

module.exports = Channel