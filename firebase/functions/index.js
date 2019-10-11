'use strict';

const functions = require('firebase-functions');
const { WebhookClient } = require('dialogflow-fulfillment');
const { Card } = require('dialogflow-fulfillment');
const { WebClient } = require('@slack/web-api');
const Firestore = require('@google-cloud/firestore');

const SLACK_TOKEN = functions.config().slack.token;
const FIREBASE_PROJECT_ID = functions.config().app.project_id;
const COLLECTION_NAME = functions.config().app.collection_name;;

process.env.DEBUG = 'dialogflow:debug';

const slack = new WebClient(SLACK_TOKEN);
const firestore = new Firestore({ projectId: FIREBASE_PROJECT_ID });

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    const { data } = request.body.originalDetectIntentRequest.payload;
    const botUserId = data.authed_users;
    const { event } = data;
    const { channel, channel_type } = event;

    const getMemberInfo = async user => {
        return await slack.users.info({ user });
    };

    const persistPlayers = (players, channel) => {
        return players.map(player => {
            const created = new Date().getTime();
            const newPlayer = { created, player, channel, score: 0 }
            return persist(newPlayer);
        });
    }

    const persist = async player => {
        return await firestore.collection(COLLECTION_NAME).add(player);
    }

    const findAll = () => {
        return firestore.collection(COLLECTION_NAME).get()
            .then(snapshot => {
                const players = [];
                snapshot.forEach(doc => {
                    var playerData = doc.data();
                    if (playerData.channel === channel) {
                        players.push({ ...playerData, id: doc.id });
                    }
                });
                const sorted = players.sort((a, b) => (b.score - a.score));
                return sorted;
            })
            .catch(err => console.log(err));
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
            const newValues = { ...selected, score: selected.score + points };
            await firestore.doc(`${COLLECTION_NAME}/${selected.id}`).update(newValues);
            return selected;
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
            agent.add(`${Points} points to ${updated.player}`);
            const players = await findAll();
            showLeaderboard(players);
        } else {
            agent.add(':no:');
        }
    }

    const getScore = async () => {
        const players = await findAll();
        const { name } = await getChannelInfo(channel);
        showLeaderboard(players, name);
    }

    const setPlayers = agent => {
        return new Promise(async (resolve, reject) => {
            const res = await getChannelInfo({ channel });
            const { members, name } = res.channel;
            const membersData = await Promise.all(members.map(user => getMemberInfo(user)));
            const membersName = membersData.filter(p => p.user.id != botUserId).map(p => p.user.real_name);
            const alreadyPlayers = await findAll();
            const newPlayers = membersName.filter(name => !alreadyPlayers.find(p => p.player == name));
            await Promise.all(persistPlayers(newPlayers, channel));
            const allPlayers = await findAll();
            agent.add('Done, players have been set');
            showLeaderboard(allPlayers, name);
            return resolve();
        });
    }

    let intentMap = new Map();
    intentMap.set('Set Score Intent', setScore);
    intentMap.set('Get Score Intent', getScore);
    intentMap.set('Set Players Intent', setPlayers);
    agent.handleRequest(intentMap);
});