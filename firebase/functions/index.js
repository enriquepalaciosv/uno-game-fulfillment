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

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    const slack = new WebClient(SLACK_TOKEN);
    const firestore = new Firestore({ projectId: FIREBASE_PROJECT_ID });

    const { data } = request.body.originalDetectIntentRequest.payload;
    const botUserId = data.authed_users;
    const { event } = data;
    const { channel } = event;


    function setScore(agent) {
        //TODO: find player and update, return doesn't exists
        agent.add(`Done, I... n points to ...`);
        getScore(agent);
    }

    function getScores(agent) {
        //TODO: read from DB
        agent.add(new Card({
            title: `Leaderboard`,
            text: `Enrique: 1`,
        }));
    }

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

    const setPlayers = agent => {
        return new Promise(async(resolve, reject) => {
            const res = await slack.channels.info({ channel });
            const { members } = res.channel;
            const players = await Promise.all(members.map(user => getMemberInfo(user)));
            const playersName = players.filter(p => p.user.id != botUserId).map(p => p.user.real_name);
            //TODO: discard players already on DB
            Promise.all(persistPlayers(playersName, channel));
            agent.add('Done, players have been set');
            agent.add(new Card({
                title: `Leaderboard`,
                text: `Enrique: 1`,
            }));
            return resolve();

        })

    }

    let intentMap = new Map();
    intentMap.set('Set Score Intent', setScore);
    intentMap.set('Get Score Intent', getScores);
    intentMap.set('Set Players Intent', setPlayers);
    agent.handleRequest(intentMap);
});