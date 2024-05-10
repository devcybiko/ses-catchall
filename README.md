# ses-catchall

This is a AWS Lambda that implements SES/Workmail Catchalls.

Workmail has no capability for sending emails to non-registered users to a default inbox. This Lambda-based solution makes it possible.

## THEORY

The 'big idea' is to forward any emails that have an "unknown" email address to the selected "default" email address. This is accomplished using SES rules.

A rule is put just before the Workmail rule that creates an SNS message with the incoming email event and sends it to a custom Lambda. 

The Lambda determines if the email is one of the already verified user emails. If it is already verified, it passes the event on to Workmail for delivery.

If the recipient is not a verified email, it will update the headers and forward it back to SES as a new email. First, it removes a number of headers (DKIM, etc...) which would interfere with forwarding the email, and sets the recipient to the `defaultEmail` (specificed in a config object). Also, because SES will not allow unverified senders to deliver email, the `TO` field is set to the `adminEmail` (eg: admin@domain.awsapps.com). Finally, this new email is forwarded to SES using the `SES.sendRawEmail()`. As a convenience, the `Reply-To` field in the forwarded email is set to the original sender, so that when you click the "Reply" button in the email client, the `To` field is set appropriately.

The trick here is that the Lambda will screen all incoming emails and look for any sent from the `adminEmail`. It assumes that anything sent from the `adminEmail` was previously forwarded and is destined for a `defaultEmail` inbox. Since the `To` field was previously reset to the `defaultEmail`, Workmail dutifully deposits it there.

## LIMITATIONS
* There is a 10MB limit on attachments in SES. Despite Workmail's 25MB limit, SES will bounce any incoming emails with more that 10MB
* There may also be some issues with multiple attachments.
* **UPDATE** The SNS message queue has a limit of 256KB which severely limits the size of attachments

## WARNINGS
* Be careful to specify the correct `defaultEmail` and `adminEmail`.
* If you mistype one of them, you could create a Lambda which infinitely replicates and forwards the same email.
* If this happens - uncomment line 68 and DEPLOY the Lambda immediately. It will take some time, but the email storm will eventually subside

```js
async function handler(SNSEvent, context, callback) {
    // return callback(null, { 'disposition': 'STOP_RULE' }); // uncomment this and DEPLOY to curtail an email storm
    let sesMsg = JSON.parse(SNSEvent.Records[0].Sns.Message); log(JSON.stringify(sesMsg, null, 2));
    let originalDestination = sesMsg.mail.destination[0]; log({ originalDestination });
```

## WORKMAIL SETUP
* It is expected that you've set up Workmail as described: https://docs.aws.amazon.com/workmail/latest/adminguide/howto-start.html
* Set up a domain and a awsapps.com domain
  * example: `agilefrontiers.com` and `agilefrontiers.awsapps.com`
* Set up a default user in the main domain and an admin user on the awsapps.com domain
  * example: `greg@agilefrontiers.com` and `admin@agilefrontiers.awsapps.com`

## LAMBDA SETUP
1. In the LAMBDA CONSOLE...
1. Click: CREATE FUNCTION
2. "Author From Scratch"
3. Function Name: `ses-default-inbox`
4. Runtime: Node.js 14.x
5. Architecture: x86_64
6. Click: CREATE FUNCTION
7. In the code, replace the index.js with the `index.js` from the repo
   1. Update the `config` object with your emails
   2. set `defaultEmail` to the default email user (eg: `greg@agilefrontiers.com`)
   3. set `adminEmail` to the admin user (eg: `admin@agilefrontiers.awsapps.com`)
   4. set `verifiedEmails` to the list of users you've already created in Workmail. Email to these users will pass unchanged to Workmail
   5. Optionally add a list of `FROM` email addresses you'd like filtered out - this is a bit of a spam filter

```
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
```
8. In the Configuration -> Permissions, click on the role name
   1. Expand the AWSLambdaBasicExecutionRole...
   2. Click Edit Policy
   3. Click JSON
   4. Add the following policy to the JSON
   5. Click REVIEW POLICY
   6. Click SAVE CHANGES

```
        {
            "Effect": "Allow",
            "Action": "ses:SendRawEmail",
            "Resource": "*"
        },
```


