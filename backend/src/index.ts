import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { healthRoute } from './routes/health';
import { parseRoute } from './routes/parse';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: '*',
  }),
);
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' },
});

app.use('/parse', limiter);
app.use('/parse', parseRoute);
app.use('/health', healthRoute);

const PORT = Number(process.env.PORT || 3001);

app.listen(PORT, () => {
  console.log(`Mintay API running on port ${PORT}`);
});
