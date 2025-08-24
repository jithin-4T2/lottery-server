const axios = require('axios');
const pdf = require('pdf-parse');
const { Client } = require('pg');

const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a.singapore-postgres.render.com/lottery_database_k6c8';
const baseUrl = 'https://result.keralalotteries.com/viewlotisresult.php?drawserial=';

const processSingleDraw = async (serialNumber) => {
  const pdfUrl = baseUrl + serialNumber;
  try {
    console.log(`--- Attempting to process draw serial: ${serialNumber} ---`);
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    console.log(`--- PDF found for ${serialNumber}. Parsing... ---`);
    const { results, extraInfo } = parseLotteryResults(data.text);
    console.log(`--- Parsed Data for: ${extraInfo.drawName} on ${extraInfo.drawDate} ---`);
    await saveResultsToDB(results, extraInfo.drawName, extraInfo.drawDate);
    return true;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`--- No PDF found for serial ${serialNumber}. This is the latest result. ---`);
    } else {
      console.error(`An error occurred processing serial ${serialNumber}:`, error.message);
    }
    return false;
  }
};

const main = async () => {
  console.log('--- Starting Data Miner ---');
  let currentSerial = 75000;
  while (true) {
    const success = await processSingleDraw(currentSerial);
    if (!success) {
      break;
    }
    currentSerial++;
  }
  console.log('--- Data Miner finished its run. ---');
};

const saveResultsToDB = async (parsedResults, drawName, drawDateStr) => {
  if (connectionString.includes('YOUR_')) {
    console.error('ERROR: Connection string not set in data-miner.js.');
    return;
  }
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  try {
    const dateParts = drawDateStr.split('/');
    const sqlDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    await client.connect();
    await client.query('DELETE FROM lottery_results WHERE draw_date = $1', [sqlDate]);
    let totalSaved = 0;
    for (const prizeTier in parsedResults) {
      const prizeInfo = parsedResults[prizeTier];
      for (const number of prizeInfo.numbers) {
        const insertQuery = `
          INSERT INTO lottery_results (draw_name, draw_date, prize_tier, amount, winning_number)
          VALUES ($1, $2, $3, $4, $5);
        `;
        await client.query(insertQuery, [drawName, sqlDate, prizeTier, prizeInfo.amount, number]);
        totalSaved++;
      }
    }
    console.log(`--- SUCCESS: Saved ${totalSaved} results to the database. ---`);
  } catch (error) {
    console.error('ERROR: Could not save results to DB.', error);
  } finally {
    await client.end();
  }
};

const parseLotteryResults = (rawText) => {
  const results = {};
  const prizeRegex = /((\d+)(?:st|nd|rd|th)\sPrize|Cons\sPrize)[\s\S]*?Rs\s*:([\d,]+)/;

  const sections = rawText.split(/(?=(?:\d+)(?:st|nd|rd|th)\sPrize|Cons\sPrize)/);

  sections.forEach(section => {
    const match = section.match(prizeRegex);
    if (match) {
      const prizeTier = match[1].trim();
      const amount = `₹${match[3]}`;
      
      const fullTicketRegex = /[A-Z]{2}\s\d{6}/g;
      const fourDigitRegex = /\d{4}/g;
      
      let numbers = section.match(fullTicketRegex) || section.match(fourDigitRegex) || [];
      if(prizeTier.includes("Prize") && numbers.length > 0 && numbers[0] === match[3].replace(/,/g, '')){
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

module.exports = { main };