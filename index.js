const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ▼▼▼ PASTE YOUR INTERNAL CONNECTION STRING FROM RENDER HERE ▼▼▼
const connectionString = 'postgresql://lottery_database_k6c8_user:2RPtuGpaDg12zyyENA43swO11i6Qqozj@dpg-d2lijlvdiees73c2pvf0-a/lottery_database_k6c8';

// A security check to make sure you've replaced the placeholder
if (connectionString.includes('YOUR_INTERNAL_CONNECTION_STRING')) {
  console.error('ERROR: Database connection string is not set.');
  // In a real app, you'd use environment variables, but for now, this is a good check.
}

// Create a new connection pool. This is more efficient for a web server
// as it manages multiple connections automatically.
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});


// --- NEW API ENDPOINTS (reading from the database) ---

// Endpoint to get the list of all available dates from the database
app.get('/get-available-dates', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT TO_CHAR(draw_date, 'YYYY-MM-DD') as date_val, draw_name
      FROM lottery_results
      ORDER BY date_val DESC;
    `;
    const result = await pool.query(query);
    
    // Format the data to match what the app expects
    const dates = result.rows.map((row, index) => {
      // Logic to format date string nicely for the app
      const date = new Date(row.date_val);
      const isToday = new Date().toDateString() === date.toDateString();
      const dateLabel = isToday ? 'Today' : date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }).toUpperCase().replace(' ', ' ');

      return {
        id: `db-${index}`,
        date: dateLabel,
        drawName: row.draw_name
      };
    });
    
    res.json(dates);
  } catch (error) {
    console.error('Error fetching available dates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint to get all results for a specific date
app.get('/get-all-results', async (req, res) => {
    const { date } = req.query; // date will be "Today" or "AUG 23" etc.
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        // We need a more robust way to get the actual date from the label
        // For now, this simple logic will work for "Today"
        const targetDate = date === 'Today' ? 'CURRENT_DATE' : new Date().toISOString().split('T')[0]; // Simplified for now

        const query = `
            SELECT prize_tier as prize, winning_number as number 
            FROM lottery_results
            WHERE draw_date = (SELECT MAX(draw_date) FROM lottery_results);
        `; // This query just gets the latest results for simplicity
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching all results:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint to check a single ticket
app.get('/check-ticket', async (req, res) => {
    // This endpoint would also be rewritten to query the database.
    // For simplicity in this step, we are focusing on getting the date list working first.
    // The logic would be similar: query the DB instead of checking the MANUAL_RESULTS object.
    res.json({ result: 'lose', reason: 'Check-ticket endpoint not yet migrated to database.' });
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("API server is now connected to the database.");
});