const { writeSheet, clearRange } = require('./writeSheet');
const { readTab } = require('./readSheet');
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
      case 'emailSent':
        def.eventType = 'Email Sent';
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
    const pc = isTeam ? '' : `,${AL}!B:B,${personCell}&"*"`;
    const df = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td1}`;
    const pf = isTeam ? '' : `,LEFT(${AL}!B:B,LEN(${personCell}))=${personCell}`;
    return { dateType, dc, pc, df, pf };
  }

  const nd = numDate(`${AL}!A2:A${RN}`);
  const nd1 = numDate(td1);
  const nd2 = numDate(td2);

  const spDate = `(${nd}>=${nd1})*(${nd}<=${nd2})`;
  const spPerson = isTeam ? '' : `*(LEFT(${AL}!B2:B${RN},LEN(${personCell}))=${personCell})`;
  const df = `${nd}>=${nd1},${nd}<=${nd2}`;
  const pf = isTeam ? '' : `,LEFT(${AL}!B2:B${RN},LEN(${personCell}))=${personCell}`;

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
    return `=IFERROR(SUM(MAP(FILTER(${col('G')},${fc}),LAMBDA(v,IF(""&v="",0,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",","")))))))),0)`;
  }
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Quote Sent"`;
  return `=IFERROR(SUM(MAP(FILTER(${AL}!G:G,${fc}),LAMBDA(v,IF(""&v="",0,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",","")))))))),0)`;
}

function totalQuotesCountFormula(cr) {
  if (cr.dateType === 'range') {
    const fc = `${cr.df}${cr.pf},${col('D')}="Quote Sent"`;
    return `=IFERROR(LET(vals,FILTER(${col('G')},${fc}),SUM(ARRAYFORMULA(IF(LEN(""&vals)=0,0,LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1)))),0)`;
  }
  const fc = `${cr.df}${cr.pf},${AL}!D:D="Quote Sent"`;
  return `=IFERROR(LET(vals,FILTER(${AL}!G:G,${fc}),SUM(ARRAYFORMULA(IF(LEN(""&vals)=0,0,LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1)))),0)`;
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
  return `=IFERROR(LET(numQ,COUNTIFS(${cr.dc}${cr.pc},${AL}!D:D,"Quote Sent"),IF(numQ=0,"","💰 Quotes Sent"&CHAR(10)&"Total Contacts Quoted: "&IFERROR(COUNTA(UNIQUE(FILTER(${AL}!C:C,${fc}))),numQ)&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,MAP(FILTER(${AL}!C:C,${fc}),FILTER(${AL}!G:G,${fc}),LAMBDA(nm,v,IF(""&v="","- "&nm&" - 0 - ()",LET(t,SUBSTITUTE(SUBSTITUTE(""&v,"$",""),",",""),parts,SPLIT(t,"|"),nums,ARRAYFORMULA(VALUE(TRIM(parts))),cnt,COUNTA(parts),"- "&nm&" - "&cnt&" - ("&TEXTJOIN(", ",TRUE,ARRAYFORMULA("$"&TEXT(nums,"#,##0")))&")")))))&CHAR(10)&"Pipeline Value (Sum of Averages): $"&TEXT(B${pvRow},"#,##0")&CHAR(10)&"Total Individual Quotes: "&B${tiqRow})),"")`;
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
  return `=IFERROR(LET(outcomes,FILTER(${AL}!E:E,${fc}),names,FILTER(${AL}!C:C,${fc}),notes,MAP(outcomes,LAMBDA(o,TRIM(IFERROR(INDEX(SPLIT(o," | ",FALSE,FALSE),1,4),"")))),hasNote,ARRAYFORMULA(LEN(notes)>0),IF(OR(hasNote),"📝 Notes"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,ARRAYFORMULA(IF(hasNote,"- "&names&": "&notes,""))),"")),"")`;
}

function eowNotesBlock(cr) {
  const fc = `${cr.df}${cr.pf},${col('D')}="EOD Update"`;
  return `=IFERROR(LET(outcomes,FILTER(${col('E')},${fc}),names,FILTER(${col('C')},${fc}),notes,MAP(outcomes,LAMBDA(o,TRIM(IFERROR(INDEX(SPLIT(o," | ",FALSE,FALSE),1,4),"")))),hasNote,ARRAYFORMULA(LEN(notes)>0),IF(OR(hasNote),CHAR(10)&"📝 Notes"&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,ARRAYFORMULA(IF(hasNote,CHAR(8226)&" "&names&": "&notes,""))),"")),"")`;
}

// --- Special EOW blocks (range dates, bounded refs) ---

