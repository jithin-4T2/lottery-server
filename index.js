const express = require('express');
const { Pool } = require('pg');
const { main: runDataMiner } = require('./data-miner.js'); // Import the data miner

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---

// ▼▼▼ PASTE YOUR INTERNAL CONNECTION STRING FROM RENDER HERE ▼▼▼
const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a.singapore-postgres.render.com/lottery_database_k6c8';

// A secret key to prevent others from running your miner. Must match the one in your .yml file.
const CRON_SECRET = 'your-very-secret-key-12345'; 

// --- DATABASE SETUP ---

// A security check to make sure you've replaced the placeholder
if (connectionString.includes('YOUR_INTERNAL_CONNECTION_STRING')) {
  console.error('ERROR: Database connection string is not set.');
}

// Create a new connection pool. This is more efficient for a web server.
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});


// --- API ENDPOINTS (reading from the database) ---

app.get('/get-available-dates', async (req, res) => {
  try {
    // Query for the distinct dates and names, ordering by most recent first.
    const query = `
      SELECT DISTINCT draw_date, draw_name
      FROM lottery_results
      ORDER BY draw_date DESC;
    `;
    const result = await pool.query(query);
    
    // Format the data to match what the app expects
    const dates = result.rows.map((row, index) => {
      const date = new Date(row.draw_date);
      const today = new Date();
      // Set time to 0 to compare dates only, not times
      today.setHours(0, 0, 0, 0);
      
      const isToday = today.getTime() === date.getTime();
      
      const dateLabel = isToday 
        ? 'Today' 
        : date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }).toUpperCase().replace(' ', ' ');

      return {
        id: `db-${index}`,
        date: dateLabel, // e.g., "Today" or "23 AUG"
        sqlDate: row.draw_date.toISOString().split('T')[0], // e.g., "2025-08-23"
        drawName: row.draw_name
      };
    });
    
    res.json(dates);
  } catch (error) {
    console.error('Error fetching available dates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get('/get-all-results', async (req, res) => {
    const { date } = req.query; // This will be the SQL date "YYYY-MM-DD"
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        const query = `
            SELECT prize_tier as prize, winning_number as number, 'full' as type
            FROM lottery_results
            WHERE draw_date = $1
            ORDER BY id;
        `;
        const result = await pool.query(query, [date]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching all results:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.get('/check-ticket', async (req, res) => {
    const { ticket, date } = req.query; // date will be "YYYY-MM-DD"
    if (!ticket || !date) {
        return res.status(400).json({ error: 'Ticket number and date are required.' });
    }

    try {
        const sanitizedTicket = ticket.replace(/\s/g, '').toUpperCase();
        
        // 1. Check for a full match
        let result = await pool.query(
            "SELECT prize_tier as prize, 'Amount TBA' as amount FROM lottery_results WHERE draw_date = $1 AND winning_number = $2",
            [date, sanitizedTicket]
        );

        if (result.rows.length > 0) {
            return res.json({ result: 'win', details: result.rows[0] });
        }

        // 2. If no full match, check for partial (last 4 digits)
        if (sanitizedTicket.length >= 4) {
            const lastFour = sanitizedTicket.slice(-4);
            result = await pool.query(
                "SELECT prize_tier as prize, 'Amount TBA' as amount FROM lottery_results WHERE draw_date = $1 AND winning_number = $2 AND prize_tier LIKE '%Prize'",
                [date, lastFour]
            );

            if (result.rows.length > 0) {
                return res.json({ result: 'win', details: result.rows[0] });
            }
        }

        // 3. If no matches, it's a loss
        res.json({ result: 'lose' });

    } catch (error) {
        console.error('Error checking ticket:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- CRON JOB TRIGGER ENDPOINT ---

app.post('/run-cron', async (req, res) => {
  const providedSecret = req.headers['authorization'];

  if (providedSecret !== `Bearer ${CRON_SECRET}`) {
    console.log('CRON JOB: Invalid secret provided.');
    return res.status(401).send('Unauthorized');
  }

  console.log('CRON JOB: Correct secret received. Starting data miner...');
  
  // Respond immediately with "Accepted" so GitHub doesn't have to wait for the long process
  res.status(202).send('Accepted'); 

  // Run the data miner function in the background
  try {
    await runDataMiner();
    console.log('CRON JOB: Data miner finished successfully.');
  } catch (e) {
    console.error('CRON JOB: Data miner failed.', e);
  }
});


// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("API server is connected to the database.");
});