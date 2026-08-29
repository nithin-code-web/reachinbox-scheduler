import { Router } from 'express';
import { campaignRouter } from './campaign.routes.js';
import { emailRouter } from './email.routes.js';
import { healthRouter } from './health.routes.js';

export const apiRouter = Router();
apiRouter.use(healthRouter);
apiRouter.use('/api', campaignRouter);
apiRouter.use('/api', emailRouter);
