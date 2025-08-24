const axios = require('axios');
const pdf = require('pdf-parse');
const { Client } = require('pg');

// ▼▼▼ PASTE YOUR INTERNAL CONNECTION STRING FROM RENDER HERE ▼▼▼
const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a/lottery_database_k6c8';

// This can be updated to fetch a dynamic URL later, but we use a fixed one for now.
const pdfUrl = 'https://statelottery.kerala.gov.in/index.php/lottery-result-view';

// --- DATABASE FUNCTIONS ---

/**
 * Saves the parsed lottery results into the PostgreSQL database.
 * @param {object} parsedResults - The structured object of prize tiers and winning numbers.
 * @param {string} drawName - The name of the draw (e.g., "KARUNYA KR-720").
 * @param {string} drawDateStr - The date of the draw as a string (e.g., "23/08/2025").
 */
const saveResultsToDB = async (parsedResults, drawName, drawDateStr) => {
  if (connectionString.includes('YOUR_INTERNAL_CONNECTION_STRING')) {
    console.error('ERROR: Please replace the placeholder connection string.');
    return;
  }
  
  const client = new Client({
    connectionString: connectionString,
    // SSL is required when running on Render
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Convert date from DD/MM/YYYY to YYYY-MM-DD for SQL
    const dateParts = drawDateStr.split('/');
    const sqlDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    await client.connect();
    console.log('--- Connecting to DB to save results... ---');

    // First, delete any existing results for this date to avoid duplicates
    await client.query('DELETE FROM lottery_results WHERE draw_date = $1', [sqlDate]);
    console.log(`--- Cleared any old results for ${sqlDate} ---`);

    let totalSaved = 0;
    // Loop through each prize tier (e.g., "1st Prize", "4th Prize")
    for (const prizeTier in parsedResults) {
      const winningNumbers = parsedResults[prizeTier];
      
      // Loop through each number in the tier
      for (const number of winningNumbers) {
        const insertQuery = `
          INSERT INTO lottery_results (draw_name, draw_date, prize_tier, winning_number)
          VALUES ($1, $2, $3, $4);
        `;
        await client.query(insertQuery, [drawName, sqlDate, prizeTier, number]);
        totalSaved++;
      }
    }
    
    console.log(`--- SUCCESS: Successfully saved ${totalSaved} results to the database. ---`);

  } catch (error) {
    console.error('ERROR: Could not save results to the database.');
    console.error(error);
  } finally {
    await client.end();
  }
};


// --- PDF PARSING FUNCTIONS ---

function extractNumbersBetween(text, startKeyword, endKeyword, regex, skipFirst = false) {
  try {
    const startIndex = text.indexOf(startKeyword);
    const endIndex = text.indexOf(endKeyword);
    let section = text.substring(startIndex, endIndex);
    section = section.replace(/Page \d+Modernization.*?$/gm, '');
    let matches = section.match(regex) || [];
    if (skipFirst && matches.length > 0) {
      matches = matches.slice(1);
    }
    return matches;
  } catch (e) { return []; }
}

function parseLotteryResults(rawText) {
  const results = {};
  const fullTicketRegex = /[A-Z]{2}\s\d{6}/g;
  const fourDigitRegex = /\d{4}/g;

  results['1st Prize'] = extractNumbersBetween(rawText, '1st Prize', 'Cons Prize', fullTicketRegex);
  results['Consolation Prize'] = extractNumbersBetween(rawText, 'Cons Prize', '2nd Prize', fullTicketRegex);
  results['2nd Prize'] = extractNumbersBetween(rawText, '2nd Prize', '3rd Prize', fullTicketRegex);
  results['3rd Prize'] = extractNumbersBetween(rawText, '3rd Prize', '4th Prize', fullTicketRegex);
  results['4th Prize'] = extractNumbersBetween(rawText, '4th Prize', '5th Prize', fourDigitRegex, true);
  results['5th Prize'] = extractNumbersBetween(rawText, '5th Prize', '6th Prize', fourDigitRegex, true);
  results['6th Prize'] = extractNumbersBetween(rawText, '6th Prize', '7th Prize', fourDigitRegex, true);
  results['7th Prize'] = extractNumbersBetween(rawText, '7th Prize', '8th Prize', fourDigitRegex);
  results['8th Prize'] = extractNumbersBetween(rawText, '8th Prize', '9th Prize', fourDigitRegex);
  results['9th Prize'] = extractNumbersBetween(rawText, '9th Prize', 'The prize winners', fourDigitRegex);

  // Also extract draw name and date
  const drawNameMatch = rawText.match(/(\w+\s+LOTTERY NO\..*?)\s/);
  const drawDateMatch = rawText.match(/DRAW held on:-?\s*(\d{2}\/\d{2}\/\d{4})/);

  const extraInfo = {
      drawName: drawNameMatch ? drawNameMatch[1].trim() : 'Unknown Draw',
      drawDate: drawDateMatch ? drawDateMatch[1].trim() : 'Unknown Date'
  };

  return { results, extraInfo };
}


// --- MAIN FUNCTION ---
const main = async () => {
  console.log('--- Starting Data Miner ---');
  try {
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    console.log('--- PDF Text Extracted, Now Parsing... ---');

    const { results, extraInfo } = parseLotteryResults(data.text);
    console.log(`--- Parsed Data for: ${extraInfo.drawName} on ${extraInfo.drawDate} ---`);
    console.log(JSON.stringify(results, null, 2));

    await saveResultsToDB(results, extraInfo.drawName, extraInfo.drawDate);

  } catch (error) {
    console.error('An error occurred during the main process:', error.message);
  }
};

main();