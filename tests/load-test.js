import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Staged load ramping
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 VUs
    { duration: '1m', target: 50 },  // Ramp up to 50 VUs
    { duration: '2m', target: 50 },  // Stay at 50 VUs (steady state)
    { duration: '30s', target: 0 },  // Ramp down to 0 VUs
  ],
  // Performance failure conditions
  thresholds: {
    http_req_failed: ['rate<0.01'],             // Less than 1% errors
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% under 500ms, 99% under 1s
  },
};

export default function () {
  const url = 'https://your-api-endpoint.com/api/v1/resource';
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      // 'Authorization': 'Bearer YOUR_TOKEN_HERE',
    },
  };

  const res = http.get(url, params);

  // Validate response status and content
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  // User think-time between requests (1 to 3 seconds)
  sleep(Math.random() * 2 + 1);
}