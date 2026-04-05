const { writeSheet, clearRange } = require('./writeSheet');
const { loadConfig } = require('../config/configLoader');

const AL = "'Activity Log'";
const SEP = '----------------------------';
const WSEP = '------------------------------------------';
const RN = 10000; // bounded range limit for array formulas

// ─── Dynamic Outcome Definitions ────────────────────────────────────

/**
 * Build outcome definitions dynamically from company config.
 * Returns { defs, rowMap } where defs are outcome objects and
 * rowMap maps outcome names to their sheet row numbers.
 */
function getOutcomeDefs(ownerName, companyName) {
  const { outcomes, formulas } = loadConfig(companyName);
  const defs = [];
  let row = 8; // outcomes start at row 8 (rows 1-5 config, 6 blank, 7 header)
  const rowMap = {};

  for (const outcome of outcomes.outcomes) {
    const name = outcome.name.replace('{owner}', ownerName);
    const templateName = outcome.name;
    const category = outcome.category;
    const formulaEntry = formulas.outcomeFormulas[templateName] || { eod: 1, eow: 1 };

    const def = { row, name, eodF: formulaEntry.eod, eowF: formulaEntry.eow, category };

    switch (category) {
      case 'leadType':
        def.search = `${name} |`; def.wild = 'start';
        break;
      case 'answerStatus':
        def.search = `| ${name} |`; def.wild = 'contains';
        break;
      case 'source':
        def.search = `| ${name}`; def.wild = 'end';
        break;
      case 'siteVisit':
        def.eventType = 'Site Visit Booked';
        break;
      case 'jobWon':
        def.eventType = 'Job Won';
        break;
      case 'quoteSent':
        def.eventType = 'Quote Sent';
        break;
      case 'pipelineValue':
        def.computed = 'pipeline';
        break;
      case 'dealValue':
        def.computed = 'hidden';
        break;
      case 'computed':
        // Resolved after loop
        break;
      default:
        // action, lost, abandoned, dq, dealClosed, etc.
        def.search = `| ${name} |`; def.wild = 'contains';
        break;
    }

    rowMap[name] = row;
    defs.push(def);
    row++;
  }

  // Resolve computed outcomes
  const answeredRow = rowMap['Answered'];
  const didntRow = rowMap["Didn't Answer"];
  for (const def of defs) {
    if (def.category === 'computed' && !def.computed) {
      if (def.name === 'Total Individual Quotes') {
        def.computed = 'totalQuotes';
      } else if (answeredRow && didntRow) {
        // Total Calls / Total Contact Attempts = Answered + Didn't Answer
        def.computed = `=B${answeredRow}+B${didntRow}`;
      }
    }
  }

  return { defs, rowMap };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function numDate(ref) {
  return `VALUE(SUBSTITUTE(${ref},"-",""))`;
}

// ─── Formula Builders ────────────────────────────────────────────────

function buildCriteria(dateType, d1, d2, personCell, isTeam) {
  const td1 = `TEXT(${d1},"yyyy-mm-dd")`;
  const td2 = d2 ? `TEXT(${d2},"yyyy-mm-dd")` : null;

  if (dateType === 'single') {
    const dc = `${AL}!A:A,${td1}`;
    const pc = isTeam ? '' : `,${AL}!B:B,${personCell}`;
    const df = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td1}`;
    const pf = isTeam ? '' : `,${AL}!B:B=${personCell}`;
    return { dateType, dc, pc, df, pf };
  }

  const nd = numDate(`${AL}!A2:A${RN}`);
  const nd1 = numDate(td1);
  const nd2 = numDate(td2);

  const spDate = `(${nd}>=${nd1})*(${nd}<=${nd2})`;
  const spPerson = isTeam ? '' : `*(${AL}!B2:B${RN}=${personCell})`;
  const df = `${nd}>=${nd1},${nd}<=${nd2}`;
  const pf = isTeam ? '' : `,${AL}!B2:B${RN}=${personCell}`;

  return { dateType, spDate, spPerson, df, pf };
}

function col(letter) {
  return `${AL}!${letter}2:${letter}${RN}`;
}

function countFormula(o, cr) {
  if (o.computed && o.computed.startsWith('=')) return o.computed;
  if (o.computed === 'pipeline') return pipelineCountFormula(cr);
  if (o.computed === 'totalQuotes') return totalQuotesCountFormula(cr);
  if (o.computed === 'hidden') return '';

  if (cr.dateType === 'range') {
    if (o.eventType) {
      return `=SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="${o.eventType}"))`;
    }
    return `=SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="EOD Update")*(ISNUMBER(SEARCH("${o.search}",${col('E')}))))`;
  }

  if (o.eventType) {
    return `=COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"${o.eventType}")`;
  }
  const wc = o.wild === 'start' ? `${o.search}*` :
             o.wild === 'contains' ? `*${o.search}*` :
             `*${o.search}`;
  return `=COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"EOD Update",${AL}!E:E,"${wc}")`;
}

function namesFormula(o, cr) {
  if (o.computed) return '';

  if (cr.dateType === 'range') {
    if (o.eventType) {
      return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${col('C')},${cr.df}${cr.pf},${col('D')}="${o.eventType}")),"")`;
    }
    return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${col('C')},${cr.df}${cr.pf},${col('D')}="EOD Update",ISNUMBER(SEARCH("${o.search}",${col('E')})))),"")`;
  }

  if (o.eventType) {
    return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${AL}!C:C,${cr.df}${cr.pf},${AL}!D:D="${o.eventType}")),"")`;
  }
  return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${AL}!C:C,${cr.df}${cr.pf},${AL}!D:D="EOD Update",ISNUMBER(SEARCH("${o.search}",${AL}!E:E)))),"")`;
}

function pipelineCountFormula(cr) {
  if (cr.dateType === 'range') {
    const fc = `${cr.df}${cr.pf},${col('D')}="Quote Sent"`;
    return `=IFERROR(SUM(MAP(FILTER(${col('G')},${fc}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
  }
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Quote Sent"`;
  return `=IFERROR(SUM(MAP(FILTER(${AL}!G:G,${fc}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
}

function totalQuotesCountFormula(cr) {
  if (cr.dateType === 'range') {
    const fc = `${cr.df}${cr.pf},${col('D')}="Quote Sent"`;
    return `=IFERROR(LET(vals,FILTER(${col('G')},${fc}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
  }
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Quote Sent"`;
  return `=IFERROR(LET(vals,FILTER(${AL}!G:G,${fc}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
}

// ─── Formatted Line Builders ─────────────────────────────────────────

function eodFormattedLine(o) {
  const r = o.row;
  switch (o.eodF) {
    case 1: return '';
    case 2: return `=IF(B${r}>0,A${r}&" - "&B${r},"")`;
    case 3: return `=IF(B${r}>0,A${r}&": "&B${r},"")`;
    case 4: return `=IF(B${r}>0,"- "&A${r}&" - "&B${r}&" - "&C${r},"")`;
    case 5: return `=IF(B${r}>0,A${r}&": "&B${r},"")`;
    default: return ''; // special types (6-10) handled in blocks
  }
}

function eowFormattedLine(o, rowMap) {
  const r = o.row;
  switch (o.eowF) {
    case 1: return '';
    case 2: return `=IF(B${r}>0,A${r}&" - "&B${r},"")`;
    case 3: return `=IF(B${r}>0,CHAR(8226)&" "&A${r}&": "&B${r},"")`;
    case 5: return `=IF(B${r}>0,A${r}&": "&B${r},"")`;
    case 11: return `=IF(B${r}>0,CHAR(8226)&" "&A${r}&": "&B${r},"")`;
    case 12: {
      const totalRow = rowMap['Total Calls'] || rowMap['Total Contact Attempts'];
      const answeredRow = rowMap['Answered'];
      if (!totalRow || !answeredRow) return '';
      return `=IF(B${totalRow}>0,CHAR(8226)&" "&A${totalRow}&": "&B${totalRow}&" ("&ROUND(B${answeredRow}/B${totalRow}*100)&"% Answered)","")`;
    }
    default: return '';
  }
}

// ─── Block Formula Builders ──────────────────────────────────────────

function simpleBlock(displayName, cellRefs) {
  const safe = displayName.replace(/"/g, '""');
  return `=LET(lines,TEXTJOIN(CHAR(10),TRUE,${cellRefs}),IF(LEN(lines)>0,"${safe}"&CHAR(10)&lines,""))`;
}

// --- Special EOD blocks (single date, full column refs) ---

function quotesBlock(cr, rowMap) {
  const pvRow = rowMap['Pipeline Value'];
  const tiqRow = rowMap['Total Individual Quotes'];
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Quote Sent"`;
  return `=IFERROR(LET(numQ,COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"Quote Sent"),IF(numQ=0,"","💰 Quotes Sent"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${AL}!C:C,${fc}),FILTER(${AL}!G:G,${fc}),LAMBDA(nm,v,LET(t,SUBSTITUTE(SUBSTITUTE(""&v,"$",""),",",""),parts,SPLIT(t,"|"),nums,ARRAYFORMULA(VALUE(TRIM(parts))),cnt,COUNTA(parts),"- "&nm&" - "&cnt&" - ("&TEXTJOIN(", ",TRUE,ARRAYFORMULA("$"&TEXT(nums,"#,##0")))&")"))))&CHAR(10)&"Pipeline Value (Sum of Averages): $"&TEXT(B${pvRow},"#,##0")&CHAR(10)&"Total Individual Quotes: "&B${tiqRow})),"")`;
}

function siteVisitsBlock(cr) {
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Site Visit Booked"`;
  return `=IFERROR(LET(numSV,COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"Site Visit Booked"),IF(numSV=0,"","🏠 Site Visits"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${AL}!C:C,${fc}),FILTER(${AL}!H:H,${fc}),FILTER(${AL}!J:J,${fc}),LAMBDA(nm,addr,appt,"- "&nm&" - "&IF(""&addr="","TBC",""&addr)&" - "&IF(""&appt="","TBC",TEXT(appt,"ddd dd mmm h:mmam/pm"))))))),"")`;
}

function jobsBlock(cr) {
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Job Won"`;
  return `=IFERROR(LET(numJ,COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"Job Won"),IF(numJ=0,"","✅ Job's Confirmed"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${AL}!C:C,${fc}),FILTER(${AL}!H:H,${fc}),FILTER(${AL}!G:G,${fc}),FILTER(${AL}!F:F,${fc}),LAMBDA(nm,addr,val,src,"- "&nm&" - "&IF(""&addr="","N/A",""&addr)&" - $"&TEXT(VALUE(SUBSTITUTE(SUBSTITUTE(""&val,"$",""),",","")),"#,##0")&" - "&IF(""&src="","N/A",""&src))))&CHAR(10)&"Total Revenue Generated: $"&TEXT(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${AL}!G:G,${fc}),"$",""),",","")))),"#,##0"))),"")`;
}

// --- Notes block (EOD 4 - Custom Outcome) ---

function notesBlock(cr) {
  // Extract rows where outcome has a non-empty 4th pipe segment (notes)
  // Outcome format: "LeadType | Answered | Outcome | Notes | Source"
  const fc = `${cr.df}${cr.pf},${AL}!D:D="EOD Update"`;
  return `=IFERROR(LET(outcomes,FILTER(${AL}!E:E,${fc}),names,FILTER(${AL}!C:C,${fc}),notes,ARRAYFORMULA(TRIM(IFERROR(INDEX(SPLIT(outcomes," | "),0,4),""))),hasNote,ARRAYFORMULA(LEN(notes)>0),IF(OR(hasNote),"📝 Notes"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,IF(hasNote,"- "&names&": "&notes,"")),"")),"")`;
}

function eowNotesBlock(cr) {
  const fc = `${cr.df}${cr.pf},${col('D')}="EOD Update"`;
  return `=IFERROR(LET(outcomes,FILTER(${col('E')},${fc}),names,FILTER(${col('C')},${fc}),notes,ARRAYFORMULA(TRIM(IFERROR(INDEX(SPLIT(outcomes," | "),0,4),""))),hasNote,ARRAYFORMULA(LEN(notes)>0),IF(OR(hasNote),CHAR(10)&"📝 Notes"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,IF(hasNote,CHAR(8226)&" "&names&": "&notes,"")),"")),"")`;
}

// --- Special EOW blocks (range dates, bounded refs) ---

function eowQuotesBlock(cr, rowMap) {
  const pvRow = rowMap['Pipeline Value'];
  const tiqRow = rowMap['Total Individual Quotes'];
  const fc = `${cr.df}${cr.pf},${col('D')}="Quote Sent"`;
  const countExpr = `SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="Quote Sent"))`;
  return `=IFERROR(LET(numQ,${countExpr},IF(numQ=0,"","📄 Quotes Sent"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${col('C')},${fc}),FILTER(${col('G')},${fc}),LAMBDA(nm,v,LET(t,SUBSTITUTE(SUBSTITUTE(""&v,"$",""),",",""),parts,SPLIT(t,"|"),nums,ARRAYFORMULA(VALUE(TRIM(parts))),cnt,COUNTA(parts),CHAR(8226)&" "&nm&" - "&cnt&" - ("&TEXTJOIN(", ",TRUE,ARRAYFORMULA("$"&TEXT(nums,"#,##0")))&")"))))&CHAR(10)&"Pipeline Value (Sum of Averages): $"&TEXT(B${pvRow},"#,##0")&CHAR(10)&"Total Individual Quotes: "&B${tiqRow})),"")`;
}

function eowSiteVisitsBlock(cr) {
  const fc = `${cr.df}${cr.pf},${col('D')}="Site Visit Booked"`;
  const countExpr = `SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="Site Visit Booked"))`;
  return `=IFERROR(LET(numSV,${countExpr},IF(numSV=0,"","🏠 Site Visits"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${col('C')},${fc}),FILTER(${col('H')},${fc}),FILTER(${col('J')},${fc}),LAMBDA(nm,addr,appt,CHAR(8226)&" "&nm&" - "&IF(""&addr="","TBC",""&addr)&" - "&IF(""&appt="","TBC",TEXT(appt,"ddd dd mmm h:mmam/pm"))))))),"")`;
}

function eowJobsBlock(cr) {
  const fc = `${cr.df}${cr.pf},${col('D')}="Job Won"`;
  const countExpr = `SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="Job Won"))`;
  return `=IFERROR(LET(numJ,${countExpr},IF(numJ=0,"","🏆 Wins"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${col('C')},${fc}),FILTER(${col('H')},${fc}),FILTER(${col('G')},${fc}),FILTER(${col('F')},${fc}),LAMBDA(nm,addr,val,src,CHAR(8226)&" "&nm&" - "&IF(""&addr="","N/A",""&addr)&" - $"&TEXT(VALUE(SUBSTITUTE(SUBSTITUTE(""&val,"$",""),",","")),"#,##0")&" - "&IF(""&src="","N/A",""&src))))&CHAR(10)&"Total Revenue Generated: $"&TEXT(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${col('G')},${fc}),"$",""),",","")))),"#,##0"))),"")`;
}

// --- Dynamic efficiency block from config ---

function buildEfficiencyBlock(computedEntries, rowMap) {
  if (!computedEntries || computedEntries.length === 0) return '';

  const totalRow = rowMap['Total Calls'] || rowMap['Total Contact Attempts'];
  if (!totalRow) return '';

  const parts = computedEntries.map(comp => {
    const match = comp.formula.match(/^\(?(.*?)\)?\s*\/\s*(.*?)\s*\*\s*100$/);
    if (!match) return null;

    const numExpr = match[1].trim();
    const denomName = match[2].trim();
    const denomRow = rowMap[denomName];
    if (!denomRow) return null;

    const numParts = numExpr.split('+').map(s => s.trim());
    const numCells = numParts.map(p => rowMap[p] ? `B${rowMap[p]}` : null).filter(Boolean);
    if (numCells.length === 0) return null;

    const numExprSheets = numCells.length === 1 ? numCells[0] : numCells.join('+');
    return `CHAR(8226)&" ${comp.name}: "&ROUND(${numExprSheets}/B${denomRow}*100)&"%"`;
  }).filter(Boolean);

  if (parts.length === 0) return '';
  return `=IF(B${totalRow}=0,"","⚡ Efficiency Rates"&CHAR(10)&${parts.join('&CHAR(10)&')})`;
}

// ─── Block Builder ──────────────────────────────────────────────────

/**
 * Build block formula for an EOD block.
 */
function buildEODBlockFormula(block, outcomeConfigs, ownerName, rowMap, cr) {
  if (!block.outcomes) return '';

  // Check if block contains special event type categories
  const categories = block.outcomes.map(tpl => {
    const cfg = outcomeConfigs.find(o => o.name === tpl);
    return cfg ? cfg.category : null;
  });

  if (categories.includes('quoteSent')) return quotesBlock(cr, rowMap);
  if (categories.includes('siteVisit')) return siteVisitsBlock(cr);
  if (categories.includes('jobWon')) return jobsBlock(cr);

  // Simple block — TEXTJOIN of formatted cells
  const cellRefs = block.outcomes.map(tpl => {
    const name = tpl.replace('{owner}', ownerName);
    return rowMap[name] ? `D${rowMap[name]}` : null;
  }).filter(Boolean);

  if (cellRefs.length === 0) return '';

  const displayName = block.name.replace('{owner}', ownerName);
  return simpleBlock(displayName, cellRefs.join(','));
}

/**
 * Build block formula for an EOW block.
 */
function buildEOWBlockFormula(block, outcomeConfigs, ownerName, rowMap, cr) {
  // Computed efficiency block
  if (block.computed) {
    return buildEfficiencyBlock(block.computed, rowMap);
  }

  if (!block.outcomes) return '';

  const categories = block.outcomes.map(tpl => {
    const cfg = outcomeConfigs.find(o => o.name === tpl);
    return cfg ? cfg.category : null;
  });

  if (categories.includes('quoteSent')) return eowQuotesBlock(cr, rowMap);
  if (categories.includes('siteVisit')) return eowSiteVisitsBlock(cr);
  if (categories.includes('jobWon')) return eowJobsBlock(cr);

  // Simple block
  const cellRefs = block.outcomes.map(tpl => {
    const name = tpl.replace('{owner}', ownerName);
    return rowMap[name] ? `D${rowMap[name]}` : null;
  }).filter(Boolean);

  if (cellRefs.length === 0) return '';

  const displayName = block.name.replace('{owner}', ownerName);
  return simpleBlock(displayName, cellRefs.join(','));
}

// ─── EOD Tab Builder ─────────────────────────────────────────────────

async function populateEODTab(spreadsheetId, tabName, personName, companyName, ownerName, isTeam) {
  const { outcomes, blocks } = loadConfig(companyName);
  const dateCell = '$B$5';
  const personCell = '$B$1';
  const cr = buildCriteria('single', dateCell, null, personCell, isTeam);
  const { defs, rowMap } = getOutcomeDefs(ownerName, companyName);

  // Build block formulas
  const eodBlocks = blocks.eodBlocks || [];
  const blockFormulasArr = eodBlocks.map(block =>
    buildEODBlockFormula(block, outcomes.outcomes, ownerName, rowMap, cr)
  ).filter(Boolean);

  // Add notes block at the end
  blockFormulasArr.push(notesBlock(cr));

  // Map block formulas to outcome rows (sparse — placed at rows 8, 9, 10, ...)
  const blockFormulaMap = {};
  for (let i = 0; i < blockFormulasArr.length; i++) {
    blockFormulaMap[8 + i] = blockFormulasArr[i];
  }

  // Message formula — TEXTJOIN the block cells
  const lastBlockRow = 8 + Math.max(blockFormulasArr.length - 1, 0);
  const msgFormula = `="EOD Report - "&TEXT($B$5,"dddd dd mmm")&" - "&$B$2&CHAR(10)&"${SEP}"&CHAR(10)&TEXTJOIN(CHAR(10)&"${SEP}"&CHAR(10),TRUE,G8:G${lastBlockRow})`;

  // Build grid
  const grid = [];
  grid.push(['Sales Person', personName, '', '', '', '', msgFormula]);
  grid.push(['Company', companyName, '', '', '', '', '']);
  grid.push(['Date Mode', 'today', '', '', '', '', '']);
  grid.push(['Manual Date', '', '', '', '', '', '']);
  grid.push(['Target Date', '=IF(B3="today",TODAY(),B4)', '', '', '', '', '']);
  grid.push(['']);
  grid.push(['Outcome', 'Count', 'Names', 'Formatted', '', '', 'Block Messages']);

  for (const o of defs) {
    const row = [
      o.name,
      countFormula(o, cr),
      namesFormula(o, cr),
      eodFormattedLine(o),
      '', '',
      blockFormulaMap[o.row] || '',
    ];
    grid.push(row);
  }

  const lastRow = 8 + defs.length;
  await clearRange(spreadsheetId, `'${tabName}'!A1:H${lastRow}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with live formulas`);
}

// ─── EOW Tab Builder ─────────────────────────────────────────────────

async function populateEOWTab(spreadsheetId, tabName, personName, companyName, ownerName, isTeam) {
  const { outcomes, blocks } = loadConfig(companyName);
  const startCell = '$B$3';
  const endCell = '$B$4';
  const personCell = '$B$1';
  const cr = buildCriteria('range', startCell, endCell, personCell, isTeam);
  const { defs, rowMap } = getOutcomeDefs(ownerName, companyName);

  // Build block formulas
  const eowBlocks = blocks.eowBlocks || [];
  const blockFormulasArr = eowBlocks.map(block =>
    buildEOWBlockFormula(block, outcomes.outcomes, ownerName, rowMap, cr)
  ).filter(Boolean);

  // Add notes block at the end
  blockFormulasArr.push(eowNotesBlock(cr));

  const blockFormulaMap = {};
  for (let i = 0; i < blockFormulasArr.length; i++) {
    blockFormulaMap[8 + i] = blockFormulasArr[i];
  }

  const lastBlockRow = 8 + Math.max(blockFormulasArr.length - 1, 0);
  const msgFormula = `="SALES EXECUTIVE PERFORMANCE REPORT - "&$B$2&CHAR(10)&"Dates: "&TEXT($B$3,"dddd d mmmm yyyy")&" - "&TEXT($B$4,"dddd d mmmm yyyy")&CHAR(10)&"${WSEP}"&CHAR(10)&TEXTJOIN(CHAR(10)&"${WSEP}"&CHAR(10),TRUE,G8:G${lastBlockRow})`;

  // Build grid
  const grid = [];
  grid.push(['Sales Person', personName, '', '', '', '', msgFormula]);
  grid.push(['Company', companyName, '', '', '', '', '']);
  grid.push(['Week Start', '=TODAY()-WEEKDAY(TODAY(),2)+1', '', '', '', '', '']);
  grid.push(['Week End', '=B3+4', '', '', '', '', '']);
  grid.push(['']);
  grid.push(['']);
  grid.push(['Outcome', 'Count', 'Names', 'Formatted', '', '', 'Block Messages']);

  for (const o of defs) {
    const row = [
      o.name,
      countFormula(o, cr),
      namesFormula(o, cr),
      eowFormattedLine(o, rowMap),
      '', '',
      blockFormulaMap[o.row] || '',
    ];
    grid.push(row);
  }

  const lastRow = 8 + defs.length;
  await clearRange(spreadsheetId, `'${tabName}'!A1:H${lastRow}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with live formulas`);
}

// ─── Main Entry Point ────────────────────────────────────────────────

async function populateAllFormulas(spreadsheetId, companyName, ownerName, salesPeople) {
  console.log(`Populating live formulas for ${companyName}...`);

  for (const person of salesPeople) {
    if (!person.active) continue;
    await populateEODTab(spreadsheetId, `${person.name} EOD`, person.name, companyName, ownerName, false);
    await populateEOWTab(spreadsheetId, `${person.name} EOW`, person.name, companyName, ownerName, false);
  }

  await populateEODTab(spreadsheetId, 'Team EOD', 'Team', companyName, ownerName, true);
  await populateEOWTab(spreadsheetId, 'Team EOW', 'Team', companyName, ownerName, true);

  console.log('All formula tabs populated.');
}

module.exports = { populateAllFormulas, populateEODTab, populateEOWTab };
