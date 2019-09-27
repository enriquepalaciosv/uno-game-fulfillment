'use strict';

const functions = require('firebase-functions');
const { WebhookClient } = require('dialogflow-fulfillment');
const { Card, Suggestion } = require('dialogflow-fulfillment');
const { WebClient } = require('@slack/web-api');
const Firestore = require('@google-cloud/firestore');

const SLACK_TOKEN = functions.config().slack.token;
const FIREBASE_PROJECT_ID = 'uno-evxcyh';
const COLLECTION_NAME = 'uno-leaderboard';

process.env.DEBUG = 'dialogflow:debug';

const slack = new WebClient(SLACK_TOKEN);
const firestore = new Firestore({ projectId: FIREBASE_PROJECT_ID });

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    const { data } = request.body.originalDetectIntentRequest.payload;
    const botUserId = data.authed_users;
    const { event } = data;
    const { channel } = event;

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
                snapshot.forEach(doc => players.push(doc.data()));
                return players;
            })
            .catch(err => console.log(err));
    }

    const formatPlayersScore = players => {
        let playersInline = '';
        players.forEach(p => {
            playersInline += `${p.player}: ${p.score} \n`;
        });
        return playersInline;
    };

    const showLeaderboard = players => {
        agent.add(new Card({
            title: `Leaderboard`,
            text: players.length ? formatPlayersScore(players) : 'No score yet'
        }));
    };

    function setScore(agent) {
        //TODO: find player and update, return doesn't exists
        agent.add(`N points to ...`);
    }

    const getScore = agent => {
        return new Promise(async(resolve, reject) => {
            const players = await findAll();
            showLeaderboard(players);
            return resolve();
        });
    }

    const setPlayers = agent => {
        return new Promise(async(resolve, reject) => {
            const res = await slack.channels.info({ channel });
            const { members } = res.channel;
            const membersData = await Promise.all(members.map(user => getMemberInfo(user)));
            const membersName = membersData.filter(p => p.user.id != botUserId).map(p => p.user.real_name);
            const alreadyPlayers = await findAll();
            const newPlayers = membersName.filter(name => !alreadyPlayers.find(p => p.player == name));
            await Promise.all(persistPlayers(newPlayers, channel));
            const allPlayers = await findAll();
            agent.add('Done, players have been set');
            showLeaderboard(allPlayers);
            return resolve();
        });
    }

    let intentMap = new Map();
    intentMap.set('Set Score Intent', setScore);
    intentMap.set('Get Score Intent', getScore);
    intentMap.set('Set Players Intent', setPlayers);
    agent.handleRequest(intentMap);
});