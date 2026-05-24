// One-off import of the initial Zac + Buzz won_jobs batch (13 rows).
// Idempotent via (invoice_number, company_name, sales_person_name) — re-runs
// update existing rows in place.
//
// Usage:  DATABASE_URL=... node src/scripts/importWonJobs.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

// 13 rows from the user's first invoice batch. Dates are AU-format
// DD/MM/YYYY in the source; normalised to YYYY-MM-DD here.
const ROWS = [
  // ─── ZAC · Bolton ────────────────────────────────────────────────
  { company: 'Bolton EC', person: 'Zac', invoice: '11966', date: '2026-04-10',
    type: 'retainer', stage: 'paid',
    contact: null, address: null, jobValue: null, commission: 500.00,
    notes: 'April — sales-exec retainer (50% of $1,000 split with Lachlan)' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12168', date: '2026-04-28',
    type: 'comms', stage: 'paid',
    contact: 'Dari Kiamarsi', address: '8A Unwin Cres, Salter Point WA 6152',
    jobValue: 31382.73, commission: 950.00,
    notes: '$31,382.73 × 2.5% = $784.57 (min $950 applied)' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12169', date: '2026-04-28',
    type: 'comms', stage: 'paid',
    contact: 'Stefania Little', address: '11c Hertha Road, Innaloo WA 6018',
    jobValue: 5163.76, commission: 258.19,
    notes: '$5,163.76 × 5% = $258.19' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12222', date: '2026-05-04',
    type: 'comms', stage: 'paid',
    contact: 'Mark Peacock', address: '14 Stafford Way, Wanneroo WA 6065',
    jobValue: 70970.91, commission: 1419.42,
    notes: '$70,970.91 × 2% = $1,419.42' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12223', date: '2026-05-06',
    type: 'comms', stage: 'paid',
    contact: 'Owen Hall', address: '8 Greensand Prom, Treeby WA 6164',
    jobValue: 29997.21, commission: 899.92,
    notes: '$29,997.21 × 3% = $899.92' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12225', date: '2026-05-06',
    type: 'comms', stage: 'paid',
    contact: 'Chad Mid', address: '3 Goldsmith Drive, Wellard WA 6170',
    jobValue: 37328.38, commission: 950.00,
    notes: '$37,328.38 × 2.5% = $933.21 (min $950 applied)' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12249', date: '2026-05-11',
    type: 'comms', stage: 'paid',
    contact: 'Stephen Cane', address: '11 Marsh Place, Halls Head WA 6210',
    jobValue: 22955.45, commission: 800.00,
    notes: '$22,955.45 × 3% = $688.66 (min $800 applied)' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12250', date: '2026-05-12',
    type: 'comms', stage: 'paid',
    contact: 'Matt Callaghan', address: '3 Weston Way, Kardinya WA 6163',
    jobValue: 33327.27, commission: 950.00,
    notes: '$33,327.27 × 2.5% = $833.18 (min $950 applied)' },

  { company: 'Bolton EC', person: 'Zac', invoice: '12148', date: '2026-05-12',
    type: 'retainer', stage: 'paid',
    contact: null, address: null, jobValue: null, commission: 500.00,
    notes: 'May — sales-exec retainer (50% of $1,000 split with Lachlan)' },

  // ─── BUZZ · HDK Long Run Roofing ─────────────────────────────────
  { company: 'HDK Long Run Roofing', person: 'Buzz', invoice: '12164', date: '2026-04-28',
    type: 'comms', stage: 'paid',
    contact: 'Nilla Loheni', address: null,
    jobValue: 4330.41, commission: 102.87,
    notes: '$4,330.41 NZD × 5% = $216.52 (min $250 applied) → AUD @ 0.82298 = $205.75 split 50/50 with Lachlan; this is Buzz half ($102.87 AUD)' },

  { company: 'HDK Long Run Roofing', person: 'Buzz', invoice: '12170', date: '2026-04-28',
    type: 'comms', stage: 'paid',
    contact: 'Bella Chase', address: '4a Highland Avenue',
    jobValue: 11531.20, commission: 411.49,
    notes: '$11,531.20 NZD × 4% = $461.25 (min $500 applied) → AUD @ 0.82298 = $411.49' },

  { company: 'HDK Long Run Roofing', person: 'Buzz', invoice: '12219', date: '2026-05-05',
    type: 'comms', stage: 'paid',
    contact: 'Dale', address: '28 Harley Road, Takapuna, Auckland, New Zealand',
    jobValue: 29881.79, commission: 367.37,
    notes: '$29,881.79 NZD × 3% = $896.45 (min $800; calc wins) → AUD @ 0.81961 = $734.74 split 50/50 with Lachlan; this is Buzz half ($367.37 AUD)' },

  // ─── BUZZ · Hughes Electrical ────────────────────────────────────
  { company: 'Hughes Electrical', person: 'Buzz', invoice: '12296', date: '2026-05-21',
    type: 'comms', stage: 'invoiced',
    contact: 'Rosemary Burd', address: '3 Flecker Ct, Winthrop WA 6150',
    jobValue: 15429.09, commission: 617.16,
    notes: '$15,429.09 × 4% = $617.16 — invoice issued, not yet paid' },

  // ─── LACHLAN · Bolton EC ─────────────────────────────────────────
  // Jan 2026
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11508', date: '2026-01-09', type: 'comms', stage: 'paid', contact: 'Wayne', address: '18 Cinnamon Meander, Two Rocks WA 6037', jobValue: 18334.25, commission: 733.37, notes: '$18,334.25 × 4% = $733.37' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11509', date: '2026-01-09', type: 'comms', stage: 'paid', contact: 'Andy Croot', address: '4 Lund Court, Roleystone WA 6111', jobValue: 26154.73, commission: 800.00, notes: '$26,154.73 × 3% = $784.64 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11547', date: '2026-01-15', type: 'comms', stage: 'paid', contact: 'Peter Zhao', address: '19 Spuria Way, Treeby WA 6164', jobValue: 34498.63, commission: 950.00, notes: '$34,498.63 × 2.5% = $862.47 (min $950)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11548', date: '2026-01-15', type: 'comms', stage: 'paid', contact: 'Ben Whettingsteel', address: '24 Kentia Close, Warnbro WA 6169', jobValue: 15831.82, commission: 633.27, notes: '$15,831.82 × 4% = $633.27' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11549', date: '2026-01-15', type: 'comms', stage: 'paid', contact: 'Ryan Carey', address: '22 Bobtail Circuit, Brigadoon WA 6069', jobValue: 8196.36, commission: 409.82, notes: '$8,196.36 × 5% = $409.82' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11550', date: '2026-01-15', type: 'comms', stage: 'paid', contact: 'Kitt Nakhonwog', address: '60 Balfour Rd, Swan View WA 6056', jobValue: 13636.36, commission: 545.45, notes: '$13,636.36 × 4% = $545.45' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11551', date: '2026-01-15', type: 'comms', stage: 'paid', contact: 'Dave Allen Williams', address: null, jobValue: 4016.36, commission: 250.00, notes: '$4,016.36 × 5% = $200.82 (min $250)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11426', date: '2026-01-15', type: 'retainer', stage: 'paid', contact: null, address: null, jobValue: null, commission: 1000.00, notes: 'January — sales-exec retainer (full $1,000, pre-Zac)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11594', date: '2026-01-22', type: 'comms', stage: 'paid', contact: 'Valentin Dorchies', address: '84A Oats Street, Carlisle WA 6101', jobValue: 13864.55, commission: 554.58, notes: '$13,864.55 × 4% = $554.58' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11595', date: '2026-01-22', type: 'comms', stage: 'paid', contact: 'Peter Keith Duff', address: '127A Marmion Street, Fremantle WA 6160', jobValue: 17438.18, commission: 697.53, notes: '$17,438.18 × 4% = $697.53' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11596', date: '2026-01-22', type: 'comms', stage: 'paid', contact: 'Ben Tomkinson', address: null, jobValue: 20760.91, commission: 800.00, notes: '$20,760.91 × 3% = $622.83 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11622', date: '2026-01-30', type: 'comms', stage: 'paid', contact: 'Jody Bradburn', address: '3 Dolly Link, Secret Harbour WA 6173', jobValue: 24265.69, commission: 800.00, notes: '$24,265.69 × 3% = $727.97 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11623', date: '2026-01-30', type: 'comms', stage: 'paid', contact: 'Ying Ying Tham', address: 'Unit 2/11 Bungaree Rd, Wilson WA 6107', jobValue: 4510.98, commission: 250.00, notes: '$4,510.98 × 5% = $225.55 (min $250)' },

  // Feb 2026
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11674', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Jonathon Chung', address: '54a Bull Creek Rd, Rossmoyne WA 6148', jobValue: 20346.65, commission: 800.00, notes: '$20,346.65 × 3% = $610.40 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11675', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Andrew Baxter', address: '246 Newnham Road, Lake Clifton WA 6215', jobValue: 17594.38, commission: 703.78, notes: '$17,594.38 × 4% = $703.78' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11676', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Amit Gadani', address: '56 Alabaster Approach, Jindalee WA 6036', jobValue: 19545.45, commission: 781.82, notes: '$19,545.45 × 4% = $781.82' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11677', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Greg Walker', address: '10 Balka Court, Wellard WA 6170', jobValue: 18563.29, commission: 742.53, notes: '$18,563.29 × 4% = $742.53' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11678', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Matt Castafaro', address: '1 East Terrace, Kalamunda WA 6076', jobValue: 4668.15, commission: 250.00, notes: '$4,668.15 × 5% = $233.41 (min $250)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11679', date: '2026-02-06', type: 'comms', stage: 'paid', contact: 'Carolyn Manning', address: '10 Kirby Ct, Huntingdale WA 6110', jobValue: 6475.45, commission: 323.77, notes: '$6,475.45 × 5% = $323.77' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11610', date: '2026-02-13', type: 'retainer', stage: 'paid', contact: null, address: null, jobValue: null, commission: 1000.00, notes: 'February — sales-exec retainer (full $1,000, pre-Zac)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11728', date: '2026-02-13', type: 'comms', stage: 'paid', contact: 'Jason Oreb', address: '18 Black Swan Rise, Beeliar WA 6164', jobValue: 27272.73, commission: 818.18, notes: '$27,272.73 × 3% = $818.18' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11769', date: '2026-02-19', type: 'comms', stage: 'paid', contact: 'Dwayne Millen', address: '53 Barbera Lane, The Vines WA', jobValue: 19344.54, commission: 773.78, notes: '$19,344.54 × 4% = $773.78' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11770', date: '2026-02-19', type: 'comms', stage: 'paid', contact: 'Charlie Chan', address: '13 Webb Street, Rossmoyne WA 6148', jobValue: 23668.93, commission: 800.00, notes: '$23,668.93 × 3% = $710.07 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11771', date: '2026-02-19', type: 'comms', stage: 'paid', contact: 'Adrian (Zads) Zadow', address: '1/11 Castlefern St, Ellenbrook WA 6069', jobValue: 13584.16, commission: 543.37, notes: '$13,584.16 × 4% = $543.37' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11772', date: '2026-02-19', type: 'comms', stage: 'paid', contact: 'Tony Tan', address: null, jobValue: 33383.21, commission: 475.00, notes: '$33,383.21 × 2.5% = $417.29 (min $475)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11773', date: '2026-02-19', type: 'comms', stage: 'paid', contact: 'Barry Reid', address: '36 Honeywood Ave, Wandi WA 6167', jobValue: 3288.00, commission: 250.00, notes: '$3,288.00 × 5% = $164.40 (min $250)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11799', date: '2026-02-27', type: 'comms', stage: 'paid', contact: 'Bryan Seungski Kim', address: '21 Burdekin Vista, Hammond Park WA 6164', jobValue: 19634.93, commission: 785.40, notes: '$19,634.93 × 4% = $785.40' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11800', date: '2026-02-27', type: 'comms', stage: 'paid', contact: 'Lisa Brody', address: '10 Seymour Ave, Dianella WA 6059', jobValue: 2439.09, commission: 250.00, notes: '$2,439.09 × 5% = $121.95 (min $250)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11801', date: '2026-02-27', type: 'comms', stage: 'paid', contact: 'Tri', address: '8 Braeside Rd, Mt Lawley', jobValue: 16284.80, commission: 500.00, notes: '$16,284.80 × 2.5% = $407.12 (min $500)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11802', date: '2026-02-27', type: 'comms', stage: 'paid', contact: 'Nina Labus', address: 'Unit 5 - 63 Central Ave, Mount Lawley', jobValue: 11878.71, commission: 500.00, notes: '$11,878.71 × 4% = $475.15 (min $500)' },

  // Mar 2026
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11853', date: '2026-03-04', type: 'comms', stage: 'paid', contact: 'Gordon Hau', address: '76 Louisiana Glen, Treeby WA 6164', jobValue: 38483.99, commission: 962.10, notes: '$38,483.99 × 2.5% = $962.10' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11854', date: '2026-03-04', type: 'comms', stage: 'paid', contact: 'Ryan Zammit', address: '37 Rainbow Cres, Bennett Springs WA 6063', jobValue: 30688.50, commission: 950.00, notes: '$30,688.50 × 2.5% = $767.21 (min $950)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11871', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Ian Holt', address: '24 Leithdale Rd, Darlington WA 6070', jobValue: 27039.28, commission: 811.18, notes: '$27,039.28 × 3% = $811.18' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11872', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Rowena Davis', address: '11 Heliconia Turn, Stirling WA 6021', jobValue: 11695.45, commission: 500.00, notes: '$11,695.45 × 4% = $467.82 (min $500)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11873', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Sara Al Rashid', address: '14 Wattlebird Entrance, Maddington WA 6109', jobValue: 22478.98, commission: 800.00, notes: '$22,478.98 × 3% = $674.37 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11874', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Jill Crippin', address: '3A Upnor Street, Wilson WA 6107', jobValue: 5913.00, commission: 295.65, notes: '$5,913 × 5% = $295.65' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11875', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Eulogio Almanza', address: '190A Weaponess Road, Wembley Downs WA 6019', jobValue: 20195.66, commission: 800.00, notes: '$20,195.66 × 3% = $605.87 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11876', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Nicola Peiris', address: '8 Aberdeen Terrace, Landsdale WA 6065', jobValue: 21754.49, commission: 800.00, notes: '$21,754.49 × 3% = $652.63 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11877', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Max Hartree', address: '7 Radius Loop, Bayswater WA 6053', jobValue: 18777.73, commission: 751.11, notes: '$18,777.73 × 4% = $751.11' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11878', date: '2026-03-10', type: 'comms', stage: 'paid', contact: 'Katie Chinnock', address: '152 Ocean Drive, Quinns Rocks WA 6030', jobValue: 19657.83, commission: 786.31, notes: '$19,657.83 × 4% = $786.31' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11783', date: '2026-03-10', type: 'retainer', stage: 'paid', contact: null, address: null, jobValue: null, commission: 1000.00, notes: 'March — sales-exec retainer (full $1,000, pre-Zac)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11985', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Maurice Seamons', address: '29 Royal Scot Loop, Currambine WA 6028', jobValue: 5807.74, commission: 290.39, notes: '$5,807.74 × 5% = $290.39' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11986', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Dean McKenzie', address: '34 Paramatta Road, Doubleview WA 6018', jobValue: 13872.53, commission: 554.90, notes: '$13,872.53 × 4% = $554.90' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11987', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Alicia Tan', address: '4 Kelly Place, Willetton WA 6155', jobValue: 21845.55, commission: 800.00, notes: '$21,845.55 × 3% = $655.37 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11988', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Teresa Ke', address: '52 Surrey Street, Dianella WA 6059', jobValue: 27002.02, commission: 810.06, notes: '$27,002.02 × 3% = $810.06' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11989', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Jeremy', address: null, jobValue: 25500.00, commission: 800.00, notes: '$25,500 × 3% = $765 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11990', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Irene Phenk', address: null, jobValue: 28500.00, commission: 855.00, notes: '$28,500 × 3% = $855' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11992', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Flo Tai', address: '9 The Heights, Canning Vale WA 6155', jobValue: 28500.00, commission: 855.00, notes: '$28,500 × 3% = $855' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11993', date: '2026-03-31', type: 'comms', stage: 'paid', contact: 'Chris Knee', address: '5 Marie Way, Kalamunda WA 6076', jobValue: 20229.88, commission: 800.00, notes: '$20,229.88 × 3% = $606.90 (min $800)' },

  // Apr 2026
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12095', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Cyrus Mistry', address: '47 Parkside Avenue, Mount Pleasant WA 6153', jobValue: 26363.64, commission: 800.00, notes: '$26,363.64 × 3% = $790.91 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12096', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Chris Pelajic', address: '10 Sherbrooke Gardens, Bibra Lake WA 6163', jobValue: 19376.35, commission: 775.05, notes: '$19,376.35 × 4% = $775.05' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12097', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Nick Mehanikov', address: '131 Aldersyde Road, Piesse Brook WA 6076', jobValue: 36161.73, commission: 950.00, notes: '$36,161.73 × 2.5% = $904.04 (min $950)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12098', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Danny Murabito', address: '798 Great Northern Highway, Herne Hill WA 6056', jobValue: 10078.63, commission: 500.00, notes: '$10,078.63 × 4% = $403.15 (min $500)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12099', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Bevan & Marie', address: '2 Avalon Close, Woodvale', jobValue: 10438.07, commission: 500.00, notes: '$10,438.07 × 4% = $417.52 (min $500)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12100', date: '2026-04-16', type: 'comms', stage: 'paid', contact: 'Rizwan Islam', address: '17 Tiger Cir, Southern River WA 6110', jobValue: 17426.22, commission: 697.05, notes: '$17,426.22 × 4% = $697.05' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '11966', date: '2026-04-16', type: 'retainer', stage: 'paid', contact: null, address: null, jobValue: null, commission: 500.00, notes: 'April — sales-exec retainer (50% of $1,000 split with Zac)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12136', date: '2026-04-22', type: 'comms', stage: 'paid', contact: 'Chris Mearns', address: 'Unit 5/110 Inspiration Drive, Wangara WA 6065', jobValue: 25233.53, commission: 800.00, notes: '$25,233.53 × 3% = $757.01 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12137', date: '2026-04-22', type: 'comms', stage: 'paid', contact: 'Ryan Haworth', address: '11 Shrike Gardens, Ballajura WA 6066', jobValue: 19033.46, commission: 761.34, notes: '$19,033.46 × 4% = $761.34' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12138', date: '2026-04-22', type: 'comms', stage: 'paid', contact: 'Andrew Ketchell', address: '1 Potter St, Huntingdale WA 6110', jobValue: 9825.77, commission: 491.29, notes: '$9,825.77 × 5% = $491.29' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12139', date: '2026-04-22', type: 'comms', stage: 'paid', contact: 'Garry Marquez', address: '12 Suffolk Way, Haynes WA 6112', jobValue: 13137.07, commission: 525.48, notes: '$13,137.07 × 4% = $525.48' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12141', date: '2026-04-22', type: 'comms', stage: 'paid', contact: 'Nigel Ball', address: '15 Mardolf St, Lesmurdie WA 6076', jobValue: 18845.26, commission: 753.81, notes: '$18,845.26 × 4% = $753.81' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12157', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Andy Croot', address: '4 Lund Court, Roleystone WA 6111', jobValue: 1879.10, commission: 250.00, notes: '$1,879.10 × 5% = $93.96 (min $250) — additional commission on existing client (inv 11509)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12158', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Hussain', address: null, jobValue: 13568.49, commission: 542.74, notes: 'Quote 4966 · $13,568.49 × 4% = $542.74' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12159', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Hussain', address: null, jobValue: 19975.09, commission: 799.00, notes: 'Quote 5377 · $19,975.09 × 4% = $799' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12160', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Roger Crook', address: '2 Dunkeld Glen, Kinross WA 6028', jobValue: 16274.17, commission: 650.97, notes: '$16,274.17 × 4% = $650.97' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12161', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Gary Donaldson', address: '58 Armstrong Way, Noranda WA 6062', jobValue: 21575.27, commission: 800.00, notes: '$21,575.27 × 3% = $647.26 (min $800)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12162', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Graham Reeves', address: '8 Kabi Court, Peppermint Grove Beach WA 6271', jobValue: 17430.12, commission: 697.20, notes: '$17,430.12 × 4% = $697.20' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12163', date: '2026-04-28', type: 'comms', stage: 'paid', contact: 'Stanley Hamilton', address: '5 Prevelly Way, Jurien Bay WA 6516', jobValue: 22240.75, commission: 800.00, notes: '$22,240.75 × 3% = $667.22 (min $800)' },

  // May 2026
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12215', date: '2026-05-05', type: 'comms', stage: 'paid', contact: 'Gary Gilmore', address: null, jobValue: 31387.28, commission: 950.00, notes: '$31,387.28 × 2.5% = $784.68 (min $950)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12216', date: '2026-05-05', type: 'comms', stage: 'paid', contact: 'Harley Johnston', address: '17 Caldervale Avenue, Ellenbrook WA 6069', jobValue: 18531.62, commission: 741.26, notes: '$18,531.62 × 4% = $741.26' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12217', date: '2026-05-05', type: 'comms', stage: 'paid', contact: 'Andrew Ketchell', address: null, jobValue: 1607.00, commission: 250.00, notes: '$1,607 × 5% = $80.35 (min $250) — additional commission on existing client (inv 12138)' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12218', date: '2026-05-05', type: 'comms', stage: 'paid', contact: 'Tony Clifton', address: '12 Waterside Retreat, Wilson WA 6107', jobValue: 14506.02, commission: 580.24, notes: '$14,506.02 × 4% = $580.24' },
  { company: 'Bolton EC', person: 'Lachlan', invoice: '12148', date: '2026-05-13', type: 'retainer', stage: 'paid', contact: null, address: null, jobValue: null, commission: 500.00, notes: 'May — sales-exec retainer (50% of $1,000 split with Zac)' },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Resolve company + sales-person UUIDs once.
    const { rows: companyRows } = await client.query(
      'select id, name from companies where name = any($1::text[])',
      [['Bolton EC', 'HDK Long Run Roofing', 'Hughes Electrical']]
    );
    const companyByName = Object.fromEntries(companyRows.map(c => [c.name, c.id]));

    const { rows: peopleRows } = await client.query(
      'select id, name, company_id from sales_people'
    );
    // key by `${company_id}::${name}`
    const personByKey = Object.fromEntries(
      peopleRows.map(p => [`${p.company_id}::${p.name}`, p.id])
    );

    let inserted = 0, updated = 0, skipped = 0;

    for (const r of ROWS) {
      const companyId = companyByName[r.company];
      if (!companyId) {
        console.warn(`  skip ${r.invoice}: unknown company "${r.company}"`);
        skipped++;
        continue;
      }
      const personId = personByKey[`${companyId}::${r.person}`];
      if (!personId) {
        console.warn(`  skip ${r.invoice}: unknown person "${r.person}" at "${r.company}"`);
        skipped++;
        continue;
      }

      const stageTs = `${r.date}T00:00:00+10:00`; // anchor at AEST midday
      const invoicedAt = (r.stage === 'invoiced' || r.stage === 'paid') ? stageTs : null;
      const paidAt = r.stage === 'paid' ? stageTs : null;

      // Idempotency: match on (invoice_number, company_id, sales_person_id)
      const { rows: existing } = await client.query(
        `select id from won_jobs
         where invoice_number = $1 and company_id = $2 and sales_person_id = $3
         limit 1`,
        [r.invoice, companyId, personId]
      );

      const params = [
        companyId, personId,
        r.contact, r.address, null,             // contact_id unknown
        r.jobValue, r.commission,
        r.type, r.stage,
        invoicedAt, paidAt,
        r.invoice, r.notes,
      ];

      if (existing.length > 0) {
        await client.query(
          `update won_jobs set
             company_id = $1, sales_person_id = $2,
             contact_name = $3, contact_address = $4, contact_id = $5,
             job_value = $6, commission_amount = $7,
             type = $8, stage = $9,
             invoiced_at = $10, paid_at = $11,
             invoice_number = $12, notes = $13
           where id = $14`,
          [...params, existing[0].id]
        );
        updated++;
      } else {
        await client.query(
          `insert into won_jobs (
             company_id, sales_person_id,
             contact_name, contact_address, contact_id,
             job_value, commission_amount,
             type, stage,
             invoiced_at, paid_at,
             invoice_number, notes
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          params
        );
        inserted++;
      }
    }

    console.log(`\n─ done ─`);
    console.log(`  inserted: ${inserted}`);
    console.log(`  updated:  ${updated}`);
    console.log(`  skipped:  ${skipped}`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Import failed:', err.message);
  console.error(err);
  process.exit(1);
});
