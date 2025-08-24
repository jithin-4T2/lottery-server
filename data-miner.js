const axios = require('axios');
const pdf = require('pdf-parse');
const { Client } = require('pg');

// --- CONFIGURATION ---

// ▼▼▼ PASTE YOUR INTERNAL CONNECTION STRING FROM RENDER HERE ▼▼▼
const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a.singapore-postgres.render.com/lottery_database_k6c8';

// The base URL for fetching PDFs by their serial number
const baseUrl = 'https://result.keralalotteries.com/viewlotisresult.php?drawserial=';

/**
 * Fetches, parses, and saves the results for a single draw serial number.
 * @param {number} serialNumber The draw serial number to process.
 * @returns {Promise<boolean>} True if successful, false if the PDF does not exist.
 */
const processSingleDraw = async (serialNumber) => {
  const pdfUrl = baseUrl + serialNumber;
  
  try {
    console.log(`--- Attempting to process draw serial: ${serialNumber} ---`);
    // 1. Download the PDF
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    
    // 2. Parse the PDF
    const data = await pdf(response.data);
    console.log(`--- PDF found for ${serialNumber}. Parsing... ---`);

    // 3. Extract structured data from the raw text
    const { results, extraInfo } = parseLotteryResults(data.text);
    console.log(`--- Parsed Data for: ${extraInfo.drawName} on ${extraInfo.drawDate} ---`);

    // 4. Save the structured data to the database
    await saveResultsToDB(results, extraInfo.drawName, extraInfo.drawDate);
    return true; // Indicates success, so we should try the next number

  } catch (error) {
    // An error (especially a 404 Not Found) means this PDF doesn't exist yet.
    if (error.response && error.response.status === 404) {
      console.log(`--- No PDF found for serial ${serialNumber}. This is the latest result. ---`);
    } else {
      console.error(`An error occurred processing serial ${serialNumber}:`, error.message);
    }
    return false; // Indicates failure, so we should stop the loop
  }
};

// --- MAIN FUNCTION ---
/**
 * Main function that loops through serial numbers until it finds the latest one.
 */
const main = async () => {
  console.log('--- Starting Data Miner ---');

  // In a more advanced version, this would first query the DB for the last saved number.
  // For now, we start from a known recent number.
  let currentSerial = 75000; 

  while (true) {
    const success = await processSingleDraw(currentSerial);
    if (!success) {
      // If we fail to get a PDF, we assume we've reached the end and stop.
      break;
    }
    currentSerial++; // If successful, move to the next serial number
  }

  console.log('--- Data Miner finished its run. ---');
};

// --- DATABASE FUNCTIONS ---
/**
 * Saves the parsed lottery results into the PostgreSQL database.
 */
const saveResultsToDB = async (parsedResults, drawName, drawDateStr) => {
  if (connectionString.includes('YOUR_INTERNAL_CONNECTION_STRING')) {
    console.error('ERROR: Please replace the placeholder connection string.');
    return;
  }
  
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Convert date from DD/MM/YYYY to YYYY-MM-DD for SQL
    const dateParts = drawDateStr.split('/');
    const sqlDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    await client.connect();
    console.log('--- Connecting to DB to save results... ---');

    await client.query('DELETE FROM lottery_results WHERE draw_date = $1', [sqlDate]);
    console.log(`--- Cleared any old results for ${sqlDate} ---`);

    let totalSaved = 0;
    for (const prizeTier in parsedResults) {
      const winningNumbers = parsedResults[prizeTier];
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
/**
 * Extracts numbers from a block of text between two keywords.
 */
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

/**
 * Parses the raw text from the lottery PDF to find all winning numbers.
 */
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

  const drawNameMatch = rawText.match(/(\w+\s+LOTTERY NO\..*?)\s/);
  const drawDateMatch = rawText.match(/DRAW held on:-?\s*(\d{2}\/\d{2}\/\d{4})/);

  const extraInfo = {
      drawName: drawNameMatch ? drawNameMatch[1].trim() : 'Unknown Draw',
      drawDate: drawDateMatch ? drawDateMatch[1].trim() : 'Unknown Date'
  };

  return { results, extraInfo };
}

// Export the main function so other files can call it
module.exports = { main };