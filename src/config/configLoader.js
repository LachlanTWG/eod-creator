const fs = require('fs');
const path = require('path');

const CONFIG_DIR = __dirname;
const COMPANIES_DIR = path.join(CONFIG_DIR, 'companies');

// Default configs (trade)
const defaultOutcomes = require('./outcomes.json');
const defaultBlocks = require('./blocks.json');
const defaultFormulas = require('./formulas.json');

// Cache per-company configs
const cache = {};

/**
 * Slugify a company name for folder lookup.
 * "Tradie Web Guys" → "tradie-web-guys"
 */
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Load config (outcomes, blocks, formulas) for a company.
 * Checks for per-company overrides in config/companies/{slug}/.
 * Falls back to default trade configs.
 *
 * @param {string} [companyName] - Company name (null for defaults)
 * @returns {{ outcomes: object, blocks: object, formulas: object }}
 */
function loadConfig(companyName) {
  if (!companyName) {
    return { outcomes: defaultOutcomes, blocks: defaultBlocks, formulas: defaultFormulas };
  }

  if (cache[companyName]) return cache[companyName];

  const slug = slugify(companyName);
  const companyDir = path.join(COMPANIES_DIR, slug);

  let outcomes = defaultOutcomes;
  let blocks = defaultBlocks;
  let formulas = defaultFormulas;

  if (fs.existsSync(companyDir)) {
    const outcomesPath = path.join(companyDir, 'outcomes.json');
    const blocksPath = path.join(companyDir, 'blocks.json');
    const formulasPath = path.join(companyDir, 'formulas.json');

    if (fs.existsSync(outcomesPath)) {
      outcomes = JSON.parse(fs.readFileSync(outcomesPath, 'utf8'));
    }
    if (fs.existsSync(blocksPath)) {
      blocks = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
    }
    if (fs.existsSync(formulasPath)) {
      formulas = JSON.parse(fs.readFileSync(formulasPath, 'utf8'));
    }
  }

  const config = { outcomes, blocks, formulas };
  cache[companyName] = config;
  return config;
}

/**
 * Clear the config cache (useful after modifying config files).
 */
function clearConfigCache() {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
}

module.exports = { loadConfig, clearConfigCache, slugify };
