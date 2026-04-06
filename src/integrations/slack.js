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
 * Send a report to a company's Slack channel.
 * One webhook per client — all report types (EOD, EOW, EOM, EOY) go to the same channel.
 * @param {object} company - Company config object
 * @param {string} reportType - 'eod', 'eow', 'eom', 'eoy'
 * @param {string} message - The report message
 */
async function sendReportToSlack(company, reportType, message, opts) {
  const slack = company.slack;
  if (!slack || !slack.webhookUrl) {
    console.warn(`No Slack webhook for ${company.name}, skipping.`);
    return;
  }

  await sendSlackMessage(slack.webhookUrl, message, undefined, opts);
  console.log(`Sent ${reportType.toUpperCase()} to Slack for ${company.name}.`);
}

module.exports = { sendSlackMessage, sendReportToSlack };
