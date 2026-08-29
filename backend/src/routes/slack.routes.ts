import { Router } from 'express';
import {
  disconnectSlackController,
  getSlackConnectionController,
  listSlackChannelsController,
  selectSlackChannelController,
  slackCallbackController,
  startSlackAuthController,
} from '../controllers/slack.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const slackRouter = Router();

slackRouter.get('/auth/slack', requireAuth, startSlackAuthController);
slackRouter.get('/auth/slack/callback', requireAuth, slackCallbackController);
slackRouter.get('/api/slack/connection', requireAuth, getSlackConnectionController);
slackRouter.get('/api/slack/channels', requireAuth, listSlackChannelsController);
slackRouter.patch('/api/slack/connection/channel', requireAuth, selectSlackChannelController);
slackRouter.delete('/api/slack/connection', requireAuth, disconnectSlackController);
