"use strict";
const AWS = require('aws-sdk');

const filterHeaders = [
    "Return-Path",
    "Reply-To",
    "DKIM-Signature",
    "Received-SPF",
    "Authentication-Results",
    "X-SES-RECEIPT",
    "X-SES-DKIM-SIGNATURE",
];

const config = {
    defaultEmail: "greg@agilefrontiers.com",
    adminEmail: "admin@agilefrontiers.awsapps.com",
    verifiedEmails: [
        "greg@agilefrontiers.com"
    ],
    ignoreEmails: [
        "devcybiko@gmail.com"
    ]
}

function dummy() { }
const log = console.log;
// const log = dummy;

function filterContent({ content, newFrom, replyTo }) {
    let lines = content.split("\n");
    let results = ["Reply-To: " + replyTo];
    for (let line of lines) {
        let headerKey = line.split(":", 1)[0];
        if (filterHeaders.includes(headerKey)) continue;
        if (line[0] === '\t') continue;
        if (line.startsWith("From:")) line = "From: " + replyTo + " <" + newFrom + ">";
        results.push(line);
    }
    return results.join("\n");
}

async function sendEmail({ content, source, destination }) {
    var rawParams = {
        Source: source,
        Destinations: [destination],
        RawMessage: { Data: content }
    };
    log({ rawParams });
    let ses = new AWS.SES();
    let result = await ses.sendRawEmail(rawParams).promise();
    log({ result });
}

function getFromAddress(sesMsg) {
    let from = sesMsg.mail.headers.filter(header => header.name.toLowerCase() === "from")[0].value;
    let label = from;
    let words = from.split("<");
    if (words.length > 1) {
        label = words[0].trim();
        from = words[1];
        words = from.split(">");
        from = words[0].trim();
    }
    return [label, from];
}

async function handler(SNSEvent, context, callback) {
    // return callback(null, { 'disposition': 'STOP_RULE' });
    let sesMsg = JSON.parse(SNSEvent.Records[0].Sns.Message); log(JSON.stringify(sesMsg, null, 2));
    let originalDestination = sesMsg.mail.destination[0]; log({ originalDestination });
    let [originalLabel, originalFrom] = getFromAddress(sesMsg); log({ originalLabel, originalFrom });
    config.verifiedEmails.push(config.adminEmail); // prevent loops
    config.verifiedEmails.push(config.defaultEmail); // prevent loops
    if (originalFrom === config.adminEmail) {
        console.log(`Previously forwarded to default ${config.defaultEmail} from ${originalDestination} by way of: ${originalFrom}`);
        return callback(null, { 'disposition': 'CONTINUE' });
    } else if (config.verifiedEmails.includes(originalDestination)) {
        // it was destined for one of the verified email addresses... let it pass through
        console.log(`Verified email to ${originalDestination}... let it pass through`);
        return callback(null, { 'disposition': 'CONTINUE' });
    } else if (config.ignoreEmails.includes(originalFrom)) {
        console.log(`Ignoring email from: ${originalDestination}`);
        return callback(null, { 'disposition': 'STOP_RULE' });
    } else {
        console.log(`Fowarding ${originalDestination} to default ${config.defaultEmail} by way of: ${config.adminEmail}`);
        let newContent = filterContent({ content: sesMsg.content, newFrom: config.adminEmail, replyTo: originalFrom }); log({ newContent });
        await sendEmail({ content: newContent, source: originalDestination, destination: config.defaultEmail });
        return callback(null, { 'disposition': 'STOP_RULE' });
    }
}

exports.handler = handler;

const event = {
    "Records": [
        {
            "EventSource": "aws:sns",
            "EventVersion": "1.0",
            "EventSubscriptionArn": "arn:aws:sns:us-east-1:123456789012:IncomingEmail:12345678",
            "Sns": {
                "Type": "Notification",
                "MessageId": "EXAMPLE7c191be45-e9aedb9a-02f9-4d12-a87d-dd0099a07f8a-000000",
                "TopicArn": "arn:aws:sns:us-east-1:123456789012:IncomingEmail",
                "Subject": "Amazon SES Email Receipt Notification",
                "Message": "{\"mail\": {\"headers\":[{\"name\":\"From\",\"value\":\"test@example.com <admin@agilefrontiers.awsapps.com>\"}],\"destination\":[\"test@example.com\"]},\"content\":\"email content\"}"
            },
            "Timestamp": "2019-09-06T18:52:16.076Z",
            "SignatureVersion": "1",
            "Signature": "012345678901example==",
            "SigningCertUrl": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-01234567890123456789012345678901.pem",
            "UnsubscribeUrl": "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:0123456789012:IncomingEmail:0b863538-3f32-462e-9c89-8d8e0example",
            "MessageAttributes": {}
        }
    ]
}

// handler(event, null, null);