## SES SETUP
* in the SES HOME console...
* Click Email receiving...
* Click VIEW ACTIVE RULE SET
* Click on the Rule name for your Workmail
  * example: m-4dfb6326f56e4a06a6e...
* Under actions, create a new action
  * Select "Add Action -> Publish to Amazon SNS topic"
  * Select SNS -> Encoding UTF-8
  * Select SNS topic -> Create a SNS Topic
    * Topic Name: `<domain.name>`-sns (example: `agilefrontiers-sns`)
    * Display Name: `<domain.name>`-sns (example: `agilefrontiers-sns`)
    * Click CREATE TOPIC
    * Click the round "UP ARROW" and move the rule above the "WORKMAIL" rule
  * Click SAVE RULE

## SNS SETUP
* in the SNS console...
* Click TOPICS
* Click your new SNS topic (eg: `agilefrontiers-sns`)
* Click CREATE SUBSCRIPTION
  * Select Protocol -> AWS LAMBDA
  * Select Endpoint -> ....ses-default-inbox
  * Click CREATE SUBSCRIPTION
* Click on the EDIT button
  * Under Access Policy...
  * add `"Service": "ses.amazonaws.com",` to the Statement.Principal JSON object
  * Click SAVE CHANGES

```
{
  "Version": "2008-10-17",
  "Id": "__default_policy_ID",
  "Statement": [
    {
      "Sid": "__default_statement_ID",
      "Effect": "Allow",
      "Principal": {
        "AWS": "*",
        "Service": "ses.amazonaws.com"
      },
      "Action": [
```

## TEST IT

9. Back in the LAMBDA console... 
   1.  Click the TEST Down-arrow and select CONFIGURE TEST EVENT
   2.  replace the JSON with the contents of `test.json` from the repo
   3.  Click SAVE
   4.  Click DEPLOY (see the green "Changes Deployed" indicator)
   5.  Click TEST and see the results:
```
Test Event Name
test

Response
{
  "disposition": "CONTINUE"
}

Function Logs
START RequestId: aec50a9c-8080-4e30-9217-a8a7c5ea8c99 Version: $LATEST
2021-11-20T02:13:00.866Z	aec50a9c-8080-4e30-9217-a8a7c5ea8c99	INFO	{
  "mail": {
    "headers": [
      {
        "name": "From",
        "value": "test@example.com <admin@agilefrontiers.awsapps.com>"
      }
    ],
    "destination": [
      "test@example.com"
    ]
  },
  "content": "email content"
}
2021-11-20T02:13:00.872Z	aec50a9c-8080-4e30-9217-a8a7c5ea8c99	INFO	{ originalDestination: 'test@example.com' }
2021-11-20T02:13:00.910Z	aec50a9c-8080-4e30-9217-a8a7c5ea8c99	INFO	{
  originalLabel: 'test@example.com',
  originalFrom: 'admin@agilefrontiers.awsapps.com'
}
2021-11-20T02:13:00.910Z	aec50a9c-8080-4e30-9217-a8a7c5ea8c99	INFO	Previously forwarded to default greg@agilefrontiers.com from test@example.com by way of: admin@agilefrontiers.awsapps.com
END RequestId: aec50a9c-8080-4e30-9217-a8a7c5ea8c99
REPORT RequestId: aec50a9c-8080-4e30-9217-a8a7c5ea8c99	Duration: 65.32 ms	Billed Duration: 66 ms	Memory Size: 128 MB	Max Memory Used: 74 MB	Init Duration: 420.40 ms

Request ID
aec50a9c-8080-4e30-9217-a8a7c5ea8c99
```

## DEBUG / CONSOLE LOG
* You can mute the debugging info by comment out line 26 and uncommenting line 27. 

```js
function dummy() { }
const log = console.log;
// const log = dummy;
```

## FINAL THOUGHTS

* This is a bit of a hack. 
* It seems like a simple thing to implement and I'm surprised the AWS Workmail team hasn't implemented such a feature before now. 
* There may be some financial reasons since AWS charges $4.00 per month for each "user". 
* While you *can* create aliases, it is a bit of a headache to try and configure EVERY possible special-purpose email address as an alias.
* Although, it may be an anti-spam feature to require all aliases to be pre-defined. 
* Best wishes, and Continued Success!

Greg Smith
- greg@agilefrontiers.com
- 11/19/2021
