'use strict';

const { WebhookClient, Card } = require('dialogflow-fulfillment');
const { WebClient } = require('@slack/web-api');
const awsServerlessExpress = require('aws-serverless-express')
const aws = require('aws-sdk');
const express = require('express');
const bodyParser = require('body-parser');
const uuidv1 = require('uuid/v1');

const app = express();
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

const ENVIRONMENT = process.env.ENVIRONMENT;
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const DYNAMO_DB_API_VERSION = process.env.DYNAMO_DB_API_VERSION;
const COLLECTION_NAME = process.env.DYNAMO_DB_TABLE;
const SLACK_TOKEN = process.env.SLACK_TOKEN;

if (ENVIRONMENT === 'development') {
    aws.config.update({ region: AWS_REGION, accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY });
} else {
    aws.config.update({ region: AWS_REGION });
}
const dynamodb = new aws.DynamoDB({ apiVersion: DYNAMO_DB_API_VERSION });
const slack = new WebClient(SLACK_TOKEN);

app.use('/', (request, response) => {
    const agent = new WebhookClient({ request, response });
    const { data } = request.body.originalDetectIntentRequest.payload;
    const botUserId = data.authed_users;
    const { event } = data;
    const { channel, channel_type } = event;

    const getMemberInfo = async user => {
        return await slack.users.info({ user });
    };

    const persistPlayers = (players, channel) => {
        return new Promise(async (resolve, reject) => {
            const items = players.map(player => {
                return {
                    PutRequest: {
                        Item: {
                            "id": { S: uuidv1() },
                            "channel": { S: channel },
                            "player": { S: player },
                            "score": { N: '0' }
                        }
                    }
                }
            });
            const params = {
                RequestItems: { [COLLECTION_NAME]: items }
            };
            try {
                await dynamodb.batchWriteItem(params).promise();
                resolve();
            } catch (err) {
                console.log("DynamoDBerror", err);
                reject();
            }
        });
    }

    const findAll = () => {
        return new Promise(async (resolve, reject) => {
            const params = {
                ExpressionAttributeValues: { ':channel': { S: channel } },
                FilterExpression: 'channel = :channel',
                ProjectionExpression: 'id, channel, player, score',
                TableName: COLLECTION_NAME
            };
            try {
                const response = await dynamodb.scan(params).promise();
                const players = response.Items.map(p => {
                    return { id: p.id.S, score: Number.parseInt(p.score.N), player: p.player.S, channel: p.channel.S };
                });
                const sorted = players.sort((a, b) => (b.score - a.score));
                resolve(sorted);
            } catch (err) {
                console.log("DynamoDBerror", err);
                reject();
            }
        });
    }

    const updateScore = async (points, playerName) => {
        const players = await findAll();
        const matches = players.filter(p => {
            const name = p.player.toLowerCase().trim();
            const criteria = playerName.toLowerCase().trim();
            return name.includes(criteria) && p.channel === channel;
        }
        );
        if (matches.length > 0) {
            const selected = matches[0];
            var params = {
                TableName: COLLECTION_NAME,
                Item: {
                    'score': { N: (selected.score + points).toString() },
                    'id': { S: selected.id },
                    'player': { S: selected.player },
                    'channel': { S: selected.channel }
                }
            };
            try {
                await dynamodb.putItem(params).promise();
                return selected;
            } catch (err) {
                console.log("DynamoDBerror", err);
                return null;
            }
        } else {
            return null;
        }
    }

    const formatPlayersScore = players => {
        let playersInline = '';
        players.forEach(p => {
            playersInline += `${p.player}: ${p.score} \n`;
        });
        return playersInline;
    };

    const getChannelInfo = channel => {
        if (channel_type === 'group') {
            return slack.groups.info({ channel })
                .then(res => res.group);
        } else {
            return slack.channels.info({ channel })
                .then(res => res.channel);
        }
    };

    const showLeaderboard = (players, channelName) => {
        agent.add(new Card({
            title: `Leaderboard [${channelName}]`,
            text: players.length ? formatPlayersScore(players) : 'No score yet'
        }));
    };

    const setScore = async agent => {
        const { Points, Player } = agent.parameters;
        const updated = await updateScore(Points, Player);
        if (updated) {
            const { name } = await getChannelInfo(channel);
            agent.add(`${Points} points to ${updated.player}`);
            const players = await findAll();
            showLeaderboard(players, name);
        } else {
            agent.add(':no:');
        }
    }

    const getScore = async () => {
        const players = await findAll();
        const { name } = await getChannelInfo(channel);
        showLeaderboard(players, name);
    }

    const setPlayers = async agent => {
        const { name, members } = await getChannelInfo(channel);
        const membersData = await Promise.all(members.map(user => getMemberInfo(user)));
        const membersName = membersData.filter(p => p.user.id != botUserId).map(p => p.user.real_name);
        const alreadyPlayers = await findAll();
        const newPlayers = membersName.filter(name => !alreadyPlayers.find(p => p.player == name));
        await persistPlayers(newPlayers, channel);
        const allPlayers = await findAll();
        agent.add('Done, players have been set');
        showLeaderboard(allPlayers, name);
    }

    const resetLeaderboard = async agent => {
        const { name } = await getChannelInfo(channel);
        const players = await findAll();
        const items = players.map(p => {
            return {
                PutRequest: {
                    Item: {
                        "id": { S: p.id },
                        "channel": { S: p.channel },
                        "player": { S: p.player },
                        "score": { N: '0' }
                    }
                }
            }
        });
        const params = {
            RequestItems: { [COLLECTION_NAME]: items }
        };
        try {
            await dynamodb.batchWriteItem(params).promise();
            const updatedPlayes = players.map(p => Object.assign({ ...p, score: 0 }, {}));
            agent.add('Well... as you whish. Done!');
            showLeaderboard(updatedPlayes, name);
        } catch (err) {
            console.log("DynamoDBerror", err);
            agent.add(':no:');
        }
    };

    const intentMap = new Map();
    intentMap.set('Set Score Intent', setScore);
    intentMap.set('Get Score Intent', getScore);
    intentMap.set('Set Players Intent', setPlayers);
    intentMap.set('Reset Leaderboard - yes', resetLeaderboard);
    agent.handleRequest(intentMap);
});

if (ENVIRONMENT === 'development') {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => console.log(`App listening on port ${PORT}`));
}

const server = awsServerlessExpress.createServer(app);
exports.handler = (event, context) => { awsServerlessExpress.proxy(server, event, context) }