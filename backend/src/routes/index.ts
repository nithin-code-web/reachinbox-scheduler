import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authRouter } from './auth.routes.js';
import { campaignRouter } from './campaign.routes.js';
import { emailRouter } from './email.routes.js';
import { healthRouter } from './health.routes.js';

export const apiRouter = Router();
apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use('/api', requireAuth, campaignRouter);
apiRouter.use('/api', requireAuth, emailRouter);
