// Manual run of the Sales Exec Huddle Board sync.
//
//   node src/scripts/syncHuddleBoard.js            # sync Leaderboards + Client Health
//   node src/scripts/syncHuddleBoard.js --meeting  # also create this week's huddle task

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const { syncHuddleBoard, createWeeklyHuddleTask } = require('../integrations/huddleBoard');

(async () => {
  try {
    await syncHuddleBoard();
    if (process.argv.includes('--meeting')) {
      await createWeeklyHuddleTask();
    }
  } catch (err) {
    console.error('Huddle board sync failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
