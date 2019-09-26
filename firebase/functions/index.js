'use strict';

const functions = require('firebase-functions');
const { WebhookClient } = require('dialogflow-fulfillment');
const { Card, Suggestion } = require('dialogflow-fulfillment');
const { WebClient } = require('@slack/web-api');

process.env.DEBUG = 'dialogflow:debug';

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    const slackClient = new WebClient(functions.config().slack.token);

    const { data } = request.body.originalDetectIntentRequest.payload;
    const botUserId = data.authed_users;
    const { event } = data;
    const { channel } = event;


    function setScore(agent) {
        agent.add(`Done, I... n points to ...`);
        getScore(agent);
    }

    function getScore(agent) {
        agent.add(new Card({
            title: `Leaderboard`,
            text: `Enrique: 1 /n Jose: 2`,
        }));
    }

    const getMemberInfo = async user => {
        return await slackClient.users.info({ user });
    };

    function setPlayers(agent) {
        agent.add(`Done, players have been set.`);
        (async() => {
            const res = await slackClient.channels.info({ channel });
            const { members } = res.channel;
            const players = await Promise.all(members.map(user => getMemberInfo(user)));
            const playersName = players.filter(p => p.user.id != botUserId).map(p => p.user.real_name);
            console.log("All players", playersName);
        })();
    }



    let intentMap = new Map();
    intentMap.set('Set Score Intent', setScore);
    intentMap.set('Get Score Intent', getScore);
    intentMap.set('Set Players Intent', setPlayers);
    agent.handleRequest(intentMap);
});