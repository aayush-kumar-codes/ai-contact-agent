import express from 'express';
import router from './router.js';
import 'dotenv/config';
import cors from 'cors';
import { prisma } from '../prisma.js';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const app = express();

app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Hello From AI Contact Agent');
});
app.use('/agent', router);
const PORT = process.env.PORT || 3001;
prisma.$connect().then(() => {
  console.log('Connected to database');
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}).catch((error) => {
  console.error('Error connecting to database', error);
});

