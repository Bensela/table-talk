const axios = require('axios');

async function testCreateSession() {
  try {
    const payload = {
      table_token: 'Table006',
      restaurant_id: 'default',
      context: 'Exploring',
      mode: 'single-phone'
    };
    
    console.log('Sending POST /sessions with:', payload);
    const res = await axios.post('http://localhost:5000/sessions', payload);
    console.log('Success:', res.data);
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message);
    console.error('Status:', err.response ? err.response.status : 'N/A');
  }
}

testCreateSession();
