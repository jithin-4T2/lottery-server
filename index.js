const express = require('express');
const { Pool } = require('pg');
const { main: runDataMiner } = require('./data-miner.js');

const app = express();
const PORT = process.env.PORT || 3000;

const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a.singapore-postgres.render.com/lottery_database_k6c8'; // Make sure this is your EXTERNAL URL for now
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
      date.setHours(date.getHours() + 5, date.getMinutes() + 30); // Adjust for UTC->IST for comparison
      
      const isToday = today.toDateString() === date.toDateString();
      
      const dateLabel = isToday 
        ? 'Today' 
        : date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }).toUpperCase();

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

// CORRECTED VERSION
app.get('/get-all-results', async (req, res) => {
    const { date } = req.query; // This will now be a "YYYY-MM-DD" string
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        const query = `
            SELECT prize_tier as prize, winning_number as number 
            FROM lottery_results
            WHERE draw_date = $1
            ORDER BY id;
        `;
        const result = await pool.query(query, [date]); // Use the date parameter correctly
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching all results:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// CORRECTED VERSION
app.get('/check-ticket', async (req, res) => {
    const { ticket, date } = req.query; // date will now be "YYYY-MM-DD"
    if (!ticket || !date) {
        return res.status(400).json({ error: 'Ticket number and date are required.' });
    }

    try {
        const sanitizedTicket = ticket.replace(/\s/g, '').toUpperCase();
        
        let result = await pool.query(
            "SELECT prize_tier as prize FROM lottery_results WHERE draw_date = $1 AND winning_number = $2",
            [date, sanitizedTicket]
        );

        if (result.rows.length > 0) {
            return res.json({ result: 'win', details: { ...result.rows[0], amount: 'N/A' } });
        }

        if (sanitizedTicket.length >= 4) {
            const lastFour = sanitizedTicket.slice(-4);
            result = await pool.query(
                "SELECT prize_tier as prize FROM lottery_results WHERE draw_date = $1 AND winning_number = $2",
                [date, lastFour]
            );

            if (result.rows.length > 0) {
                return res.json({ result: 'win', details: { ...result.rows[0], amount: 'N/A' } });
            }
        }

        res.json({ result: 'lose' });

    } catch (error) {
        console.error('Error checking ticket:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/run-cron', async (req, res) => { /* ... same as before ... */ });

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("API server is connected to the database.");
});