function eowQuotesBlock(cr, rowMap) {
  const qsRow = rowMap['Quote Sent'];
  const pvRow = rowMap['Pipeline Value'];
  const tiqRow = rowMap['Total Individual Quotes'];
  const countExpr = `SUMPRODUCT(${cr.spDate}${cr.spPerson}*(${col('D')}="Quote Sent"))`;
  return `=IFERROR(LET(numQ,${countExpr},IF(numQ=0,"","📄 Quotes Sent"&CHAR(10)&CHAR(8226)&" Quote Sent: "&B${qsRow}&CHAR(10)&"Pipeline Value (Sum of Averages): $"&TEXT(B${pvRow},"#,##0")&CHAR(10)&"Total Individual Quotes: "&B${tiqRow})),"")`;
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
  grid.push(['Week End', '=B3+6', '', '', '', '', '']);
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

// ─── EOM Display Tab Builder ────────────────────────────────────────

async function populateEOMTab(spreadsheetId, tabName, personName, companyName, ownerName, isTeam) {
  const { outcomes, blocks } = loadConfig(companyName);
  const startCell = '$B$3';
  const endCell = '$B$4';
  const personCell = '$B$1';
  const cr = buildCriteria('range', startCell, endCell, personCell, isTeam);
  const { defs, rowMap } = getOutcomeDefs(ownerName, companyName);

  // Reuse EOW block formulas (same range-based format)
  const eowBlocks = blocks.eowBlocks || [];
  const blockFormulasArr = eowBlocks.map(block =>
    buildEOWBlockFormula(block, outcomes.outcomes, ownerName, rowMap, cr)
  ).filter(Boolean);

  blockFormulasArr.push(eowNotesBlock(cr));

  const blockFormulaMap = {};
  for (let i = 0; i < blockFormulasArr.length; i++) {
    blockFormulaMap[8 + i] = blockFormulasArr[i];
  }

  const lastBlockRow = 8 + Math.max(blockFormulasArr.length - 1, 0);
  const msgFormula = `="MONTHLY PERFORMANCE REPORT - "&$B$2&CHAR(10)&TEXT($B$3,"mmmm yyyy")&CHAR(10)&"${WSEP}"&CHAR(10)&TEXTJOIN(CHAR(10)&"${WSEP}"&CHAR(10),TRUE,G8:G${lastBlockRow})`;

  const grid = [];
  grid.push(['Sales Person', personName, '', '', '', '', msgFormula]);
  grid.push(['Company', companyName, '', '', '', '', '']);
  grid.push(['Month Start', '=DATE(YEAR(TODAY()),MONTH(TODAY()),1)', '', '', '', '', '']);
  grid.push(['Month End', '=EOMONTH(B3,0)', '', '', '', '', '']);
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

// ─── Storage Tab Helpers ─────────────────────────────────────────────

function getColLetter(idx) {
  let n = idx;
  let letter = '';
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function parseSerialDate(val) {
  if (/^\d{4,5}$/.test(val)) {
    return new Date((parseInt(val) - 25569) * 86400000).toISOString().split('T')[0];
  }
  return val;
}

// ─── Daily Storage Formula Builders ──────────────────────────────────

function dailyStorageCount(o, row, person, isTeam, colMap) {
  if (o.computed) {
    if (o.computed.startsWith('=')) {
      const ac = colMap['Answered'], dc = colMap["Didn't Answer"];
      return (ac && dc) ? `=${ac}${row}+${dc}${row}` : '';
    }
    if (o.computed === 'hidden') return '';
    if (o.computed === 'pipeline') {
      const td = `TEXT(A${row},"yyyy-mm-dd")`;
      const f = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td}${isTeam ? '' : `,LEFT(${AL}!B:B,LEN("${person}"))="${person}"`},${AL}!D:D="Quote Sent"`;
      return `=IFERROR(SUM(MAP(FILTER(${AL}!G:G,${f}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
    }
    if (o.computed === 'totalQuotes') {
      const td = `TEXT(A${row},"yyyy-mm-dd")`;
      const f = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td}${isTeam ? '' : `,LEFT(${AL}!B:B,LEN("${person}"))="${person}"`},${AL}!D:D="Quote Sent"`;
      return `=IFERROR(LET(vals,FILTER(${AL}!G:G,${f}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
    }
    return '';
  }

  const td = `TEXT(A${row},"yyyy-mm-dd")`;
  const dc = `${AL}!A:A,${td}`;
  const pc = isTeam ? '' : `,${AL}!B:B,"${person}*"`;

  if (o.eventType) {
    return `=COUNTIFS(${dc}${pc},${AL}!D:D,"${o.eventType}")`;
  }

  const wc = o.wild === 'start' ? `${o.search}*` :
             o.wild === 'contains' ? `*${o.search}*` : `*${o.search}`;
  return `=COUNTIFS(${dc}${pc},${AL}!D:D,"EOD Update",${AL}!E:E,"${wc}")`;
}

function dailyStorageNames(o, row, person, isTeam) {
  if (o.computed) return '';

  const td = `TEXT(A${row},"yyyy-mm-dd")`;
  const df = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td}`;
  const pf = isTeam ? '' : `,LEFT(${AL}!B:B,LEN("${person}"))="${person}"`;

  if (o.eventType) {
    return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${AL}!C:C,${df}${pf},${AL}!D:D="${o.eventType}")),"")`;
  }

  return `=IFERROR(TEXTJOIN(", ",TRUE,FILTER(${AL}!C:C,${df}${pf},${AL}!D:D="EOD Update",ISNUMBER(SEARCH("${o.search}",${AL}!E:E)))),"")`;
}

// ─── Weekly Storage Formula Builders ─────────────────────────────────

function weeklyStorageCount(o, row, person, isTeam, colMap) {
  if (o.computed) {
    if (o.computed.startsWith('=')) {
      const ac = colMap['Answered'], dc = colMap["Didn't Answer"];
      return (ac && dc) ? `=${ac}${row}+${dc}${row}` : '';
    }
    if (o.computed === 'hidden') return '';
    if (o.computed === 'pipeline') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(A${row},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(B${row},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(SUM(MAP(FILTER(${col('G')},${f}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
    }
    if (o.computed === 'totalQuotes') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(A${row},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(B${row},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(LET(vals,FILTER(${col('G')},${f}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
    }
    return '';
  }

  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(A${row},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(B${row},"yyyy-mm-dd")`);
  const sp = `(${nd}>=${n1})*(${nd}<=${n2})`;
  const pp = isTeam ? '' : `*(LEFT(${col('B')},LEN("${person}"))="${person}")`;

  if (o.eventType) {
    return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="${o.eventType}"))`;
  }

  return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="EOD Update")*(ISNUMBER(SEARCH("${o.search}",${col('E')}))))`;
}

// ─── Monthly Storage Formula Builders ────────────────────────────────

function monthlyStorageCount(o, row, person, isTeam, colMap) {
  const mStart = `DATE(LEFT(A${row},4),MID(A${row},6,2),1)`;
  const mEnd = `EOMONTH(${mStart},0)`;

  if (o.computed) {
    if (o.computed.startsWith('=')) {
      const ac = colMap['Answered'], dc = colMap["Didn't Answer"];
      return (ac && dc) ? `=${ac}${row}+${dc}${row}` : '';
    }
    if (o.computed === 'hidden') return '';
    if (o.computed === 'pipeline') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(${mStart},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(${mEnd},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(SUM(MAP(FILTER(${col('G')},${f}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
    }
    if (o.computed === 'totalQuotes') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(${mStart},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(${mEnd},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(LET(vals,FILTER(${col('G')},${f}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
    }
    return '';
  }

  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(${mStart},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(${mEnd},"yyyy-mm-dd")`);
  const sp = `(${nd}>=${n1})*(${nd}<=${n2})`;
  const pp = isTeam ? '' : `*(LEFT(${col('B')},LEN("${person}"))="${person}")`;

  if (o.eventType) {
    return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="${o.eventType}"))`;
  }

  return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="EOD Update")*(ISNUMBER(SEARCH("${o.search}",${col('E')}))))`;
}

// ─── Storage Revenue Formula ─────────────────────────────────────────

function dailyRevenueFormula(row, person, isTeam) {
  const td = `TEXT(A${row},"yyyy-mm-dd")`;
  const df = `TEXT(${AL}!A:A,"yyyy-mm-dd")=${td}`;
  const pf = isTeam ? '' : `,LEFT(${AL}!B:B,LEN("${person}"))="${person}"`;
  return `=IFERROR(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${AL}!G:G,${df}${pf},${AL}!D:D="Job Won"),"$",""),",","")))),"")`;
}

function weeklyRevenueFormula(row, person, isTeam) {
  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(A${row},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(B${row},"yyyy-mm-dd")`);
  const df = `${nd}>=${n1},${nd}<=${n2}`;
  const pf = isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`;
  return `=IFERROR(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${col('G')},${df}${pf},${col('D')}="Job Won"),"$",""),",","")))),"")`;
}

function monthlyRevenueFormula(row, person, isTeam) {
  const mStart = `DATE(LEFT(A${row},4),MID(A${row},6,2),1)`;
  const mEnd = `EOMONTH(${mStart},0)`;
  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(${mStart},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(${mEnd},"yyyy-mm-dd")`);
  const df = `${nd}>=${n1},${nd}<=${n2}`;
  const pf = isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`;
  return `=IFERROR(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${col('G')},${df}${pf},${col('D')}="Job Won"),"$",""),",","")))),"")`;
}

// ─── Storage Efficiency Rate Formula ─────────────────────────────────

function storageEfficiencyFormula(comp, colMap, row) {
  const match = comp.formula.match(/^\(?(.*?)\)?\s*\/\s*(.*?)\s*\*\s*100$/);
  if (!match) return '0';

  const numExpr = match[1].trim();
  const denomName = match[2].trim();
  const denomCol = colMap[denomName];
  if (!denomCol) return '0';

  const numParts = numExpr.split('+').map(s => s.trim());
  const numCells = numParts.map(p => colMap[p] ? `${colMap[p]}${row}` : null).filter(Boolean);
  if (numCells.length === 0) return '0';

  const numSum = numCells.length === 1 ? numCells[0] : numCells.join('+');
  return `=IFERROR(ROUND((${numSum})/${denomCol}${row}*100),0)`;
}

// ─── Storage Row Builders (for archive functions) ────────────────────

function buildDailyStorageRow(date, rowNum, personName, companyName, ownerName, isTeam, message) {
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const colMap = {};
  for (let i = 0; i < defs.length; i++) {
    colMap[defs[i].name] = getColLetter(2 + 2 * i);
  }
  const row = [date, message || ''];
  for (const def of defs) {
    row.push(
      dailyStorageCount(def, rowNum, personName, isTeam, colMap),
      dailyStorageNames(def, rowNum, personName, isTeam)
    );
  }
  row.push(dailyRevenueFormula(rowNum, personName, isTeam));
  return row;
}

function buildWeeklyStorageRow(startDate, endDate, rowNum, personName, companyName, ownerName, isTeam, message) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  const colMap = {};
  for (let i = 0; i < defs.length; i++) {
    colMap[defs[i].name] = getColLetter(3 + i);
  }

  const row = [startDate, endDate, message || ''];
  for (const def of defs) {
    row.push(weeklyStorageCount(def, rowNum, personName, isTeam, colMap));
  }
  for (const comp of computedEntries) {
    row.push(storageEfficiencyFormula(comp, colMap, rowNum));
  }
  row.push(weeklyRevenueFormula(rowNum, personName, isTeam));
  return row;
}

function buildMonthlyStorageRow(monthStr, rowNum, personName, companyName, ownerName, isTeam, message) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  const colMap = {};
  for (let i = 0; i < defs.length; i++) {
    colMap[defs[i].name] = getColLetter(2 + i);
  }

  const row = [monthStr, message || ''];
  for (const def of defs) {
    row.push(monthlyStorageCount(def, rowNum, personName, isTeam, colMap));
  }
  for (const comp of computedEntries) {
    row.push(storageEfficiencyFormula(comp, colMap, rowNum));
  }
  row.push(monthlyRevenueFormula(rowNum, personName, isTeam));
  return row;
}

// ─── Storage Tab Populators ──────────────────────────────────────────

async function populateDailyStorage(spreadsheetId, tabName, personName, companyName, ownerName, isTeam, fallbackTabName) {
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const outcomeNames = defs.map(d => d.name);

  // Read existing data (dates + messages) from current storage
  let allRows = await readTab(spreadsheetId, tabName);
  let existingData = allRows.slice(1).filter(r => r[0]).map(r => ({
    date: parseSerialDate(r[0]),
    message: r[1] || '',
  }));

  // For Team tabs, derive dates from individual tab if empty
  if (existingData.length === 0 && fallbackTabName) {
    const fbRows = await readTab(spreadsheetId, fallbackTabName);
    existingData = fbRows.slice(1).filter(r => r[0]).map(r => ({
      date: parseSerialDate(r[0]),
      message: '',
    }));
  }

  // Scan Activity Log for all dates with data for this person
  const actRows = await readTab(spreadsheetId, 'Activity Log');
  const actDates = new Set();
  for (const row of actRows.slice(1)) {
    const d = row[0] || '';
    if (!d) continue;
    if (!isTeam && row[1] !== personName) continue;
    actDates.add(parseSerialDate(d));
  }

  // Merge: add any Activity Log dates not already in existing data
  const existingSet = new Set(existingData.map(d => d.date));
  for (const d of actDates) {
    if (!existingSet.has(d)) {
      existingData.push({ date: d, message: '' });
    }
  }

  // Deduplicate by date (keep first occurrence with message)
  const seenDates = new Set();
  existingData = existingData.filter(d => {
    if (seenDates.has(d.date)) return false;
    seenDates.add(d.date);
    return true;
  });

  // Sort by date
  existingData.sort((a, b) => a.date.localeCompare(b.date));

  if (existingData.length === 0) {
    console.log(`  No dates found in ${tabName}, skipping.`);
    return;
  }

  // Build header
  const header = ['Date', 'Message'];
  for (const name of outcomeNames) {
    header.push(name, `${name} Names`);
  }
  header.push('Total Revenue');

  // Build formula rows, preserving existing messages
  const grid = [header];
  for (let i = 0; i < existingData.length; i++) {
    grid.push(buildDailyStorageRow(existingData[i].date, i + 2, personName, companyName, ownerName, isTeam, existingData[i].message));
  }

  // Clear a wider range than the new schema width to wipe any stale columns
  // from a previous schema (e.g. removed efficiency-rate columns) that would
  // otherwise survive and create duplicate header names.
  const lastCol = getColLetter(2 + defs.length * 2 + 1 + 20);
  await clearRange(spreadsheetId, `'${tabName}'!A1:${lastCol}${Math.max(existingData.length + 10, 500)}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with ${existingData.length} rows of live formulas`);
}

async function populateWeeklyStorage(spreadsheetId, tabName, personName, companyName, ownerName, isTeam, fallbackTabName) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const outcomeNames = defs.map(d => d.name);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  // Read existing data to preserve messages
  let allRows = await readTab(spreadsheetId, tabName);
  const existingMessages = {};
  for (const row of allRows.slice(1)) {
    if (!row[0] || !row[1]) continue;
    const start = parseSerialDate(row[0]);
    // Normalize: find the Monday for this start date
    const sd = new Date(start + 'T12:00:00Z');
    const sDay = sd.getDay();
    const sMon = new Date(sd);
    sMon.setDate(sd.getDate() - ((sDay + 6) % 7));
    const monKey = sMon.toISOString().split('T')[0];
    if (row[2] && !existingMessages[monKey]) existingMessages[monKey] = row[2];
  }

  // Scan Activity Log for all dates with data for this person
  const actRows = await readTab(spreadsheetId, 'Activity Log');
  const actDates = new Set();
  for (const row of actRows.slice(1)) {
    const d = row[0] || '';
    if (!d) continue;
    if (!isTeam && row[1] !== personName) continue;
    actDates.add(parseSerialDate(d));
  }

  // For Team tabs with no Activity Log data, try fallback tab
  if (actDates.size === 0 && fallbackTabName) {
    const fbRows = await readTab(spreadsheetId, fallbackTabName);
    for (const row of fbRows.slice(1)) {
      if (!row[0] || !row[1]) continue;
      actDates.add(parseSerialDate(row[0]));
    }
  }

  // Generate Monday-Sunday week ranges from all Activity Log dates
  let weeks = [];
  const seenWeeks = new Set();
  for (const dateStr of actDates) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getDay(); // 0=Sun, 1=Mon
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((day + 6) % 7)); // back to Monday
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const start = mon.toISOString().split('T')[0];
    const end = sun.toISOString().split('T')[0];
    if (!seenWeeks.has(start)) {
      seenWeeks.add(start);
      weeks.push({ start, end, message: existingMessages[start] || '' });
    }
  }

  // Sort by start date
  weeks.sort((a, b) => a.start.localeCompare(b.start));

  if (weeks.length === 0) {
    console.log(`  No weeks found in ${tabName}, skipping.`);
    return;
  }

  // Build header
  const header = ['Week Start', 'Week End', 'Message'];
  for (const name of outcomeNames) header.push(name);
  for (const comp of computedEntries) header.push(comp.name);
  header.push('Total Revenue');

  // Build formula rows, preserving existing messages
  const grid = [header];
  for (let i = 0; i < weeks.length; i++) {
    grid.push(buildWeeklyStorageRow(weeks[i].start, weeks[i].end, i + 2, personName, companyName, ownerName, isTeam, weeks[i].message));
  }

  // Clear a wider range than the new schema width to wipe any stale columns
  // from a previous schema (e.g. removed efficiency-rate columns) that would
  // otherwise survive and create duplicate header names.
  const lastCol = getColLetter(3 + defs.length + computedEntries.length + 1 + 20);
  await clearRange(spreadsheetId, `'${tabName}'!A1:${lastCol}${Math.max(weeks.length + 10, 500)}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with ${weeks.length} rows of live formulas`);
}

async function populateMonthlyStorage(spreadsheetId, tabName, personName, companyName, ownerName, isTeam, fallbackTabName) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const outcomeNames = defs.map(d => d.name);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  // Read existing data (months + messages) from current storage
  let allRows = await readTab(spreadsheetId, tabName);
  let monthData = allRows.slice(1).filter(r => r[0]).map(r => ({
    month: r[0],
    message: r[1] || '',
  }));

  // For Team tabs, derive months from individual tab if empty
  if (monthData.length === 0 && fallbackTabName) {
    const fbRows = await readTab(spreadsheetId, fallbackTabName);
    monthData = fbRows.slice(1).filter(r => r[0]).map(r => ({
      month: r[0],
      message: '',
    }));
  }

  // Scan Activity Log for all months with data for this person
  const actRows = await readTab(spreadsheetId, 'Activity Log');
  const actMonths = new Set();
  for (const row of actRows.slice(1)) {
    const d = row[0] || '';
    if (!d) continue;
    if (!isTeam && row[1] !== personName) continue;
    const dateStr = parseSerialDate(d);
    actMonths.add(dateStr.substring(0, 7)); // "YYYY-MM"
  }

  // Merge: add any Activity Log months not already in existing data
  const existingMonthSet = new Set(monthData.map(m => {
    const parts = m.month.split('-');
    return parts.length === 2 ? `${parts[0]}-${parts[1].padStart(2, '0')}` : m.month;
  }));
  for (const m of actMonths) {
    if (!existingMonthSet.has(m)) {
      monthData.push({ month: m, message: '' });
    }
  }

  // Normalize and deduplicate by month
  for (const m of monthData) {
    const parts = m.month.split('-');
    if (parts.length === 2) {
      m.month = `${parts[0]}-${parts[1].padStart(2, '0')}`;
    }
  }
  const seenMonths = new Set();
  monthData = monthData.filter(m => {
    if (seenMonths.has(m.month)) return false;
    seenMonths.add(m.month);
    return true;
  });

  // Sort by month
  monthData.sort((a, b) => a.month.localeCompare(b.month));

  if (monthData.length === 0) {
    console.log(`  No months found in ${tabName}, skipping.`);
    return;
  }

  // Build header
  const header = ['Month', 'Message'];
  for (const name of outcomeNames) header.push(name);
  for (const comp of computedEntries) header.push(comp.name);
  header.push('Total Revenue');

  // Build formula rows, preserving existing messages
  const grid = [header];
  for (let i = 0; i < monthData.length; i++) {
    grid.push(buildMonthlyStorageRow(monthData[i].month, i + 2, personName, companyName, ownerName, isTeam, monthData[i].message));
  }

  // Clear a wider range than the new schema width to wipe any stale columns
  // from a previous schema (e.g. removed efficiency-rate columns) that would
  // otherwise survive and create duplicate header names.
  const lastCol = getColLetter(2 + defs.length + computedEntries.length + 1 + 20);
  await clearRange(spreadsheetId, `'${tabName}'!A1:${lastCol}${Math.max(monthData.length + 10, 500)}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with ${monthData.length} rows of live formulas`);
}

// ─── Quarterly Storage Formula Builders ──────────────────────────────

function quarterlyStorageCount(o, row, person, isTeam, colMap) {
  // Quarter string in A column: "2026-Q1"
  // Parse to get start/end dates: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
  const qStart = `DATE(LEFT(A${row},4),(MATCH(RIGHT(A${row},1),{"1","2","3","4"},0)-1)*3+1,1)`;
  const qEnd = `EOMONTH(${qStart},2)`;

  if (o.computed) {
    if (o.computed.startsWith('=')) {
      const ac = colMap['Answered'], dc = colMap["Didn't Answer"];
      return (ac && dc) ? `=${ac}${row}+${dc}${row}` : '';
    }
    if (o.computed === 'hidden') return '';
    if (o.computed === 'pipeline') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(${qStart},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(${qEnd},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(SUM(MAP(FILTER(${col('G')},${f}),LAMBDA(v,AVERAGE(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(TRIM(SPLIT(""&v,"|")),"$",""),",",""))))))),0)`;
    }
    if (o.computed === 'totalQuotes') {
      const nd = numDate(`${AL}!A2:A${RN}`);
      const n1 = numDate(`TEXT(${qStart},"yyyy-mm-dd")`);
      const n2 = numDate(`TEXT(${qEnd},"yyyy-mm-dd")`);
      const f = `${nd}>=${n1},${nd}<=${n2}${isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`},${col('D')}="Quote Sent"`;
      return `=IFERROR(LET(vals,FILTER(${col('G')},${f}),SUM(ARRAYFORMULA(LEN(""&vals)-LEN(SUBSTITUTE(""&vals,"|",""))+1))),0)`;
    }
    return '';
  }

  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(${qStart},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(${qEnd},"yyyy-mm-dd")`);
  const sp = `(${nd}>=${n1})*(${nd}<=${n2})`;
  const pp = isTeam ? '' : `*(LEFT(${col('B')},LEN("${person}"))="${person}")`;

  if (o.eventType) {
    return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="${o.eventType}"))`;
  }

  return `=SUMPRODUCT(${sp}${pp}*(${col('D')}="EOD Update")*(ISNUMBER(SEARCH("${o.search}",${col('E')}))))`;
}

function quarterlyRevenueFormula(row, person, isTeam) {
  const qStart = `DATE(LEFT(A${row},4),(MATCH(RIGHT(A${row},1),{"1","2","3","4"},0)-1)*3+1,1)`;
  const qEnd = `EOMONTH(${qStart},2)`;
  const nd = numDate(`${AL}!A2:A${RN}`);
  const n1 = numDate(`TEXT(${qStart},"yyyy-mm-dd")`);
  const n2 = numDate(`TEXT(${qEnd},"yyyy-mm-dd")`);
  const df = `${nd}>=${n1},${nd}<=${n2}`;
  const pf = isTeam ? '' : `,LEFT(${col('B')},LEN("${person}"))="${person}"`;
  return `=IFERROR(SUM(ARRAYFORMULA(VALUE(SUBSTITUTE(SUBSTITUTE(FILTER(${col('G')},${df}${pf},${col('D')}="Job Won"),"$",""),",","")))),"")`;
}

function buildQuarterlyStorageRow(quarterStr, rowNum, personName, companyName, ownerName, isTeam, message) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  const colMap = {};
  for (let i = 0; i < defs.length; i++) {
    colMap[defs[i].name] = getColLetter(2 + i);
  }

  const row = [quarterStr, message || ''];
  for (const def of defs) {
    row.push(quarterlyStorageCount(def, rowNum, personName, isTeam, colMap));
  }
  for (const comp of computedEntries) {
    row.push(storageEfficiencyFormula(comp, colMap, rowNum));
  }
  row.push(quarterlyRevenueFormula(rowNum, personName, isTeam));
  return row;
}

async function populateQuarterlyStorage(spreadsheetId, tabName, personName, companyName, ownerName, isTeam, fallbackTabName) {
  const { blocks } = loadConfig(companyName);
  const { defs } = getOutcomeDefs(ownerName, companyName);
  const outcomeNames = defs.map(d => d.name);
  const computedBlock = (blocks.eowBlocks || []).find(b => b.computed);
  const computedEntries = computedBlock ? computedBlock.computed : [];

  // Read existing data (quarters + messages) from current storage
  let allRows = await readTab(spreadsheetId, tabName);
  let quarterData = allRows.slice(1).filter(r => r[0]).map(r => ({
    quarter: r[0],
    message: r[1] || '',
  }));

  // For Team tabs, derive quarters from individual tab if empty
  if (quarterData.length === 0 && fallbackTabName) {
    const fbRows = await readTab(spreadsheetId, fallbackTabName);
    quarterData = fbRows.slice(1).filter(r => r[0]).map(r => ({
      quarter: r[0],
      message: '',
    }));
  }

  // Scan Activity Log for all quarters with data for this person
  const actRows = await readTab(spreadsheetId, 'Activity Log');
  const actQuarters = new Set();
  for (const row of actRows.slice(1)) {
    const d = row[0] || '';
    if (!d) continue;
    if (!isTeam && row[1] !== personName) continue;
    const dateStr = parseSerialDate(d);
    const month = parseInt(dateStr.substring(5, 7));
    const year = dateStr.substring(0, 4);
    const q = Math.ceil(month / 3);
    actQuarters.add(`${year}-Q${q}`);
  }

  // Merge: add any Activity Log quarters not already in existing data
  const existingQuarterSet = new Set(quarterData.map(q => q.quarter));
  for (const q of actQuarters) {
    if (!existingQuarterSet.has(q)) {
      quarterData.push({ quarter: q, message: '' });
    }
  }

  // Deduplicate
  const seenQuarters = new Set();
  quarterData = quarterData.filter(q => {
    if (seenQuarters.has(q.quarter)) return false;
    seenQuarters.add(q.quarter);
    return true;
  });

  // Sort by quarter
  quarterData.sort((a, b) => a.quarter.localeCompare(b.quarter));

  if (quarterData.length === 0) {
    console.log(`  No quarters found in ${tabName}, skipping.`);
    return;
  }

  // Build header
  const header = ['Quarter', 'Message'];
  for (const name of outcomeNames) header.push(name);
  for (const comp of computedEntries) header.push(comp.name);
  header.push('Total Revenue');

  // Build formula rows, preserving existing messages
  const grid = [header];
  for (let i = 0; i < quarterData.length; i++) {
    grid.push(buildQuarterlyStorageRow(quarterData[i].quarter, i + 2, personName, companyName, ownerName, isTeam, quarterData[i].message));
  }

  // Clear a wider range than the new schema width to wipe any stale columns
  // from a previous schema (e.g. removed efficiency-rate columns) that would
  // otherwise survive and create duplicate header names.
  const lastCol = getColLetter(2 + defs.length + computedEntries.length + 1 + 20);
  await clearRange(spreadsheetId, `'${tabName}'!A1:${lastCol}${Math.max(quarterData.length + 10, 500)}`);
  await writeSheet(spreadsheetId, `'${tabName}'!A1`, grid);
  console.log(`  Populated ${tabName} with ${quarterData.length} rows of live formulas`);
}

// ─── Main Entry Point ────────────────────────────────────────────────

async function populateAllFormulas(spreadsheetId, companyName, ownerName, salesPeople) {
  console.log(`Populating live formulas for ${companyName}...`);

  // Find first active person for Team tab fallback
  const firstPerson = salesPeople.find(p => p.active);
  const fbPrefix = firstPerson ? firstPerson.name : null;

  for (const person of salesPeople) {
    if (!person.active) continue;
    // Display tabs
    await populateEODTab(spreadsheetId, `${person.name} EOD`, person.name, companyName, ownerName, false);
    await populateEOWTab(spreadsheetId, `${person.name} EOW`, person.name, companyName, ownerName, false);
    await populateEOMTab(spreadsheetId, `${person.name} EOM`, person.name, companyName, ownerName, false);
    // Storage tabs
    await populateDailyStorage(spreadsheetId, `${person.name} Daily`, person.name, companyName, ownerName, false);
    await populateWeeklyStorage(spreadsheetId, `${person.name} Weekly`, person.name, companyName, ownerName, false);
    await populateMonthlyStorage(spreadsheetId, `${person.name} Monthly`, person.name, companyName, ownerName, false);
    await populateQuarterlyStorage(spreadsheetId, `${person.name} Quarterly`, person.name, companyName, ownerName, false);
  }

  await populateEODTab(spreadsheetId, 'Team EOD', 'Team', companyName, ownerName, true);
  await populateEOWTab(spreadsheetId, 'Team EOW', 'Team', companyName, ownerName, true);
  await populateEOMTab(spreadsheetId, 'Team EOM', 'Team', companyName, ownerName, true);
  await populateDailyStorage(spreadsheetId, 'Team Daily', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Daily` : null);
  await populateWeeklyStorage(spreadsheetId, 'Team Weekly', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Weekly` : null);
  await populateMonthlyStorage(spreadsheetId, 'Team Monthly', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Monthly` : null);
  await populateQuarterlyStorage(spreadsheetId, 'Team Quarterly', 'Team', companyName, ownerName, true, fbPrefix ? `${fbPrefix} Quarterly` : null);

  console.log('All formula tabs populated.');
}

async function populateLiveFormulas(spreadsheetId, companyName, ownerName, salesPeople) {
  console.log(`Populating live display formulas for ${companyName}...`);

  for (const person of salesPeople) {
    if (!person.active) continue;
    await populateEODTab(spreadsheetId, `${person.name} EOD`, person.name, companyName, ownerName, false);
    await populateEOWTab(spreadsheetId, `${person.name} EOW`, person.name, companyName, ownerName, false);
    await populateEOMTab(spreadsheetId, `${person.name} EOM`, person.name, companyName, ownerName, false);
  }

  await populateEODTab(spreadsheetId, 'Team EOD', 'Team', companyName, ownerName, true);
  await populateEOWTab(spreadsheetId, 'Team EOW', 'Team', companyName, ownerName, true);
  await populateEOMTab(spreadsheetId, 'Team EOM', 'Team', companyName, ownerName, true);

  console.log('Live display tabs populated.');
}

module.exports = {
  populateAllFormulas, populateLiveFormulas, populateEODTab, populateEOWTab, populateEOMTab,
  populateDailyStorage, populateWeeklyStorage, populateMonthlyStorage, populateQuarterlyStorage,
  buildDailyStorageRow, buildWeeklyStorageRow, buildMonthlyStorageRow, buildQuarterlyStorageRow,
  getOutcomeDefs, getColLetter,
};
