const http = require('http');

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function test() {
  console.log('Testing /health...');
  try {
    const health = await makeRequest('/health');
    console.log('✓ /health:', JSON.stringify(health));
  } catch (err) {
    console.log('✗ /health error:', err.message);
  }

  console.log('\nTesting /health/db...');
  try {
    const dbHealth = await makeRequest('/health/db');
    console.log('✓ /health/db:', JSON.stringify(dbHealth));
  } catch (err) {
    console.log('✗ /health/db error:', err.message);
  }
}

test();
