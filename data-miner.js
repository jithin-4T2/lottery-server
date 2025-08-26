const axios = require('axios');
const pdf = require('pdf-parse');
const { Client } = require('pg');

// --- CONFIGURATION ---

// ▼▼▼ PASTE YOUR INTERNAL CONNECTION STRING FROM RENDER HERE ▼▼▼
const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a/lottery_database_k6c8';

// The base URL for fetching PDFs by their serial number
const baseUrl = 'https://result.keralalotteries.com/viewlotisresult.php?drawserial=';

/**
 * Main function that finds the last saved serial and loops through new ones.
 */
const main = async () => {
  console.log('--- Starting Data Miner ---');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  let startSerial;

  try {
    // 1. Connect to the DB to get the last saved serial number
    await client.connect();
    const result = await client.query('SELECT MAX(draw_serial) as last_serial FROM lottery_results;');
    
    // If the table is empty, start from a default number. Otherwise, start from the next number.
    startSerial = result.rows[0].last_serial ? result.rows[0].last_serial + 1 : 75000;
    
    console.log(`--- Last saved serial was ${startSerial - 1}. Starting search from ${startSerial}. ---`);
  } catch (e) {
    console.error("DB error when finding last serial. Starting from default 75000.", e);
    startSerial = 75000;
  } finally {
    await client.end();
  }
  
  // 2. Loop through new serial numbers until one is not found
  let currentSerial = startSerial;
  while (true) {
    const success = await processSingleDraw(currentSerial);
    if (!success) {
      break; // Stop if a PDF is not found
    }
    currentSerial++; // Move to the next number
  }
  console.log('--- Data Miner finished its run. ---');
};

/**
 * Fetches, parses, and saves the results for a single draw serial number.
 * @param {number} serialNumber The draw serial number to process.
 * @returns {Promise<boolean>} True if successful, false if the PDF does not exist.
 */
const processSingleDraw = async (serialNumber) => {
  const pdfUrl = baseUrl + serialNumber;
  try {
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    const { results, extraInfo } = parseLotteryResults(data.text);
    await saveResultsToDB(results, extraInfo, serialNumber);
    return true;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`--- No PDF for serial ${serialNumber}. Stopping. ---`);
    } else {
      console.error(`Error processing serial ${serialNumber}:`, error.message);
    }
    return false;
  }
};

/**
 * Saves the parsed lottery results into the PostgreSQL database.
 */
const saveResultsToDB = async (parsedResults, extraInfo, serialNumber) => {
  if (connectionString.includes('YOUR_')) {
    console.error('ERROR: Connection string not set in data-miner.js.');
    return;
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    const sqlDate = extraInfo.drawDate.split('/').reverse().join('-');
    await client.connect();
    
    // Delete old results for this date to prevent duplicates if the job is re-run
    await client.query('DELETE FROM lottery_results WHERE draw_date = $1', [sqlDate]);

    for (const prizeTier in parsedResults) {
      const prizeInfo = parsedResults[prizeTier];
      for (const number of prizeInfo.numbers) {
        const query = `
          INSERT INTO lottery_results (draw_name, draw_date, prize_tier, amount, winning_number, draw_serial) 
          VALUES ($1, $2, $3, $4, $5, $6);
        `;
        await client.query(query, [extraInfo.drawName, sqlDate, prizeTier, prizeInfo.amount, number, serialNumber]);
      }
    }
    console.log(`--- SUCCESS: Saved results for draw ${serialNumber}. ---`);
  } catch (error) {
    console.error('ERROR saving to DB:', error);
  } finally {
    await client.end();
  }
};

/**
 * Parses the raw text from the lottery PDF to find all winning numbers and amounts.
 */
const parseLotteryResults = (rawText) => {
  const results = {};
  // Regex to find prize tiers and their amounts (e.g., "1st Prize...Rs :10,000,000")
  const prizeRegex = /((\d+)(?:st|nd|rd|th)\sPrize|Cons\sPrize)[\s\S]*?Rs\s*:([\d,]+)/;

  // Split the entire text block by the start of each prize section
  const sections = rawText.split(/(?=(?:\d+)(?:st|nd|rd|th)\sPrize|Cons\sPrize)/);

  sections.forEach(section => {
    const match = section.match(prizeRegex);
    if (match) {
      const prizeTier = match[1].trim();
      const amount = `₹${match[3]}`;
      
      const fullTicketRegex = /[A-Z]{2}\s\d{6}/g;
      const fourDigitRegex = /\d{4}/g;
      
      // Find all numbers in the section
      let numbers = section.match(fullTicketRegex) || section.match(fourDigitRegex) || [];
      
      // Clean up the numbers list by removing the prize money if it was accidentally captured
      if (prizeTier.includes("Prize") && numbers.length > 0 && numbers[0] === match[3].replace(/,/g, '')) {
          numbers.shift();
      }
      
      results[prizeTier] = { amount, numbers };
    }
  });

  const drawNameMatch = rawText.match(/(\w+\s+LOTTERY NO\..*?)\s/);
  const drawDateMatch = rawText.match(/DRAW held on:-?\s*(\d{2}\/\d{2}\/\d{4})/);
  const extraInfo = {
    drawName: drawNameMatch ? drawNameMatch[1].trim() : 'Unknown Draw',
    drawDate: drawDateMatch ? drawDateMatch[1].trim() : 'Unknown Date'
  };

  return { results, extraInfo };
};

// Export the main function so it can be called by index.js for the cron job
module.exports = { main };