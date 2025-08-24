const express = require('express');
const { Pool } = require('pg');
const { main: runDataMiner } = require('./data-miner.js');

const app = express();
const PORT = process.env.PORT || 3000;

const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a.singapore-postgres.render.com/lottery_database_k6c8'; // Use your External URL
const CRON_SECRET = 'your-very-secret-key-12345'; 

if (connectionString.includes('YOUR_')) {
  console.error('ERROR: Database connection string is not set.');
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

app.get('/get-available-dates', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT draw_date, draw_name
      FROM lottery_results
      ORDER BY draw_date DESC;
    `;
    const result = await pool.query(query);
    
    const dates = result.rows.map((row, index) => {
      const date = new Date(row.draw_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      date.setUTCHours(0,0,0,0); // Compare dates in UTC
      
      const isToday = today.getTime() === date.getTime();
      
      const dateLabel = isToday 
        ? 'Today' 
        : date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

      return {
        id: `db-${index}`,
        date: dateLabel,
        sqlDate: row.draw_date.toISOString().split('T')[0],
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
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        const query = `
            SELECT 
              prize_tier as prize, 
              winning_number as number,
              CASE 
                WHEN LENGTH(winning_number) > 4 THEN 'full' 
                ELSE 'endsWith' 
              END as type
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
    const { ticket, date } = req.query;
    if (!ticket || !date) {
        return res.status(400).json({ error: 'Ticket number and date are required.' });
    }

    try {
        const sanitizedTicket = ticket.replace(/\s/g, '').toUpperCase();
        
        // 1. Check for a full match, ignoring spaces in the database
        let result = await pool.query(
            "SELECT prize_tier as prize, 'Amount TBA' as amount FROM lottery_results WHERE draw_date = $1 AND REPLACE(winning_number, ' ', '') = $2",
            [date, sanitizedTicket]
        );

        if (result.rows.length > 0) {
            return res.json({ result: 'win', details: result.rows[0] });
        }

        // 2. If no full match, check for partial (last 4 digits)
        if (sanitizedTicket.length >= 4) {
            const lastFour = sanitizedTicket.slice(-4);
            result = await pool.query(
                "SELECT prize_tier as prize, 'Amount TBA' as amount FROM lottery_results WHERE draw_date = $1 AND winning_number = $2",
                [date, lastFour]
            );

            if (result.rows.length > 0) {
                return res.json({ result: 'win', details: result.rows[0] });
            }
        }

        res.json({ result: 'lose' });

    } catch (error) {
        console.error('Error checking ticket:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/run-cron', async (req, res) => {
  const providedSecret = req.headers['authorization'];

  if (providedSecret !== `Bearer ${CRON_SECRET}`) {
    console.log('CRON JOB: Invalid secret provided.');
    return res.status(401).send('Unauthorized');
  }

  console.log('CRON JOB: Correct secret received. Starting data miner...');
  res.status(202).send('Accepted'); 
  try {
    await runDataMiner();
    console.log('CRON JOB: Data miner finished successfully.');
  } catch (e) {
    console.error('CRON JOB: Data miner failed.', e);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("API server is connected to the database.");
});