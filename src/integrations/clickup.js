const https = require('https');

/**
 * Make a ClickUp API request.
 * @param {string} method - HTTP method
 * @param {string} path - Full API path (e.g. '/api/v2/list/123/task')
 * @param {object} [body] - Request body
 * @param {string} [apiKeyOverride] - Per-person API key (falls back to env)
 * @returns {Promise<object>} - Response data
 */
async function clickupRequest(method, path, body, apiKeyOverride) {
  const apiKey = apiKeyOverride || process.env.CLICKUP_API_KEY;
  if (!apiKey) {
    throw new Error('No ClickUp API key available.');
  }

  const bodyStr = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.clickup.com',
      path,
      method,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`ClickUp API ${res.statusCode}: ${parsed.err || parsed.error || data}`));
          }
        } catch {
          reject(new Error(`ClickUp API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- v2 API helpers ---

async function createTask(listId, name, description, options = {}, apiKey) {
  return clickupRequest('POST', `/api/v2/list/${listId}/task`, {
    name,
    description,
    markdown_description: description,
    ...options,
  }, apiKey);
}

async function commentOnTask(taskId, commentText, apiKey) {
  return clickupRequest('POST', `/api/v2/task/${taskId}/comment`, {
    comment_text: commentText,
  }, apiKey);
}

// --- v3 Docs API helpers ---

/**
 * Search for docs in a workspace.
 */
async function searchDocs(workspaceId, apiKey) {
  return clickupRequest('GET', `/api/v3/workspaces/${workspaceId}/docs`, null, apiKey);
}

/**
 * List pages in a doc.
 */
async function listDocPages(workspaceId, docId, apiKey) {
  return clickupRequest('GET', `/api/v3/workspaces/${workspaceId}/docs/${docId}/pages`, null, apiKey);
}

/**
 * Create a page in a ClickUp doc.
 * @param {string} workspaceId
 * @param {string} docId
 * @param {string} name - Page title
 * @param {string} content - Markdown content
 * @param {string} [parentPageId] - Parent page ID (for nesting under quarter)
 * @param {string} [apiKey]
 */
async function createDocPage(workspaceId, docId, name, content, parentPageId, apiKey) {
  const body = {
    name,
    content,
  };
  if (parentPageId) {
    body.parent_page_id = parentPageId;
  }
  return clickupRequest('POST', `/api/v3/workspaces/${workspaceId}/docs/${docId}/pages`, body, apiKey);
}

/**
 * Get the Australian financial year quarter string for a date.
 * FY runs July-June: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
 * Returns e.g. "Q4 - 25/26"
 */
function getAusFYQuarter(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+10:00');
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  let fyStart, fyEnd;
  if (month >= 7) {
    fyStart = year;
    fyEnd = year + 1;
  } else {
    fyStart = year - 1;
    fyEnd = year;
  }

  let quarter;
  if (month >= 7 && month <= 9) quarter = 1;
  else if (month >= 10 && month <= 12) quarter = 2;
  else if (month >= 1 && month <= 3) quarter = 3;
  else quarter = 4;

  return `Q${quarter} - ${String(fyStart).slice(-2)}/${String(fyEnd).slice(-2)}`;
}

/**
 * Find the right quarter page within the doc and create the weekly meeting page.
 * Falls back to creating at doc root if quarter page not found.
 */
async function createMeetingDocPage(title, content, dateStr) {
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID;
  const docId = process.env.CLICKUP_MEETING_DOC_ID;
  const apiKey = process.env.CLICKUP_API_KEY;

  if (!workspaceId || !docId) {
    console.warn('CLICKUP_WORKSPACE_ID or CLICKUP_MEETING_DOC_ID not set, skipping ClickUp doc creation.');
    return null;
  }

  if (!apiKey) {
    console.warn('No ClickUp API key for meeting doc, skipping.');
    return null;
  }

  // Try to find the current quarter page
  let parentPageId = null;
  try {
    const quarterName = getAusFYQuarter(dateStr);
    console.log(`  Looking for quarter page: "${quarterName}"`);
    const pagesResult = await listDocPages(workspaceId, docId, apiKey);
    const pages = pagesResult.pages || pagesResult || [];

    // Search through pages and their children for the quarter
    function findPage(pageList, targetName) {
      for (const page of pageList) {
        if (page.name && page.name.trim() === targetName) return page.id;
        if (page.pages) {
          const found = findPage(page.pages, targetName);
          if (found) return found;
        }
      }
      return null;
    }

    parentPageId = findPage(Array.isArray(pages) ? pages : [], quarterName);
    if (parentPageId) {
      console.log(`  Found quarter page: ${quarterName} (${parentPageId})`);
    } else {
      console.log(`  Quarter page "${quarterName}" not found, creating at doc root.`);
    }
  } catch (err) {
    console.warn(`  Could not list doc pages: ${err.message}. Creating at doc root.`);
  }

  // Create the page
  const page = await createDocPage(workspaceId, docId, title, content, parentPageId, apiKey);
  console.log(`  Created meeting doc page: "${title}" (ID: ${page.id || 'unknown'})`);
  return page;
}

// --- Per-person API key resolution ---

function resolveApiKey(company, salesPersonName) {
  if (salesPersonName && salesPersonName !== 'Team') {
    const person = company.salesPeople.find(p => p.name === salesPersonName);
    if (person && person.clickupApiKey) {
      return person.clickupApiKey;
    }
  }
  if (company.clickup && company.clickup.apiKey) {
    return company.clickup.apiKey;
  }
  return process.env.CLICKUP_API_KEY || null;
}

/**
 * Send a message to a ClickUp Chat channel (v3 API).
 * @param {string} workspaceId
 * @param {string} channelId - Chat channel ID (e.g. "5-90189110035-8")
 * @param {string} content - Message text
 * @param {string} [apiKey]
 */
async function sendChatMessage(workspaceId, channelId, content, apiKey) {
  return clickupRequest('POST', `/api/v3/workspaces/${workspaceId}/chat/channels/${channelId}/messages`, {
    content,
  }, apiKey);
}

/**
 * Send a report to ClickUp (individual EOD/EOW/EOM/EOY).
 * Checks chat channel first, then task/list IDs. Silently skips if nothing configured.
 */
async function sendReportToClickUp(company, reportType, title, message, salesPersonName) {
  const cu = company.clickup;
  if (!cu) return;

  const apiKey = resolveApiKey(company, salesPersonName);
  if (!apiKey) return;

  // Chat channel (v3 API)
  if (cu.chatChannelId) {
    const workspaceId = cu.workspaceId || process.env.CLICKUP_WORKSPACE_ID;
    if (workspaceId) {
      await sendChatMessage(workspaceId, cu.chatChannelId, `${title}\n\n${message}`, apiKey);
      return;
    }
  }

  const taskId = cu.taskIds && cu.taskIds[reportType];
  if (taskId) {
    await commentOnTask(taskId, `${title}\n\n${message}`, apiKey);
    return;
  }

  const listId = cu.listIds && cu.listIds[reportType];
  if (listId) {
    await createTask(listId, title, message, {}, apiKey);
    return;
  }

  if (cu.defaultListId) {
    await createTask(cu.defaultListId, title, message, {}, apiKey);
  }
}

module.exports = {
  clickupRequest,
  createTask,
  commentOnTask,
  sendChatMessage,
  resolveApiKey,
  sendReportToClickUp,
  createMeetingDocPage,
  searchDocs,
  listDocPages,
  createDocPage,
  getAusFYQuarter,
};
