import { buildReviewServer } from './review.js';
await buildReviewServer().listen({
  host: '127.0.0.1',
  port: Number(process.env.REVIEW_API_PORT ?? 3001),
});
