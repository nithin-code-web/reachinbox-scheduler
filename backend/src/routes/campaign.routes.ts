import { Router } from 'express';
import { createCampaignController } from '../controllers/campaign.controller.js';

export const campaignRouter = Router();
campaignRouter.post('/campaigns', createCampaignController);
