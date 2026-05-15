import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
  scenarios: {
    steady: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '30s',
    },
  },
};

export default function () {
  const baseUrl = __ENV.GTOM_URL || 'http://localhost:3003';
  const response = http.post(`${baseUrl}/gtom/predict-conflicts`, JSON.stringify({
    task: { raw_description: 'load test conflict prediction' },
    active_attempts: [],
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(response, {
    'status is 200': (res) => res.status === 200,
    'has risk': (res) => Boolean(res.json('overall_risk')),
  });
  sleep(1);
}
