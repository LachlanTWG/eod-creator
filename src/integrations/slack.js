const https = require('https');
const http = require('http');

/**
 * Send a message to a Slack channel via incoming webhook URL.
 * @param {string} webhookUrl - Slack incoming webhook URL
 * @param {string} text - The message text to send
 * @param {string} [channel] - Optional channel override
 * @returns {Promise<void>}
 */
async function sendSlackMessage(webhookUrl, text, channel, { username, icon_emoji } = {}) {
  if (!webhookUrl) {
    console.warn('No Slack webhook URL configured, skipping Slack send.');
    return;
  }

  const payload = {
    text,
    username: username || 'Sales Reporter',
    icon_emoji: icon_emoji || ':chart_with_upwards_trend:',
  };
  if (channel) payload.channel = channel;

  const body = JSON.stringify(payload);
  const url = new URL(webhookUrl);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Slack webhook returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a message to a Slack channel via the Web API (chat.postMessage) using a
 * bot token. Used for clients configured with a channelId instead of a webhook.
 * Requires SLACK_BOT_TOKEN in the environment and the bot invited to the channel.
 * Custom username/icon_emoji require the app's `chat:write.customize` scope.
 * @param {string} token - Bot User OAuth Token (xoxb-...)
 * @param {string} channel - Channel ID (e.g. C0BAT3F8JQ5)
 * @param {string} text - The message text to send
 * @returns {Promise<void>}
 */
async function sendSlackViaBotToken(token, channel, text, { username, icon_emoji } = {}) {
  const payload = { channel, text };
  if (username) payload.username = username;
  if (icon_emoji) payload.icon_emoji = icon_emoji;

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); }
        catch { return reject(new Error(`Slack chat.postMessage bad response (${res.statusCode}): ${data}`)); }
        if (json.ok) resolve();
        else reject(new Error(`Slack chat.postMessage error: ${json.error}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a report to a company's Slack channel.
 * All report types (EOD, EOW, EOM, EOY) go to the same channel per client.
 * Supports two modes: a per-client incoming webhook (slack.webhookUrl) or a
 * shared bot token (SLACK_BOT_TOKEN) posting to slack.channelId.
 * @param {object} company - Company config object
 * @param {string} reportType - 'eod', 'eow', 'eom', 'eoy'
 * @param {string} message - The report message
 */
async function sendReportToSlack(company, reportType, message, opts) {
  const slack = company.slack || {};

  if (slack.webhookUrl) {
    await sendSlackMessage(slack.webhookUrl, message, undefined, opts);
    console.log(`Sent ${reportType.toUpperCase()} to Slack (webhook) for ${company.name}.`);
    return;
  }

  if (slack.channelId && process.env.SLACK_BOT_TOKEN) {
    await sendSlackViaBotToken(process.env.SLACK_BOT_TOKEN, slack.channelId, message, opts || {});
    console.log(`Sent ${reportType.toUpperCase()} to Slack (bot) for ${company.name}.`);
    return;
  }

  console.warn(`No Slack config for ${company.name} (need webhookUrl, or channelId + SLACK_BOT_TOKEN), skipping.`);
}

module.exports = { sendSlackMessage, sendSlackViaBotToken, sendReportToSlack };
